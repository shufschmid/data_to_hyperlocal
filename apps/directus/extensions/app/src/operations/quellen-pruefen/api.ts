import { defineOperationApi } from '@directus/extensions-sdk'
import { cacheableSystem, completeJson } from '../../shared/claude'
import { scrape } from '../../shared/crawler'
import {
  contentFingerprint,
  detectMunicipalityFields,
  fetchRecords,
  istGemeindeebene,
  istRegister,
  listDatasets,
  MAX_LIMIT,
  OdsRequestError,
  type OdsDataset
} from '../../shared/ods'
import {
  bewertungText,
  buildRelevanzPrompt,
  keineGemeindedatenText,
  parseRelevanz,
  RELEVANZ_SYSTEM_PROMPT
} from '../../redaktion/relevanz'
import {
  agendaSchluessel,
  AgendaChallengeError,
  fetchAgenda,
  fetchWebartikel,
  istWebartikel,
  type AgendaEintrag
} from '../../shared/agenda'
import {
  buildArtikelZuordnungPrompt,
  buildKatalogSystem,
  buildZuordnungPrompt,
  mehrfachHinweis,
  parseMehrfachZuordnung,
  parseZuordnung,
  zuordnungHinweis,
  ZUORDNUNG_MEHRFACH_SCHEMA,
  ZUORDNUNG_SCHEMA,
  type KatalogEintrag
} from '../../shared/agenda/zuordnung'
import {
  GEMEINDE_SPALTE,
  ladeSeite,
  ladeTabelle,
  tabellenId
} from '../../shared/statbl'
import { tabellenBesitzer, tabellenFelder } from '../../shared/statbl/parse'
import { ordneSeiteEin } from '../../shared/statbl/inventur'
import { optionalEnv } from '../../shared/env'
import type {
  Ankuendigung,
  Datensatz,
  Gemeinde,
  PortalBereich,
  PortalSeite,
  Quelle
} from '../../types/schema'

// The daily "is there anything new?" check.
//
// Attach this to a Flow with a Schedule trigger (Settings → Flows → Schedule),
// then run `npm run schema:dump` so the Flow itself is in version control.
// https://directus.com/docs/guides/flows/triggers
//
// Two separate budgets, because the two halves cost very different things:
//   - `seiten`  pages of catalogue metadata. Cheap: plain JSON, no model.
//   - `bewertungen`  Claude calls. On a fresh install 181 datasets are waiting,
//     and assessing them all in one night is exactly the kind of unbounded run
//     that turns into a surprise invoice. They get worked off over several days.
//   - `zuordnungen`  Claude calls that connect an agenda entry to the portal
//     dataset behind it. Cheap per call — the catalogue is a cached prefix — but
//     still calls, and still bounded.
//
// Datasets without a municipality breakdown are rejected without ever reaching
// the model — that is read from the portal's field metadata and is a fact, not
// a judgement.

const STANDARD_ZUORDNUNGEN = 10
/** Agenda entries with a direct table link taken up per run. */
const STANDARD_TABELLEN = 5
/** Municipality-column checks per run — one small request each. */
const STANDARD_GEMEINDEPRUEFUNGEN = 25

export interface Options {
  seiten: number
  bewertungen: number
  /** Optional: a Flow saved before this option existed passes nothing. */
  zuordnungen?: number | null
  /** How many agenda entries that link straight to a portal table are taken up. */
  tabellen?: number | null
  /** How many datasets get their municipality column checked against real values. */
  gemeindepruefungen?: number | null
  model?: string | null
}

interface Ergebnis {
  quellen: number
  gesehen: number
  neu: number
  geaendert: number
  bewertet: number
  relevant: number
  /** Agenda entries connected to a portal dataset. */
  zugeordnet: number
  /** Agenda entries seen for the first time. */
  angekuendigt: number
  /** Agenda entries that moved from announced to published. */
  neuPubliziert: number
  fehler: string[]
  hinweise: string[]
}

export default defineOperationApi<Options>({
  id: 'quellen-pruefen',
  handler: async (
    { seiten, bewertungen, zuordnungen, tabellen, gemeindepruefungen, model },
    { services, getSchema, logger }
  ) => {
    const { ItemsService } = services
    const schema = await getSchema()

    // A scheduled Flow has no user, so these services run as the system.
    const quellenService = new ItemsService('quellen', { schema })
    const datensaetzeService = new ItemsService('datensaetze', { schema })
    const ankuendigungenService = new ItemsService('ankuendigungen', { schema })
    const gemeindenService = new ItemsService('gemeinden', { schema })
    const bereicheService = new ItemsService('portal_bereiche', { schema })
    const seitenService = new ItemsService('portal_seiten', { schema })

    const ergebnis: Ergebnis = {
      quellen: 0,
      gesehen: 0,
      neu: 0,
      geaendert: 0,
      bewertet: 0,
      relevant: 0,
      zugeordnet: 0,
      angekuendigt: 0,
      neuPubliziert: 0,
      fehler: [],
      hinweise: []
    }

    const quellen = (await quellenService.readByQuery({
      filter: { aktiv: { _eq: true } },
      fields: ['id', 'name', 'typ', 'basis_url'],
      limit: 50
    })) as Array<Pick<Quelle, 'id' | 'name' | 'typ' | 'basis_url'>>

    for (const quelle of quellen) {
      if (
        quelle.typ !== 'ods' &&
        quelle.typ !== 'agenda' &&
        quelle.typ !== 'statbl'
      ) {
        logger.warn(
          `quellen-pruefen: Quellentyp "${quelle.typ}" hat keinen Adapter`
        )
        continue
      }

      ergebnis.quellen += 1

      try {
        if (quelle.typ === 'ods') await pruefeQuelle(quelle)
        else if (quelle.typ === 'statbl') await pruefeTabellen(quelle)
        else await pruefeAgenda(quelle)

        await quellenService.updateOne(quelle.id, {
          letzte_pruefung: new Date().toISOString(),
          letzter_fehler: null
        })
      } catch (error) {
        // A bot check that survives every attempt is not a crash, but it is not
        // nothing either: the agenda simply was not read today. It gets written
        // to the source so it is visible in the admin UI, because the fallback
        // is a person opening the page and entering the entry by hand — and
        // nobody does that in response to a log line they never see.
        if (error instanceof AgendaChallengeError) {
          const text = `Bot-Pruefung nach ${error.versuche} Versuchen. Bitte die Agenda von Hand oeffnen und neue Eintraege unter "Ankuendigungen" erfassen: ${error.url}`

          logger.warn(`quellen-pruefen: ${quelle.name} — ${text}`)
          ergebnis.hinweise.push(`${quelle.name}: ${text}`)

          await quellenService.updateOne(quelle.id, {
            letzte_pruefung: new Date().toISOString(),
            letzter_fehler: text
          })
          continue
        }

        // One unreachable portal must not stop the others.
        const text =
          error instanceof OdsRequestError
            ? `${error.errorCode ?? error.status}: ${error.message}`
            : error instanceof Error
              ? error.message
              : String(error)

        logger.error(
          error,
          `quellen-pruefen: Quelle ${quelle.name} fehlgeschlagen`
        )
        ergebnis.fehler.push(`${quelle.name}: ${text}`)

        await quellenService.updateOne(quelle.id, {
          letzte_pruefung: new Date().toISOString(),
          letzter_fehler: text
        })
      }
    }

    await pruefeGemeindeebene()
    await uebernehmeVerlinkteTabellen()
    await bewerteOffene()
    await ordneAnkuendigungenZu()
    await pruefeBereiche()

    return ergebnis

    async function pruefeQuelle(
      quelle: Pick<Quelle, 'id' | 'name' | 'basis_url'>
    ): Promise<void> {
      for (let seite = 0; seite < seiten; seite += 1) {
        const katalog = await listDatasets(quelle.basis_url, {
          limit: MAX_LIMIT,
          offset: seite * MAX_LIMIT
        })

        for (const dataset of katalog.datasets) {
          await uebernehme(quelle.id, dataset)
        }

        ergebnis.gesehen += katalog.datasets.length

        // Last page reached.
        if ((seite + 1) * MAX_LIMIT >= katalog.totalCount) break
      }
    }

    /**
     * The early-warning half: reads the office's agenda page.
     *
     * Only writes what actually moved. An entry that is still `geplant` with
     * the same quarter produces no update at all, so `date_updated` stays
     * meaningful as "something changed here".
     */
    async function pruefeAgenda(
      quelle: Pick<Quelle, 'id' | 'name' | 'basis_url'>
    ): Promise<void> {
      const eintraege = await fetchAgenda(quelle.basis_url, {
        kontakt: optionalEnv('AGENDA_KONTAKT', 'it@bajour.ch'),
        // Offered, not used by default: fetchAgenda only reaches for this once
        // every honest attempt has been turned away. Without CRAWLER_KEY the
        // call throws and the run reports the bot check as before.
        notfallMarkdown: async (url) => (await scrape(url)).markdown
      })

      ergebnis.gesehen += eintraege.length

      for (const eintrag of eintraege) {
        await uebernehmeAnkuendigung(quelle.id, eintrag)
      }
    }

    /**
     * The remembering half: does a registered table have a new edition?
     *
     * Only tables a person pasted are ever looked at — this host is never
     * crawled. The year selector on the page is the whole trigger: a year that
     * was not there yesterday means the office has published, and the dataset
     * goes back into the queue so a run opens with the instruction it was
     * registered with.
     */
    async function pruefeTabellen(
      quelle: Pick<Quelle, 'id' | 'name'>
    ): Promise<void> {
      const tabellen = (await datensaetzeService.readByQuery({
        filter: { quelle: { _eq: quelle.id } },
        fields: ['id', 'externe_id', 'titel', 'letzter_stand', 'status'],
        limit: 50
      })) as Array<
        Pick<
          Datensatz,
          'id' | 'externe_id' | 'titel' | 'letzter_stand' | 'status'
        >
      >

      ergebnis.gesehen += tabellen.length

      for (const tabelle of tabellen) {
        try {
          const gelesen = await ladeTabelle(tabelle.externe_id)

          const beschreibend = {
            titel: gelesen.titel,
            felder: tabellenFelder(gelesen),
            daten_stand: gelesen.stand,
            zeilen: gelesen.zeilen.length,
            beschreibung: `Tabelle ${tabelle.externe_id} auf statistik.bl.ch, Jahrgaenge ${gelesen.jahre.join(', ')}`
          }

          // The year is the fingerprint here. A correction inside an existing
          // edition does not reopen a run — same reason `letzter_stand` exists
          // on the portal side. Was beschreibt, wird trotzdem nachgefuehrt:
          // sonst behaelt eine Tabelle fuer immer den Stand, den sie beim
          // Registrieren hatte.
          if (gelesen.jahr === tabelle.letzter_stand) {
            await datensaetzeService.updateOne(tabelle.id, beschreibend)
            continue
          }

          await datensaetzeService.updateOne(tabelle.id, {
            titel: gelesen.titel,
            felder: tabellenFelder(gelesen),
            letzter_stand: gelesen.jahr,
            beschreibung: `Tabelle ${tabelle.externe_id} auf statistik.bl.ch, Jahrgaenge ${gelesen.jahre.join(', ')}`,
            // Back into the queue unless a person switched it off. The standing
            // instruction rides along on the dataset, so the run that opens
            // next writes the same story from the new numbers.
            status: tabelle.status === 'ignoriert' ? 'ignoriert' : 'relevant'
          })

          ergebnis.geaendert += 1
          ergebnis.hinweise.push(
            `${gelesen.titel}: neuer Jahrgang ${gelesen.jahr} (vorher ${tabelle.letzter_stand ?? 'keiner'})`
          )
        } catch (error) {
          const text = error instanceof Error ? error.message : String(error)
          logger.warn(
            `quellen-pruefen: Tabelle ${tabelle.externe_id} — ${text}`
          )
          ergebnis.fehler.push(`${tabelle.titel}: ${text}`)
        }
      }
    }

    async function uebernehmeAnkuendigung(
      quelleId: string,
      eintrag: AgendaEintrag
    ): Promise<void> {
      const schluessel = agendaSchluessel(eintrag)

      const bestehende = (await ankuendigungenService.readByQuery({
        filter: { quelle: { _eq: quelleId }, schluessel: { _eq: schluessel } },
        fields: ['id', 'status', 'datum', 'quartal', 'link'],
        limit: 1
      })) as Array<
        Pick<Ankuendigung, 'id' | 'status' | 'datum' | 'quartal' | 'link'>
      >

      const vorhanden = bestehende[0]

      if (vorhanden === undefined) {
        await ankuendigungenService.createOne({
          quelle: quelleId,
          schluessel,
          titel: eintrag.titel,
          status: eintrag.status,
          datum: eintrag.datum,
          quartal: eintrag.quartal,
          link: eintrag.link,
          erstmals_gesehen: new Date().toISOString(),
          publiziert_seit:
            eintrag.status === 'publiziert' ? new Date().toISOString() : null
        })
        ergebnis.angekuendigt += 1
        return
      }

      const wirdPubliziert =
        vorhanden.status === 'geplant' && eintrag.status === 'publiziert'

      const unveraendert =
        vorhanden.status === eintrag.status &&
        vorhanden.datum === eintrag.datum &&
        vorhanden.quartal === eintrag.quartal &&
        vorhanden.link === eintrag.link

      if (unveraendert) return

      await ankuendigungenService.updateOne(vorhanden.id, {
        titel: eintrag.titel,
        status: eintrag.status,
        datum: eintrag.datum,
        quartal: eintrag.quartal,
        link: eintrag.link,
        ...(wirdPubliziert ? { publiziert_seit: new Date().toISOString() } : {})
      })

      if (wirdPubliziert) ergebnis.neuPubliziert += 1
    }

    async function uebernehme(
      quelleId: string,
      dataset: OdsDataset
    ): Promise<void> {
      const municipality = detectMunicipalityFields(dataset.fields)
      const fingerprint = contentFingerprint(dataset)

      const bestehende = (await datensaetzeService.readByQuery({
        filter: {
          quelle: { _eq: quelleId },
          externe_id: { _eq: dataset.datasetId }
        },
        fields: ['id', 'letzter_stand', 'status'],
        limit: 1
      })) as Array<Pick<Datensatz, 'id' | 'letzter_stand' | 'status'>>

      const gemeinsam = {
        titel: dataset.titel,
        beschreibung: dataset.beschreibung,
        portal_modified: dataset.modified,
        // Der ehrlichere Zeitstempel: er bewegt sich nur, wenn sich die Zahlen
        // bewegt haben. `portal_modified` springt auch bei einer korrigierten
        // Beschreibung, und genau davon war die Zeitleiste voll.
        daten_stand: dataset.dataProcessed,
        zeilen: dataset.recordsCount,
        rhythmus: dataset.rhythmus,
        felder: dataset.fields,
        hat_gemeinde: municipality !== null,
        letzter_stand: fingerprint
      }

      // Ein Register ist keine Statistik. Taeglich nachgefuehrte Bestaende —
      // Zefix, Motorfahrzeuge, Messwerte — haben keine Berichtsperiode; eine
      // Meldung darueber waere am naechsten Morgen alt, und dieser Redaktion
      // muessen ihre Texte in fuenf Jahren noch stimmen.
      const registerFelder = istRegister(dataset.rhythmus)
        ? {
            status: 'ignoriert',
            bewertung: `Nicht relevant: wird laut Katalog "${dataset.rhythmus}" nachgefuehrt — ein Register ohne Berichtsperiode.`
          }
        : {}

      const vorhanden = bestehende[0]

      if (vorhanden === undefined) {
        await datensaetzeService.createOne({
          quelle: quelleId,
          externe_id: dataset.datasetId,
          status: 'neu',
          ...gemeinsam,
          ...registerFelder
        })
        ergebnis.neu += 1
        return
      }

      // Nothing moved in the data itself — a corrected description does not
      // reopen a dataset that was already dealt with. Was beschreibt, wird
      // trotzdem nachgefuehrt: Rhythmus, Zeilenzahl und Beschreibung sind das,
      // woran die Redaktion entscheidet, ob ein Datensatz sie interessiert, und
      // die duerfen nicht am Fingerabdruck haengen.
      if (vorhanden.letzter_stand === fingerprint) {
        await datensaetzeService.updateOne(vorhanden.id, {
          ...gemeinsam,
          ...registerFelder
        })
        return
      }

      await datensaetzeService.updateOne(vorhanden.id, {
        ...gemeinsam,
        // New numbers on a dataset we already published from: it goes back into
        // the queue so the new period can be written up.
        status: vorhanden.status === 'ignoriert' ? 'ignoriert' : 'neu',
        bewertung: null,
        ...registerFelder
      })
      ergebnis.geaendert += 1
    }

    async function bewerteOffene(): Promise<void> {
      const offene = (await datensaetzeService.readByQuery({
        filter: { status: { _eq: 'neu' }, bewertung: { _null: true } },
        sort: ['date_created'],
        fields: [
          'id',
          'titel',
          'beschreibung',
          'felder',
          'hat_gemeinde',
          'letzter_stand'
        ],
        limit: Math.max(bewertungen, 0)
      })) as Array<
        Pick<
          Datensatz,
          | 'id'
          | 'titel'
          | 'beschreibung'
          | 'felder'
          | 'hat_gemeinde'
          | 'letzter_stand'
        >
      >

      for (const datensatz of offene) {
        // Free rejection: no municipality column, no article possible.
        if (!datensatz.hat_gemeinde) {
          await datensaetzeService.updateOne(datensatz.id, {
            status: 'ignoriert',
            bewertung: keineGemeindedatenText()
          })
          continue
        }

        const felder = datensatz.felder ?? []
        const municipality = detectMunicipalityFields(felder)
        if (municipality === null) continue

        const alsDataset: OdsDataset = {
          datasetId: datensatz.id,
          titel: datensatz.titel,
          beschreibung: datensatz.beschreibung,
          modified: null,
          rhythmus: null,
          dataProcessed: null,
          recordsCount: null,
          fields: felder
        }

        try {
          const antwort = await completeJson<unknown>({
            system: RELEVANZ_SYSTEM_PROMPT,
            prompt: buildRelevanzPrompt(alsDataset, municipality),
            maxTokens: 700,
            thinking: 'disabled',
            effort: 'low',
            ...(model ? { model } : {})
          })

          const urteil = parseRelevanz(antwort, alsDataset)

          await datensaetzeService.updateOne(datensatz.id, {
            status: urteil.relevant ? 'relevant' : 'ignoriert',
            bewertung: bewertungText(urteil)
          })

          ergebnis.bewertet += 1
          if (urteil.relevant) ergebnis.relevant += 1
        } catch (error) {
          // A dataset that could not be judged stays open and is retried on the
          // next run — one bad answer must not abort the batch.
          logger.warn(
            error,
            `quellen-pruefen: Bewertung fuer "${datensatz.titel}" uebersprungen`
          )
        }
      }
    }

    /**
     * The daily watch over the portal's blind spots.
     *
     * Only branches the inventory marked: municipality level, no open-data
     * dataset, no agenda entry. Everything else reaches us through those two
     * channels, so polling it here would be traffic for news we already get.
     *
     * One page per branch. The branch publishes its own "Letzte Änderung", and
     * comparing that date is the whole check — the expensive part happens only
     * when the date has actually moved.
     */
    async function pruefeBereiche(): Promise<void> {
      const bereiche = (await bereicheService.readByQuery({
        filter: { beobachten: { _eq: true } },
        fields: ['id', 'pfad', 'titel', 'stand'],
        sort: ['pfad'],
        limit: 200
      })) as Array<Pick<PortalBereich, 'id' | 'pfad' | 'titel' | 'stand'>>

      for (const bereich of bereiche) {
        try {
          const { stand } = await ladeSeite(bereich.pfad)
          ergebnis.gesehen += 1

          await bereicheService.updateOne(bereich.id, {
            letzte_pruefung: new Date().toISOString(),
            letzter_fehler: null
          })

          if (stand === null || stand === bereich.stand) continue

          await bereicheService.updateOne(bereich.id, { stand })
          ergebnis.hinweise.push(
            `Portal ${bereich.pfad}: geaendert am ${stand} (vorher ${bereich.stand ?? 'unbekannt'})`
          )

          await uebernehmeGeaenderteTabellen(bereich)
        } catch (error) {
          const beschreibung =
            error instanceof Error ? error.message : String(error)
          logger.warn(
            `quellen-pruefen: Portal ${bereich.pfad} — ${beschreibung}`
          )
          ergebnis.fehler.push(`Portal ${bereich.pfad}: ${beschreibung}`)

          await bereicheService.updateOne(bereich.id, {
            letzte_pruefung: new Date().toISOString(),
            letzter_fehler: beschreibung
          })
        }
      }
    }

    /**
     * Registers the branch's watched tables as datasets, so a run can be
     * started from them.
     *
     * Only the pages the inventory already marked — a changed branch is not a
     * licence to walk it again. New pages that appeared with the change are
     * picked up by the next inventory run, which is what that queue is for.
     */
    async function uebernehmeGeaenderteTabellen(
      bereich: Pick<PortalBereich, 'id' | 'pfad'>
    ): Promise<void> {
      const tabellen = (await seitenService.readByQuery({
        filter: { bereich: { _eq: bereich.id }, beobachten: { _eq: true } },
        fields: ['id', 'pfad', 'titel', 'datensatz'],
        limit: 40
      })) as Array<Pick<PortalSeite, 'id' | 'pfad' | 'titel' | 'datensatz'>>

      if (tabellen.length === 0) return

      const quelle = (
        (await quellenService.readByQuery({
          filter: { typ: { _eq: 'statbl' } },
          fields: ['id'],
          limit: 1
        })) as { id: string }[]
      )[0]

      if (quelle === undefined) {
        ergebnis.fehler.push('Quelle "Statistik BL — Tabellen" fehlt.')
        return
      }

      for (const tabelle of tabellen) {
        try {
          const gelesen = await ladeTabelle(tabelle.pfad)

          const gemeinsam = {
            titel: gelesen.titel,
            beschreibung: `Tabelle ${tabelle.pfad} auf statistik.bl.ch, Jahrgaenge ${gelesen.jahre.join(', ')}`,
            felder: tabellenFelder(gelesen),
            hat_gemeinde: true,
            gemeindefeld: GEMEINDE_SPALTE,
            letzter_stand: gelesen.jahr,
            daten_stand: gelesen.stand,
            zeilen: gelesen.zeilen.length
          }

          if (tabelle.datensatz === null) {
            const id = (await datensaetzeService.createOne({
              quelle: quelle.id,
              externe_id: tabelle.pfad,
              status: 'neu',
              bewertung: null,
              ...gemeinsam
            })) as string

            await seitenService.updateOne(tabelle.id, { datensatz: id })
            ergebnis.neu += 1
          } else {
            await datensaetzeService.updateOne(tabelle.datensatz, {
              ...gemeinsam,
              // Back into the queue unless a person switched it off. The
              // standing instruction rides along on the dataset.
              status: 'relevant',
              bewertung: null
            })
            ergebnis.geaendert += 1
          }
        } catch (error) {
          const beschreibung =
            error instanceof Error ? error.message : String(error)
          logger.warn(
            `quellen-pruefen: Tabelle ${tabelle.pfad} — ${beschreibung}`
          )
          ergebnis.fehler.push(`${tabelle.titel}: ${beschreibung}`)
        }
      }
    }

    /**
     * Is the "municipality" column really one?
     *
     * The metadata cannot say. The office annotates every level of its
     * hierarchy with the same concept — `DV_KT_BEZ_GDE_SNAP`, Kanton BEZirk
     * GEmeinde — so a district column carries exactly the marker that is meant
     * to prove municipality data. Two datasets passed that way, and the only
     * thing that would have caught them is the coverage check inside a run,
     * after a briefing had been paid for.
     *
     * So the values decide, against the 86 numbers we hold ourselves. One
     * request per dataset, once: `group_by` returns the distinct values of the
     * column, and districts (1301–1305) simply are not among ours.
     */
    async function pruefeGemeindeebene(): Promise<void> {
      const budget =
        typeof gemeindepruefungen === 'number' &&
        Number.isFinite(gemeindepruefungen)
          ? Math.max(gemeindepruefungen, 0)
          : STANDARD_GEMEINDEPRUEFUNGEN
      if (budget === 0) return

      const offene = (await datensaetzeService.readByQuery({
        filter: {
          hat_gemeinde: { _eq: true },
          gemeinde_geprueft: { _null: true },
          gemeindefeld: { _null: true }
        },
        sort: ['externe_id'],
        fields: ['id', 'externe_id', 'titel', 'felder', 'quelle'],
        limit: budget
      })) as Array<
        Pick<Datensatz, 'id' | 'externe_id' | 'titel' | 'felder' | 'quelle'>
      >

      if (offene.length === 0) return

      const gemeinden = (await gemeindenService.readByQuery({
        fields: ['bfs_nummer'],
        limit: -1
      })) as Pick<Gemeinde, 'bfs_nummer'>[]
      const bekannt = new Set(gemeinden.map((g) => g.bfs_nummer))

      for (const datensatz of offene) {
        const spalte = detectMunicipalityFields(datensatz.felder ?? [])
        if (spalte === null) continue

        try {
          const quelle = (await quellenService.readOne(datensatz.quelle ?? '', {
            fields: ['basis_url', 'typ']
          })) as Pick<Quelle, 'basis_url' | 'typ'>

          // Only the open data portal answers `group_by`; a registered table
          // was read in full anyway and named its column by hand.
          if (quelle.typ !== 'ods') continue

          const zeilen = await fetchRecords(
            quelle.basis_url,
            datensatz.externe_id,
            {
              limit: MAX_LIMIT,
              groupBy: spalte.bfsField
            }
          )

          const urteil = istGemeindeebene(
            zeilen.map(
              (zeile) => zeile[spalte.bfsField] as string | number | null
            ),
            bekannt
          )

          await datensaetzeService.updateOne(datensatz.id, {
            gemeinde_geprueft: new Date().toISOString(),
            ...(urteil.gemeindeebene
              ? {}
              : {
                  hat_gemeinde: false,
                  status: 'ignoriert',
                  bewertung: `Nicht relevant: Die Spalte "${spalte.bfsField}" enthaelt keine Gemeindenummern (${zeilen.length} Auspraegungen geprueft) — der Datensatz ist nicht nach Gemeinde gegliedert.`
                })
          })

          if (!urteil.gemeindeebene) {
            ergebnis.hinweise.push(
              `${datensatz.titel}: keine Gemeindeebene, sondern "${spalte.bfsField}"`
            )
          }
        } catch (error) {
          // Ungeprueft lassen: ein Abruf, der heute scheitert, ist morgen einen
          // zweiten Versuch wert — anders als ein geprueftes Nein.
          const text = error instanceof Error ? error.message : String(error)
          logger.warn(
            `quellen-pruefen: Gemeindeebene von ${datensatz.externe_id} — ${text}`
          )
        }
      }
    }

    /**
     * Agenda entries that name their table outright.
     *
     * Twelve of the nineteen published entries link straight to a page on
     * statistik.bl.ch instead of to a web article — "Bevölkerungsstatistik,
     * 1. Quartal 2026" points at `web_portal/1_1_1`. For those the question
     * "which dataset is this?" has a written answer, and asking a model about
     * the open-data catalogue instead produced "kein Datensatz" for entries
     * whose data was one click away.
     *
     * So the link is used first, and deterministically: read the page, check
     * against our own 86 municipality names, register it. No model, no guess.
     * A table without a municipality breakdown is recorded as such rather than
     * registered — a run over it could only produce cantonal prose.
     *
     * This runs on every check, so a new entry tomorrow takes the same path.
     */
    async function uebernehmeVerlinkteTabellen(): Promise<void> {
      const budget =
        typeof tabellen === 'number' && Number.isFinite(tabellen)
          ? Math.max(tabellen, 0)
          : STANDARD_TABELLEN
      if (budget === 0) return

      // `link_geprueft`, not `datensatz IS NULL`: a table that turns out to
      // have no municipality breakdown leaves `datensatz` null for ever and
      // would hold its seat in every run, exactly the head-of-line blocking the
      // run queue had. Once a link has been followed it is done, whatever the
      // answer was.
      const offene = (await ankuendigungenService.readByQuery({
        filter: {
          status: { _eq: 'publiziert' },
          datensatz: { _null: true },
          link_geprueft: { _null: true },
          link: { _contains: 'statistik.bl.ch/web_portal/' }
        },
        sort: ['-datum'],
        fields: ['id', 'titel', 'link'],
        limit: budget
      })) as Array<Pick<Ankuendigung, 'id' | 'titel' | 'link'>>

      if (offene.length === 0) return

      const gemeinden = (await gemeindenService.readByQuery({
        fields: ['name'],
        limit: -1
      })) as Pick<Gemeinde, 'name'>[]

      const quelle = (
        (await quellenService.readByQuery({
          filter: { typ: { _eq: 'statbl' } },
          fields: ['id'],
          limit: 1
        })) as { id: string }[]
      )[0]

      if (quelle === undefined) {
        ergebnis.fehler.push('Quelle "Statistik BL — Tabellen" fehlt.')
        return
      }

      for (const eintrag of offene) {
        const pfad = tabellenId(eintrag.link ?? '')
        if (pfad === null) continue

        try {
          const { html } = await ladeSeite(pfad)

          // The agenda may link a branch page that only previews a child's
          // table. Registering that path would tie the entry to a page whose
          // numbers belong somewhere else.
          const besitzer = tabellenBesitzer(html, pfad)
          const seite =
            besitzer === pfad
              ? { pfad, html }
              : { pfad: besitzer, html: (await ladeSeite(besitzer)).html }

          const einordnung = ordneSeiteEin(seite.html, gemeinden, seite.pfad)

          if (!einordnung.gemeindeebene || einordnung.tabelle === null) {
            await ankuendigungenService.updateOne(eintrag.id, {
              link_geprueft: new Date().toISOString(),
              zuordnung_geprueft: new Date().toISOString(),
              zuordnung_hinweis: `Verlinkte Tabelle ${seite.pfad} hat keine Gliederung nach Gemeinde (${einordnung.treffer} von ${einordnung.bekannt} genannt).`
            })
            continue
          }

          const gelesen = einordnung.tabelle
          const gemeinsam = {
            titel: gelesen.titel,
            beschreibung: `Tabelle ${seite.pfad} auf statistik.bl.ch, Jahrgaenge ${gelesen.jahre.join(', ')}`,
            felder: tabellenFelder(gelesen),
            hat_gemeinde: true,
            gemeindefeld: GEMEINDE_SPALTE,
            letzter_stand: gelesen.jahr,
            daten_stand: gelesen.stand,
            zeilen: gelesen.zeilen.length,
            bewertung: `Relevant: aus der Agenda verlinkt (${eintrag.titel}).`
          }

          const vorhanden = (await datensaetzeService.readByQuery({
            filter: { externe_id: { _eq: seite.pfad } },
            fields: ['id'],
            limit: 1
          })) as { id: string }[]

          const datensatzId =
            vorhanden[0] === undefined
              ? ((await datensaetzeService.createOne({
                  quelle: quelle.id,
                  externe_id: seite.pfad,
                  status: 'relevant',
                  ...gemeinsam
                })) as string)
              : ((await datensaetzeService.updateOne(vorhanden[0].id, {
                  status: 'relevant',
                  ...gemeinsam
                })) as string)

          await ankuendigungenService.updateOne(eintrag.id, {
            datensatz: datensatzId,
            link_geprueft: new Date().toISOString(),
            zuordnung_geprueft: new Date().toISOString(),
            zuordnung_hinweis: `Tabelle ${seite.pfad} aus dem Agenda-Link uebernommen: ${gelesen.titel}`
          })

          ergebnis.zugeordnet += 1
          ergebnis.hinweise.push(
            `${eintrag.titel}: Tabelle ${seite.pfad} uebernommen (${gelesen.jahr})`
          )
        } catch (error) {
          // Left unmarked: a page that could not be read today is worth another
          // try tomorrow, unlike a page that was read and had no municipalities.
          const text = error instanceof Error ? error.message : String(error)
          logger.warn(`quellen-pruefen: Agenda-Tabelle ${pfad} — ${text}`)
          ergebnis.fehler.push(`${eintrag.titel}: ${text}`)
        }
      }
    }

    /**
     * Connects a published agenda entry to the portal dataset behind it.
     *
     * Only `publiziert` entries. An announced one has, by definition, no data in
     * the portal yet — matching it would point the workspace at last year's
     * numbers under this year's headline, and offer a button that writes them
     * up as news.
     *
     * The catalogue is built once and passed as a cached system prefix, so the
     * first call pays for it and the rest of the batch reads it back.
     */
    async function ordneAnkuendigungenZu(): Promise<void> {
      // Not `Math.max(zuordnungen, 0)`: the Flow in version control predates
      // this option, so the value arrives as undefined and NaN would travel all
      // the way into the query's `limit`.
      const budget =
        typeof zuordnungen === 'number' && Number.isFinite(zuordnungen)
          ? Math.max(zuordnungen, 0)
          : STANDARD_ZUORDNUNGEN
      if (budget === 0) return

      type AgendaZeile = Pick<
        Ankuendigung,
        'id' | 'titel' | 'datum' | 'quartal' | 'link' | 'datensatz'
      >

      const offene = (await ankuendigungenService.readByQuery({
        filter: {
          status: { _eq: 'publiziert' },
          datensatz: { _null: true },
          zuordnung_geprueft: { _null: true }
        },
        // Newest first: a statistic published last week is the one an editor is
        // waiting for, and the budget may not reach the end of the year.
        sort: ['-datum'],
        fields: ['id', 'titel', 'datum', 'quartal', 'link', 'datensatz'],
        limit: budget
      })) as AgendaZeile[]

      // Entries that already found their primary dataset but whose topic was
      // never opened out — everything mapped before the article was read, and
      // everything an editor assigned by hand. Their further datasets still
      // stand in the timeline as separate rows saying the same thing. Asked
      // once: the back-link on the primary is what marks a topic as expanded.
      const erweitert = new Set(
        (
          (await datensaetzeService.readByQuery({
            filter: { ankuendigung: { _nnull: true } },
            fields: ['ankuendigung'],
            limit: -1
          })) as Array<{ ankuendigung: string }>
        ).map((d) => d.ankuendigung)
      )

      const platz = Math.max(budget - offene.length, 0)
      const unerweitert =
        platz === 0
          ? []
          : (
              (await ankuendigungenService.readByQuery({
                filter: {
                  status: { _eq: 'publiziert' },
                  datensatz: { _nnull: true },
                  link: { _contains: 'webartikel' }
                },
                sort: ['-datum'],
                fields: [
                  'id',
                  'titel',
                  'datum',
                  'quartal',
                  'link',
                  'datensatz'
                ],
                limit: -1
              })) as AgendaZeile[]
            )
              .filter((e) => !erweitert.has(e.id))
              .slice(0, platz)

      const zuOrdnen = [...offene, ...unerweitert]
      if (zuOrdnen.length === 0) return

      const katalog = (await datensaetzeService.readByQuery({
        fields: ['id', 'externe_id', 'titel', 'hat_gemeinde'],
        limit: -1
      })) as KatalogEintrag[]

      if (katalog.length === 0) return

      const system = cacheableSystem(buildKatalogSystem(katalog))

      // Entries in the second group already have their primary; a run that
      // finds nothing must not take it away from them.
      const schonZugeordnet = new Set(unerweitert.map((e) => e.id))

      for (const eintrag of zuOrdnen) {
        try {
          // The office's own article, where the entry links one. Three words of
          // agenda title against 188 catalogue titles is a coin toss between
          // the three housing datasets; the article says what was counted.
          const artikel = istWebartikel(eintrag.link)
            ? await fetchWebartikel(eintrag.link as string, {
                kontakt: optionalEnv('AGENDA_KONTAKT', 'it@bajour.ch')
              }).catch((fehler) => {
                logger.info(
                  `quellen-pruefen: Webartikel zu "${eintrag.titel}" nicht gelesen (${fehler instanceof Error ? fehler.message : String(fehler)})`
                )
                return null
              })
            : null

          if (artikel !== null && artikel.text !== '') {
            // A topic routinely spans several datasets — "Bau- und
            // Wohnbaustatistik" is the new flats AND the housing stock. All of
            // them get the announcement, so the timeline shows the topic once
            // instead of the same thing three times.
            const antwort = await completeJson<unknown>({
              system,
              prompt: buildArtikelZuordnungPrompt({
                titel: eintrag.titel,
                datum: eintrag.datum,
                quartal: eintrag.quartal,
                text: artikel.text,
                tabellen: artikel.tabellen,
                suchbegriffe: artikel.suchbegriffe
              }),
              schema: ZUORDNUNG_MEHRFACH_SCHEMA,
              maxTokens: 700,
              thinking: 'disabled',
              effort: 'low',
              ...(model ? { model } : {})
            })

            const zuordnung = parseMehrfachZuordnung(antwort, katalog)
            // The primary one drives the "Meldungen erzeugen" button, so it is
            // the first that actually has municipality figures.
            const primaer =
              zuordnung.datensaetze.find((d) => d.hat_gemeinde) ??
              zuordnung.datensaetze[0] ??
              null

            await ankuendigungenService.updateOne(eintrag.id, {
              // An entry that already had one keeps it: this pass is here to
              // open the topic out, not to reopen a settled question — least
              // of all one an editor answered by hand.
              ...(primaer === null && schonZugeordnet.has(eintrag.id)
                ? {}
                : { datensatz: primaer?.id ?? null }),
              zuordnung_geprueft: new Date().toISOString(),
              zuordnung_hinweis: mehrfachHinweis(zuordnung)
            })

            const anzuhaengen =
              zuordnung.datensaetze.length > 0
                ? zuordnung.datensaetze.map((d) => d.id)
                : // Nothing found for an entry that already has its primary:
                  // link that one anyway, so the topic counts as opened and
                  // tomorrow's run does not ask again.
                  eintrag.datensatz === null
                  ? []
                  : [eintrag.datensatz]

            for (const datensatzId of anzuhaengen) {
              await datensaetzeService.updateOne(datensatzId, {
                ankuendigung: eintrag.id
              })
            }

            if (primaer !== null) ergebnis.zugeordnet += 1
            continue
          }

          const antwort = await completeJson<unknown>({
            system,
            prompt: buildZuordnungPrompt(eintrag),
            schema: ZUORDNUNG_SCHEMA,
            maxTokens: 500,
            thinking: 'disabled',
            effort: 'low',
            ...(model ? { model } : {})
          })

          const zuordnung = parseZuordnung(antwort, katalog)

          // `zuordnung_geprueft` is set either way. "We looked and found
          // nothing" has to be recorded, or every run asks the same question
          // about the same entries for the rest of the year.
          await ankuendigungenService.updateOne(eintrag.id, {
            datensatz: zuordnung.datensatz?.id ?? null,
            zuordnung_geprueft: new Date().toISOString(),
            zuordnung_hinweis: zuordnungHinweis(zuordnung)
          })

          if (zuordnung.datensatz !== null) {
            await datensaetzeService.updateOne(zuordnung.datensatz.id, {
              ankuendigung: eintrag.id
            })
            ergebnis.zugeordnet += 1
          }
        } catch (error) {
          // Left unchecked on purpose: a failed call is not an answer, and the
          // next run should ask again.
          logger.warn(
            error,
            `quellen-pruefen: Zuordnung fuer "${eintrag.titel}" uebersprungen`
          )
        }
      }
    }
  }
})
