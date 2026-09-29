import { defineOperationApi } from '@directus/extensions-sdk'
import { optionalEnv } from '../../shared/env'
import { heuteAus } from '../../shared/gemeindeseite/datum'
import {
  ERSTLAUF_TAGE,
  fensterSeit,
  NACHLAUF_TAGE
} from '../../shared/gemeindeseite/auswahl'
import {
  erstelleKantonLeser,
  imFenster,
  KANTON_PAUSE_MS,
  leseKonfiguration,
  liesDetail,
  liesListe,
  oeffentlicheSeite
} from '../../shared/kanton'
import { heuteIso } from '../../redaktion/feiertage'
import { ladeRegeln } from '../../redaktion/gedaechtnis'
import { vorfilter } from '../../redaktion/kanton'
import {
  raeumeKantonsmitteilungenAuf,
  sichteKantonsmitteilungen,
  zeilenAus,
  type ZeileFuerKantonSichtung
} from '../../redaktion/kantonlauf'
import {
  KANTON_MELDUNGEN_JE_LAUF,
  schreibeKantonMeldungen
} from '../../redaktion/kantonmeldungen'
import {
  regelnBlock,
  SICHTUNGSREGELN_UEBERSCHRIFT
} from '../../redaktion/lernen'

// The 12:00 look at what the canton says about the municipalities.
//
// Two listing blocks of www.baselland.ch, read through the data door the
// page itself calls (`shared/kanton/`): the general Medienmitteilungen and
// the Polizeimeldungen. Every item inside the window is OPENED — a press
// release carries no teaser, and the municipality is often only in the text
// — and kept only where it names a covered municipality (`vorfilter`, word
// boundaries). One row per named municipality; an item naming none is not
// stored, so it is opened again on every run inside the look-back window —
// bounded by the window (three days, ~2 items a day) and cheaper than a row
// without a municipality would be to carry. Then ONE Sichtung call per
// municipality with new rows, and a draft for every proposal (cap 20, the
// rest named), the Gemeindeseiten bargain.
//
// The public site is only ever LINKED: it sits behind a Cloudflare challenge,
// and the client refuses any host but the data door's.

interface Optionen {
  /** Items per list request; 50 covers a week at ~1 a day with room. */
  bSize?: number
  nachlauf?: number
  erstlauf?: number
  pause?: number
  model?: string | null
}

interface Ergebnis {
  /** Lists read this run — two when both answered. */
  listen: number
  gelesen: number
  geoeffnet: number
  neu: number
  /** Opened items naming no covered municipality — not stored, opened again tomorrow inside the window. */
  ohneGemeinde: number
  /** Rows whose date neither the detail nor the list could give plausibly. */
  ohneDatum: number
  erstlaeufe: string[]
  vorschlaege: number
  weitergereicht: number
  meldungenGeschrieben: number
  meldungenWartend: number
  meldungenOhneText: string[]
  aufgeraeumt: { geloescht: number; verfallen: number }
  anfragen: number
  fehler: string[]
  /** Declared caps and reasons — the run read what it read and says what it left. */
  hinweise: string[]
}

function fehlerText(error: unknown): string {
  return error instanceof Error ? error.message : 'Unbekannter Fehler'
}

export default defineOperationApi<Optionen>({
  id: 'kanton-pruefen',
  handler: async (optionen, { services, getSchema, logger }) => {
    const { ItemsService } = services
    const schema = await getSchema()
    const bSize = Math.min(100, Math.max(1, optionen.bSize ?? 50))
    const nachlauf = Math.max(1, optionen.nachlauf ?? NACHLAUF_TAGE)
    const erstlaufTage = Math.max(1, optionen.erstlauf ?? ERSTLAUF_TAGE)
    const pauseMs = Math.max(0, optionen.pause ?? KANTON_PAUSE_MS)
    const kontakt = optionalEnv('AGENDA_KONTAKT', 'it@bajour.ch')
    const heute = heuteIso()
    const heuteObj = heuteAus(heute)

    const quellen = new ItemsService('quellen', { schema })
    const gemeindenService = new ItemsService('gemeinden', { schema })
    const mitteilungen = new ItemsService('kantonsmitteilungen', { schema })
    const faehrten = new ItemsService('recherchehinweise', { schema })
    const artikel = new ItemsService('meldungen', { schema })
    const wissen = new ItemsService('redaktionswissen', { schema })
    const warnung = { warn: (m: string) => logger.warn(m) }

    const ergebnis: Ergebnis = {
      listen: 0,
      gelesen: 0,
      geoeffnet: 0,
      neu: 0,
      ohneGemeinde: 0,
      ohneDatum: 0,
      erstlaeufe: [],
      vorschlaege: 0,
      weitergereicht: 0,
      meldungenGeschrieben: 0,
      meldungenWartend: 0,
      meldungenOhneText: [],
      aufgeraeumt: { geloescht: 0, verfallen: 0 },
      anfragen: 0,
      fehler: [],
      hinweise: []
    }

    const [quelle] = (await quellen.readByQuery({
      filter: { typ: { _eq: 'kanton' }, aktiv: { _eq: true } },
      fields: ['id', 'name', 'basis_url', 'konfiguration'],
      limit: 1
    })) as Array<{
      id: string
      name: string
      basis_url: string
      konfiguration: unknown
    }>
    if (quelle === undefined) {
      ergebnis.hinweise.push(
        'Keine aktive Quelle vom Typ kanton — nichts gelesen.'
      )
      return ergebnis
    }

    const stemple = async (): Promise<void> => {
      await quellen.updateOne(quelle.id, {
        letzte_pruefung: new Date().toISOString(),
        letzter_fehler:
          ergebnis.fehler.length === 0
            ? null
            : ergebnis.fehler.join(' · ').slice(0, 1000)
      })
    }

    let konfiguration: ReturnType<typeof leseKonfiguration>
    try {
      konfiguration = leseKonfiguration(quelle.konfiguration)
    } catch (fehler) {
      ergebnis.fehler.push(`${quelle.name}: ${fehlerText(fehler)}`)
      await stemple()
      return ergebnis
    }

    const regelzeilen = await ladeRegeln(
      wissen,
      { bereich: 'kanton', stufe: 'sichtung' },
      warnung
    )
    const sichtungsregeln = regelnBlock(
      regelzeilen,
      SICHTUNGSREGELN_UEBERSCHRIFT
    )
    const gemeinden = (await gemeindenService.readByQuery({
      filter: { aktiv: { _eq: true } },
      fields: ['id', 'name'],
      limit: -1
    })) as Array<{ id: string; name: string }>

    try {
      ergebnis.aufgeraeumt = await raeumeKantonsmitteilungenAuf(
        mitteilungen as never,
        heute,
        nachlauf + 1,
        logger
      )
    } catch (fehler) {
      logger.warn(fehler, 'kanton: Aufraeumen fehlgeschlagen.')
      ergebnis.fehler.push(`Aufraeumen: ${fehlerText(fehler)}`)
    }

    const leser = erstelleKantonLeser({
      kontakt,
      basisUrl: quelle.basis_url,
      pauseMs
    })
    const angelegt = new Map<string, ZeileFuerKantonSichtung[]>()

    for (const liste of konfiguration.listen) {
      try {
        const gelesen = await liesListe(leser, quelle.basis_url, liste, bSize)
        ergebnis.listen += 1
        ergebnis.gelesen += gelesen.items.length

        const [vorhanden] = (await mitteilungen.readByQuery({
          filter: { quelle: { _eq: liste.kennung } },
          fields: ['id'],
          limit: 1
        })) as Array<{ id: string }>
        const erstlauf = vorhanden === undefined
        if (erstlauf) ergebnis.erstlaeufe.push(liste.name)
        const seit = fensterSeit(heute, erstlauf, nachlauf, erstlaufTage)
        const imFensterItems = gelesen.items.filter((i) =>
          imFenster(i, seit, heuteObj)
        )
        // A page whose every item is still inside the window may have more
        // behind it — said, never assumed away.
        if (
          imFensterItems.length === gelesen.items.length &&
          gelesen.next !== null
        )
          ergebnis.hinweise.push(
            `${liste.name}: alle ${gelesen.items.length} gelesenen Eintraege liegen im Fenster — aeltere Eintraege im Fenster nicht gelesen (Deckel ${bSize} je Liste)`
          )

        const urls = imFensterItems
          .map((i) => oeffentlicheSeite(i.id, konfiguration.seite))
          .filter((u): u is string => u !== null)
        const bekannt = new Set(
          urls.length === 0
            ? []
            : (
                (await mitteilungen.readByQuery({
                  filter: { url: { _in: urls } },
                  fields: ['url'],
                  limit: -1
                })) as Array<{ url: string }>
              ).map((z) => z.url)
        )

        for (const item of imFensterItems) {
          const url = oeffentlicheSeite(item.id, konfiguration.seite)
          if (url === null || bekannt.has(url)) continue
          try {
            const detail = await liesDetail(leser, item.id)
            ergebnis.geoeffnet += 1
            const getroffene = vorfilter(
              {
                titel: detail.titel ?? item.titel,
                teaser: detail.teaser ?? item.teaser,
                text: detail.text
              },
              gemeinden
            )
            if (getroffene.length === 0) {
              ergebnis.ohneGemeinde += 1
              continue
            }
            const zeilen = zeilenAus({
              item,
              detail,
              liste,
              getroffene,
              seite: konfiguration.seite,
              heute: heuteObj,
              gelesenAm: new Date().toISOString()
            })
            for (const zeile of zeilen) {
              try {
                const id = (await mitteilungen.createOne(zeile)) as string
                ergebnis.neu += 1
                if (zeile.publiziert_am === null) ergebnis.ohneDatum += 1
                const liste_ = angelegt.get(zeile.gemeinde) ?? []
                liste_.push({
                  id,
                  titel: zeile.titel,
                  teaser: zeile.teaser,
                  text: zeile.text,
                  publiziert_am: zeile.publiziert_am,
                  quelle: zeile.quelle,
                  behoerde: zeile.behoerde,
                  gemeinden_genannt: zeile.gemeinden_genannt,
                  text_abgeschnitten: zeile.text_abgeschnitten
                })
                angelegt.set(zeile.gemeinde, liste_)
              } catch (fehler) {
                // A row another run stored a minute ago is no error.
                if (
                  !/unique|duplicate|RECORD_NOT_UNIQUE/i.test(
                    fehlerText(fehler)
                  )
                )
                  ergebnis.fehler.push(
                    `${liste.name}: "${zeile.titel}" nicht gespeichert: ${fehlerText(fehler)}`
                  )
              }
            }
          } catch (fehler) {
            logger.warn(fehler, `kanton: "${item.titel}" nicht gelesen.`)
            ergebnis.fehler.push(
              `${liste.name}: "${item.titel}" nicht gelesen: ${fehlerText(fehler)}`
            )
          }
        }
      } catch (fehler) {
        logger.warn(fehler, `kanton: Liste ${liste.name} fehlgeschlagen.`)
        ergebnis.fehler.push(`${liste.name}: ${fehlerText(fehler)}`)
      }
    }

    // ---- Sichtung, one call per municipality with new rows ---------------
    for (const [gemeindeId, neue] of angelegt) {
      const gemeinde = gemeinden.find((g) => g.id === gemeindeId)
      if (gemeinde === undefined) continue
      try {
        const sichtung = await sichteKantonsmitteilungen(neue, gemeinde, {
          mitteilungen: mitteilungen as never,
          hinweise: faehrten as never,
          meldungen: artikel as never,
          regelzeilen,
          sichtungsregeln,
          heute,
          logger,
          model: optionen.model ?? null
        })
        ergebnis.vorschlaege += sichtung.vorschlaege
        ergebnis.weitergereicht += sichtung.weitergereicht
        if (sichtung.fehler !== null)
          ergebnis.fehler.push(
            `${gemeinde.name}: Sichtung fehlgeschlagen: ${sichtung.fehler}`
          )
      } catch (fehler) {
        logger.warn(fehler, `kanton: Sichtung ${gemeinde.name} fehlgeschlagen.`)
        ergebnis.fehler.push(`${gemeinde.name}: ${fehlerText(fehler)}`)
      }
    }

    // ---- The drafts — every proposal gets its article, cap declared ------
    try {
      const textRegeln = (
        await ladeRegeln(wissen, { bereich: 'kanton', stufe: 'text' }, warnung)
      ).map((r) => r.regel)
      const geschrieben = await schreibeKantonMeldungen(
        {
          mitteilungen: mitteilungen as never,
          meldungen: artikel as never,
          regeln: textRegeln,
          logger: {
            info: (text: string) => logger.info(text),
            warn: (...args: unknown[]) =>
              logger.warn(args[0], String(args[1] ?? ''))
          }
        },
        KANTON_MELDUNGEN_JE_LAUF
      )
      ergebnis.meldungenGeschrieben = geschrieben.geschrieben
      ergebnis.meldungenWartend = geschrieben.wartend
      ergebnis.meldungenOhneText = geschrieben.ohneText
      ergebnis.fehler.push(...geschrieben.fehler)
    } catch (fehler) {
      logger.warn(fehler, 'kanton: Meldungen schreiben fehlgeschlagen.')
      ergebnis.fehler.push(`Meldungen: ${fehlerText(fehler)}`)
    }

    ergebnis.anfragen = leser.protokoll().anfragen
    await stemple()
    logger.info(
      `kanton: ${ergebnis.listen} Listen, ${ergebnis.geoeffnet} geoeffnet, ${ergebnis.neu} neu, ${ergebnis.vorschlaege} Vorschlaege, ${ergebnis.meldungenGeschrieben} Meldungen.`
    )
    return ergebnis
  }
})
