import { defineOperationApi } from '@directus/extensions-sdk'
import { Readable } from 'node:stream'
import {
  fetchDossierMessages,
  type MailboxConfig
} from '../../dossiers/mailbox'
import { envFlag, optionalEnv, requireEnv } from '../../shared/env'
import { parseDossier } from '../../shared/smd/parse'
import { erstelleLinksucher, LINK_MAX_SEITEN } from '../../shared/verlage'
import { extrahiereText } from '../../shared/wochenblatt'
import { heuteIso } from '../../redaktion/feiertage'
import { ladeRegeln } from '../../redaktion/gedaechtnis'
import {
  regelnBlock,
  SICHTUNGSREGELN_UEBERSCHRIFT
} from '../../redaktion/lernen'
import { BLOG_FENSTER_TAGE } from '../../redaktion/smd'
import {
  raeumeSmdAuf,
  sichteSmdBeitraege,
  verarbeiteDossier,
  type ZeileFuerSmdSichtung
} from '../../redaktion/smdlauf'

// The 14:45 look at what other media wrote about the municipalities.
//
// SMD mails the dossier of the newsroom's saved search «gemeinden» every day
// at 14:30 (measured over fourteen days, 14:30 or 14:34), one PDF of every
// piece of the last 26 hours that names one of the searched municipalities.
// This run fetches the mails the desk does not know yet (dedup on the
// subject, THIS database's own, never the mailbox's seen flag), stores the
// PDF, reads its text layer, cuts it into documents by the table of contents
// (`shared/smd/`), turns a blog into its NEW entries, keeps what names a
// covered municipality with word boundaries, asks the publisher's door for
// the online address (`shared/verlage/`), and stores one row per piece and
// municipality. Then ONE Sichtung call per municipality with new rows. No
// drafts: the desk is new, and the Gemeindeseiten bargain is earned.

interface Optionen {
  /** Mails per run; a day brings one, a missed week is worked off in a few runs. */
  limit?: number
  /** A blog entry older than this many days before the dossier is archive. */
  blogFenster?: number
  /** Publisher pages read per run — the declared cap of the link search. */
  maxSeiten?: number
  model?: string | null
}

interface Ergebnis {
  mails: number
  dossiers: number
  dokumente: number
  blogs: number
  blogEintraege: number
  blogAlt: number
  kandidaten: number
  ohneGemeinde: number
  wiederholt: number
  neu: number
  links: {
    gefunden: number
    nichtGefunden: number
    keineTuer: number
    fehler: number
  }
  vorschlaege: number
  weitergereicht: number
  aufgeraeumt: { geloescht: number; verfallen: number }
  anfragen: number
  seiten: number
  hosts: string[]
  fehler: string[]
  hinweise: string[]
}

function fehlerText(error: unknown): string {
  return error instanceof Error ? error.message : 'Unbekannter Fehler'
}

/** The same mailbox as the two shows, a third subject filter — required, never null, for the same measured reason. */
export function smdImapConfigFromEnv(): MailboxConfig {
  return {
    host: requireEnv('IMAP_HOST'),
    port: Number(optionalEnv('IMAP_PORT', '993')),
    secure: envFlag('IMAP_SECURE', true),
    user: requireEnv('IMAP_USER'),
    password: requireEnv('IMAP_PASSWORD'),
    mailbox: optionalEnv('IMAP_MAILBOX', 'INBOX'),
    subjectFilter: requireEnv('SMD_IMAP_SUBJECT_FILTER')
  }
}

/** The day in the mail's subject — «vom 11.10.2026 14:30:49» or «vom 2026-10-07T14:34:40…». */
export function datumAusBetreff(betreff: string): string | null {
  const deutsch = /(\d{2})\.(\d{2})\.(\d{4})/.exec(betreff)
  if (deutsch !== null) return `${deutsch[3]}-${deutsch[2]}-${deutsch[1]}`
  const iso = /(\d{4}-\d{2}-\d{2})T/.exec(betreff)
  return iso?.[1] ?? null
}

export default defineOperationApi<Optionen>({
  id: 'smd-pruefen',
  handler: async (optionen, { services, getSchema, logger, database }) => {
    const { ItemsService, FilesService } = services as typeof services & {
      FilesService: new (opts: unknown) => {
        uploadOne: (
          strom: unknown,
          daten: Record<string, unknown>
        ) => Promise<string>
      }
    }
    const schema = await getSchema()
    const limit = Math.max(1, Math.min(10, optionen.limit ?? 3))
    const blogFenster = Math.max(0, optionen.blogFenster ?? BLOG_FENSTER_TAGE)
    const maxSeiten = Math.max(0, optionen.maxSeiten ?? LINK_MAX_SEITEN)
    const kontakt = optionalEnv('AGENDA_KONTAKT', 'it@bajour.ch')
    const heute = heuteIso()

    const dossiers = new ItemsService('smd_dossiers', { schema })
    const beitraege = new ItemsService('smd_beitraege', { schema })
    const gemeindenService = new ItemsService('gemeinden', { schema })
    const faehrten = new ItemsService('recherchehinweise', { schema })
    const artikel = new ItemsService('meldungen', { schema })
    const wissen = new ItemsService('redaktionswissen', { schema })
    const files = new FilesService({ schema, knex: database })
    const warnung = { warn: (m: string) => logger.warn(m) }
    const log = {
      info: (m: string) => logger.info(m),
      warn: (e: unknown, m?: string) => logger.warn(e, m ?? '')
    }

    const ergebnis: Ergebnis = {
      mails: 0,
      dossiers: 0,
      dokumente: 0,
      blogs: 0,
      blogEintraege: 0,
      blogAlt: 0,
      kandidaten: 0,
      ohneGemeinde: 0,
      wiederholt: 0,
      neu: 0,
      links: { gefunden: 0, nichtGefunden: 0, keineTuer: 0, fehler: 0 },
      vorschlaege: 0,
      weitergereicht: 0,
      aufgeraeumt: { geloescht: 0, verfallen: 0 },
      anfragen: 0,
      seiten: 0,
      hosts: [],
      fehler: [],
      hinweise: []
    }

    const gemeinden = (await gemeindenService.readByQuery({
      filter: { aktiv: { _eq: true } },
      fields: ['id', 'name'],
      limit: -1
    })) as Array<{ id: string; name: string }>

    try {
      ergebnis.aufgeraeumt = await raeumeSmdAuf(
        beitraege as never,
        heute,
        blogFenster + 1,
        log
      )
    } catch (fehler) {
      logger.warn(fehler, 'smd: Aufraeumen fehlgeschlagen.')
      ergebnis.fehler.push(`Aufraeumen: ${fehlerText(fehler)}`)
    }

    // ---- The mails ------------------------------------------------------
    const config = smdImapConfigFromEnv()
    const bekannt = new Set(
      (
        (await dossiers.readByQuery({
          fields: ['source_subject'],
          limit: -1
        })) as Array<{ source_subject: string | null }>
      )
        .map((d) => d.source_subject)
        .filter((s): s is string => s !== null)
    )
    const linksucher = erstelleLinksucher({ kontakt, maxSeiten })
    const angelegt = new Map<string, ZeileFuerSmdSichtung[]>()

    const { messages, close } = await fetchDossierMessages(
      config,
      limit,
      bekannt
    )
    ergebnis.mails = messages.length
    try {
      for (const message of messages) {
        let dossierId: string | null = null
        try {
          const dateiId = await files.uploadOne(
            Readable.from(message.attachmentBuffer),
            {
              title: message.subject.slice(0, 200),
              filename_download: message.attachmentFilename.replace(
                /[^\w. -]/g,
                ''
              ),
              type: 'application/pdf',
              storage: 'local'
            }
          )
          dossierId = (await dossiers.createOne({
            source_subject: message.subject,
            source_message_id: message.messageId,
            pdf: dateiId,
            datum: datumAusBetreff(message.subject),
            status: 'verarbeitet'
          })) as string
          ergebnis.dossiers += 1

          const layer = await extrahiereText(message.attachmentBuffer)
          const lesung = parseDossier(layer.seitenTexte)
          const dossierDatum =
            lesung.kopf.erstelltAm ?? datumAusBetreff(message.subject) ?? heute
          const verarbeitung = await verarbeiteDossier(lesung, {
            dossierId,
            dossierDatum,
            gemeinden,
            beitraege: beitraege as never,
            linksucher,
            blogFensterTage: blogFenster,
            logger: log
          })
          ergebnis.dokumente += verarbeitung.dokumente
          ergebnis.blogs += verarbeitung.blogs
          ergebnis.blogEintraege += verarbeitung.blogEintraege
          ergebnis.blogAlt += verarbeitung.blogAlt
          ergebnis.kandidaten += verarbeitung.kandidaten
          ergebnis.ohneGemeinde += verarbeitung.ohneGemeinde
          ergebnis.wiederholt += verarbeitung.wiederholt
          ergebnis.neu += verarbeitung.neu
          ergebnis.links.gefunden += verarbeitung.links.gefunden
          ergebnis.links.nichtGefunden += verarbeitung.links.nichtGefunden
          ergebnis.links.keineTuer += verarbeitung.links.keineTuer
          ergebnis.links.fehler += verarbeitung.links.fehler
          ergebnis.fehler.push(...verarbeitung.fehler)
          ergebnis.hinweise.push(
            ...lesung.hinweise.map((h) => `${message.subject}: ${h}`)
          )
          for (const [gemeindeId, zeilen] of verarbeitung.angelegt) {
            const liste = angelegt.get(gemeindeId) ?? []
            liste.push(...zeilen)
            angelegt.set(gemeindeId, liste)
          }
          await dossiers.updateOne(dossierId, {
            datum: dossierDatum,
            seiten: layer.seiten,
            dokumente: verarbeitung.dokumente,
            anzahl_beitraege: verarbeitung.neu,
            hinweise: lesung.hinweise.length === 0 ? null : lesung.hinweise,
            fehler:
              verarbeitung.fehler.length === 0
                ? null
                : verarbeitung.fehler.join(' · ').slice(0, 2000),
            verarbeitet_am: new Date().toISOString()
          })
          // Only after the row exists — a mail that failed stays unmarked.
          await message.markSeen()
        } catch (fehler) {
          logger.warn(
            fehler,
            `smd: Dossier «${message.subject}» fehlgeschlagen.`
          )
          ergebnis.fehler.push(`${message.subject}: ${fehlerText(fehler)}`)
          if (dossierId !== null) {
            await dossiers
              .updateOne(dossierId, {
                status: 'fehlgeschlagen',
                fehler: fehlerText(fehler).slice(0, 2000),
                verarbeitet_am: new Date().toISOString()
              })
              .catch(() => undefined)
          }
        }
      }
    } finally {
      await close()
    }
    const protokoll = linksucher.protokoll()
    ergebnis.anfragen = protokoll.anfragen
    ergebnis.seiten = protokoll.seiten
    ergebnis.hosts = protokoll.hosts
    if (protokoll.seiten >= maxSeiten && maxSeiten > 0)
      ergebnis.hinweise.push(
        `Deckel von ${maxSeiten} Verlagsseiten je Lauf erreicht — Links, die danach gesucht wurden, tragen den Grund auf der Zeile`
      )

    // ---- Sichtung, one call per municipality with new rows ---------------
    const regelzeilen = await ladeRegeln(
      wissen,
      { bereich: 'smd', stufe: 'sichtung' },
      warnung
    )
    const sichtungsregeln = regelnBlock(
      regelzeilen,
      SICHTUNGSREGELN_UEBERSCHRIFT
    )
    for (const [gemeindeId, neue] of angelegt) {
      const gemeinde = gemeinden.find((g) => g.id === gemeindeId)
      if (gemeinde === undefined) continue
      try {
        const sichtung = await sichteSmdBeitraege(neue, gemeinde, {
          beitraege: beitraege as never,
          hinweise: faehrten as never,
          meldungen: artikel as never,
          regelzeilen,
          sichtungsregeln,
          heute,
          logger: log,
          model: optionen.model ?? null
        })
        ergebnis.vorschlaege += sichtung.vorschlaege
        ergebnis.weitergereicht += sichtung.weitergereicht
        if (sichtung.fehler !== null)
          ergebnis.fehler.push(
            `${gemeinde.name}: Sichtung fehlgeschlagen: ${sichtung.fehler}`
          )
      } catch (fehler) {
        logger.warn(fehler, `smd: Sichtung ${gemeinde.name} fehlgeschlagen.`)
        ergebnis.fehler.push(`${gemeinde.name}: ${fehlerText(fehler)}`)
      }
    }

    logger.info(
      `smd: ${ergebnis.mails} Mails, ${ergebnis.dokumente} Dokumente, ${ergebnis.neu} neue Zeilen, ${ergebnis.links.gefunden} Links, ${ergebnis.vorschlaege} Vorschlaege.`
    )
    return ergebnis
  }
})
