import { defineOperationApi } from '@directus/extensions-sdk'
import { defaultFetch } from '../../shared/ods'
import {
  bundFuer,
  liesBund,
  liesAbstimmungen,
  liesGemeindezahlen,
  liesVework,
  liesVorherigesDatum,
  waehleZeilen,
  type Abstimmungszeile,
  type BundVorlage,
  type Leseergebnis
} from '../../shared/abstimmung'
import { ladeRegeln } from '../../redaktion/gedaechtnis'
import { schreibeTagesmeldungen } from '../../redaktion/abstimmungsmeldungen'
import { heuteIso } from '../../redaktion/feiertage'
import {
  gemeindeStand,
  gruppiereNachVorlage,
  laufBilanz,
  vergleichAus,
  zeilenfelder
} from '../../redaktion/abstimmunglauf'
import type { Abstimmung, Gemeinde, Quelle } from '../../types/schema'

// The Sunday afternoon of a vote day, and nothing else.
//
// Every other feed here is watched daily, because a source publishes when it
// likes. A ballot does not: the day is known months in advance, the figures
// appear between noon and the early evening, and by Monday morning — when the
// catalogue watcher runs — the result has been told everywhere else. So this
// is a Flow of its own with a tight window, and outside it nothing changes.
//
// **The first check is whether there is anything at all, and it is one
// request.** A run on a Sunday without a ballot asks the portal for today's
// rows, gets an empty list and stops. That is the whole cost. Two more
// requests follow only once per vote day, for the previous ballot's turnout,
// and never again — an earlier day's figures cannot move.
//
// **No model is called here, and no article is written.** The run collects and
// says how far the counting has got. Whether a Meldung comes of it is a
// person's click, as at every other desk — and a vote result is the worst
// imaginable place for an article nobody looked at.

interface Optionen {
  /** How many Vorlagen one run may write. A vote day carries a handful. */
  hoechstens?: number | null
  /** Overrides today — for a run made up after the fact. */
  datum?: string | null
}

interface Ergebnis {
  datum: string
  /** Sources walked — one per active portal that names a votes dataset. */
  quellen: number
  /** Active portals without a dataset in their configuration. Named, not logged. */
  ohneDatensatz: string[]
  vorlagen: number
  /** Summary drafts written by this run. */
  meldungen: number
  gemeindenAusgezaehlt: number
  gemeindenOffen: number
  /** German sentences: counting in progress is not an error and must not read like one. */
  hinweise: string[]
  fehler: string[]
}

function fehlerText(error: unknown): string {
  return error instanceof Error ? error.message : 'Unbekannter Fehler'
}

/**
 * The canton's live publication of a vote day, where a portal has one —
 * `konfiguration.abstimmungen_live`, set by `migrations/20260927B` on
 * data.bl.ch. A row like the dataset beside it, never a constant.
 */
function liveAus(konfiguration: unknown): string | null {
  if (typeof konfiguration !== 'object' || konfiguration === null) return null
  const wert = (konfiguration as Record<string, unknown>)['abstimmungen_live']
  return typeof wert === 'string' && /^https:\/\//.test(wert.trim())
    ? wert.trim().replace(/\/$/, '')
    : null
}

/** The Bund's vote-day files, where a portal names them (`konfiguration.abstimmungen_bund`). */
function bundAus(konfiguration: unknown): string | null {
  if (typeof konfiguration !== 'object' || konfiguration === null) return null
  const wert = (konfiguration as Record<string, unknown>)['abstimmungen_bund']
  return typeof wert === 'string' && /^https:\/\//.test(wert.trim())
    ? wert.trim().replace(/\/$/, '')
    : null
}

/**
 * Whether the day is ready for the drafts: every covered municipality counted
 * in every Vorlage, and the Bund final for each federal one — or the last
 * scheduled run of the evening, when a draft without the national yardstick
 * is better than none for the Monday briefing.
 */
export function tagBereit(eingabe: {
  unsereBfs: readonly string[]
  stand: ReadonlyArray<{ bfs: string; ausgezaehlt: boolean }>
  bundOffen: number
  letzterLauf: boolean
}): boolean {
  const unsere = eingabe.stand.filter((s) => eingabe.unsereBfs.includes(s.bfs))
  if (unsere.length === 0 || unsere.some((s) => !s.ausgezaehlt)) return false
  return eingabe.bundOffen === 0 || eingabe.letzterLauf
}

/** The dataset a portal carries its votes in — a row, never a constant. */
function datensatzAus(konfiguration: unknown): string | null {
  if (typeof konfiguration !== 'object' || konfiguration === null) return null
  const wert = (konfiguration as Record<string, unknown>)['abstimmungen']
  return typeof wert === 'string' && wert.trim() !== '' ? wert.trim() : null
}

export default defineOperationApi<Optionen>({
  id: 'abstimmungen-holen',
  handler: async (optionen, { services, getSchema, logger }) => {
    const { ItemsService } = services
    const schema = await getSchema()

    const hoechstens = Math.max(1, optionen.hoechstens ?? 20)
    const datum = optionen.datum ?? heuteIso()

    // A scheduled Flow has no user, so these services run as the system.
    const quellenService = new ItemsService('quellen', { schema })
    const gemeindenService = new ItemsService('gemeinden', { schema })
    const abstimmungenService = new ItemsService('abstimmungen', { schema })

    const ergebnis: Ergebnis = {
      datum,
      quellen: 0,
      ohneDatensatz: [],
      meldungen: 0,
      vorlagen: 0,
      gemeindenAusgezaehlt: 0,
      gemeindenOffen: 0,
      hinweise: [],
      fehler: []
    }

    const quellen = (await quellenService.readByQuery({
      filter: { aktiv: { _eq: true }, typ: { _eq: 'ods' } },
      fields: ['id', 'name', 'typ', 'basis_url', 'konfiguration'],
      limit: 50
    })) as Array<
      Pick<Quelle, 'id' | 'name' | 'typ' | 'basis_url' | 'konfiguration'>
    >

    // The newsroom's own municipalities. The other 76 of the canton are read
    // too — they are the cantonal comparison — but only these get a row of
    // their own and a button.
    const gemeinden = (await gemeindenService.readByQuery({
      filter: { aktiv: { _eq: true } },
      fields: ['id', 'name', 'bfs_nummer'],
      limit: -1
    })) as Array<Pick<Gemeinde, 'id' | 'name' | 'bfs_nummer'>>

    const unsere = gemeinden.map((gemeinde) => ({
      bfs: String(gemeinde.bfs_nummer),
      name: gemeinde.name
    }))

    for (const quelle of quellen) {
      const datensatz = datensatzAus(quelle.konfiguration)
      if (datensatz === null) {
        ergebnis.ohneDatensatz.push(quelle.name)
        continue
      }

      ergebnis.quellen += 1

      try {
        await holeQuelle(
          quelle,
          datensatz,
          liveAus(quelle.konfiguration),
          bundAus(quelle.konfiguration)
        )
      } catch (error) {
        // One unreachable portal must not stop the others.
        logger.error(error, `abstimmungen-holen: ${quelle.name} fehlgeschlagen`)
        ergebnis.fehler.push(`${quelle.name}: ${fehlerText(error)}`)
      }
    }

    return ergebnis

    async function holeQuelle(
      quelle: Pick<Quelle, 'id' | 'name' | 'basis_url'>,
      datensatz: string,
      live: string | null,
      bundBasis: string | null
    ): Promise<void> {
      // The one request of an ordinary Sunday. No rows for today means no
      // ballot today, and the run is over.
      const portal = await liesAbstimmungen(
        quelle.basis_url,
        datensatz,
        datum,
        defaultFetch
      )

      // The canton's live publication, where the portal names one: it carries
      // the figures hours — or a day — before the portal does (measured
      // 27.09.2026: final at 14:02 there, all 430 portal rows still open).
      // Asked only on a day the portal knows as a vote day, and a failure is
      // said and costs nothing: the portal's rows stand.
      let liveGelesen: Leseergebnis | null = null
      if (live !== null && portal.zeilen.length > 0) {
        try {
          liveGelesen = await liesVework(live, datum, defaultFetch)
        } catch (error) {
          ergebnis.hinweise.push(
            `${quelle.name}: die Live-Publikation des Kantons konnte nicht gelesen werden (${fehlerText(error)}) — es gelten die Zeilen des Portals.`
          )
        }
      }
      const { gelesen, quelle: tuer } = waehleZeilen(portal, liveGelesen)
      if (tuer === 'live')
        ergebnis.hinweise.push(
          `${quelle.name}: Resultate aus der Live-Publikation des Kantons (${new URL(live ?? 'https://abstimmungen.bl.ch').host}) — das Portal fuehrt sie noch nicht.`
        )

      if (gelesen.zeilen.length === 0) {
        ergebnis.hinweise.push(
          `${quelle.name}: keine Abstimmung am ${datum} — ein Abruf, nichts zu tun.`
        )
        return
      }

      const stand = gemeindeStand(gelesen.zeilen)
      const bilanz = laufBilanz(datum, stand)
      ergebnis.gemeindenAusgezaehlt += bilanz.ausgezaehlt
      ergebnis.gemeindenOffen += bilanz.offen
      ergebnis.hinweise.push(`${quelle.name}: ${bilanz.satz}`)

      const vorlagen = gruppiereNachVorlage(gelesen.zeilen)
      if (vorlagen.length > hoechstens) {
        ergebnis.hinweise.push(
          `${quelle.name}: ${hoechstens} von ${vorlagen.length} Vorlagen geschrieben (Deckel ${hoechstens}), der Rest beim naechsten Lauf.`
        )
      }

      const jetzt = new Date().toISOString()
      const vergleich = await holeVergleich(quelle, datensatz)

      // The Bund's outcome of the federal Vorlagen — only whether each was
      // accepted, the yardstick of «anders als die Schweiz». A failure is said
      // and costs the comparison, never the day.
      let bund: BundVorlage[] | null = null
      if (bundBasis !== null && vorlagen.some((v) => v.ebene === 'bund')) {
        try {
          bund = await liesBund(bundBasis, datum, defaultFetch)
        } catch (error) {
          ergebnis.hinweise.push(
            `${quelle.name}: das Ergebnis des Bundes konnte nicht gelesen werden (${fehlerText(error)}) — der Vergleich mit der Schweiz fehlt.`
          )
        }
      }
      let bundOffen = 0

      for (const vorlage of vorlagen.slice(0, hoechstens)) {
        const vorhandene = (await abstimmungenService.readByQuery({
          filter: { vote_id: { _eq: vorlage.voteId } },
          fields: ['id', 'vergleich'],
          limit: 1
        })) as Array<Pick<Abstimmung, 'id' | 'vergleich'>>

        const felder = zeilenfelder({
          vorlage,
          alleZeilen: gelesen.zeilen,
          gemeinden: unsere,
          stand: jetzt,
          hinweise: gelesen.verworfen,
          // Asked once per vote day: an earlier ballot's turnout cannot move.
          vergleich:
            vorhandene[0]?.vergleich === undefined ||
            vorhandene[0]?.vergleich === null
              ? vergleich
              : null
        })

        if (vorlage.ebene === 'bund') {
          const eigene = bund === null ? null : bundFuer(vorlage.titel, bund)
          if (eigene === null || !eigene.beendet) bundOffen += 1
          if (bund !== null && eigene === null)
            ergebnis.hinweise.push(
              `${quelle.name}: «${vorlage.titel}» steht nicht im Ergebnis des Bundes — kein Vergleich mit der Schweiz.`
            )
          felder['bund'] =
            eigene === null
              ? null
              : { angenommen: eigene.angenommen, beendet: eigene.beendet }
        }

        const bestehende = vorhandene[0]
        if (bestehende === undefined) {
          await abstimmungenService.createOne(felder)
        } else {
          await abstimmungenService.updateOne(bestehende.id, felder)
        }
        ergebnis.vorlagen += 1
      }

      // The drafts, once the day is there: one summary per covered
      // municipality (the newsroom's words of 27 September 2026 — the
      // newsroom fetches the data itself, and when it is there it generates
      // the proposals). Ready means every covered municipality counted and the
      // Bund final; the evening's last run writes without the Bund rather
      // than leaving the Monday briefing empty.
      const stunde = Number(
        new Intl.DateTimeFormat('de-CH', {
          timeZone: 'Europe/Zurich',
          hour: '2-digit',
          hour12: false
        }).format(new Date())
      )
      const bereit = tagBereit({
        unsereBfs: unsere.map((g) => g.bfs),
        stand,
        bundOffen,
        letzterLauf: stunde >= 20
      })
      if (!bereit) {
        ergebnis.hinweise.push(
          `${quelle.name}: Meldungsvorschlaege folgen, sobald alle bespielten Gemeinden ausgezaehlt${bundOffen > 0 ? ' und der Bund final' : ''} ist.`
        )
        return
      }
      const regeln = (
        await ladeRegeln(
          new ItemsService('redaktionswissen', { schema }),
          { bereich: 'abstimmung', stufe: 'text' },
          { warn: (m: string) => logger.warn(m) }
        )
      ).map((r) => r.regel)
      const geschrieben = await schreibeTagesmeldungen(
        {
          abstimmungen: abstimmungenService,
          gemeinden: gemeindenService,
          meldungen: new ItemsService('meldungen', { schema }),
          regeln
        },
        datum,
        gemeinden
      )
      ergebnis.meldungen += geschrieben.geschrieben.length
      if (geschrieben.geschrieben.length > 0)
        ergebnis.hinweise.push(
          `${quelle.name}: ${geschrieben.geschrieben.length} Meldungsvorschlaege geschrieben (${geschrieben.geschrieben.join(', ')}).`
        )
      if (geschrieben.wartend > 0)
        ergebnis.hinweise.push(
          `${quelle.name}: ${geschrieben.wartend} warten auf den naechsten Lauf (Deckel).`
        )
      for (const f of geschrieben.fehler)
        ergebnis.fehler.push(`${quelle.name}: ${f}`)
    }

    /**
     * The previous ballot's turnout in our municipalities — two requests, once.
     *
     * Only asked when at least one Vorlage of this day does not carry it yet,
     * and the caller decides per row whether to write it. A failure here costs
     * a comparison, never the run: the result of the day is the story.
     */
    async function holeVergleich(
      quelle: Pick<Quelle, 'name' | 'basis_url'>,
      datensatz: string
    ): Promise<ReturnType<typeof vergleichAus>> {
      try {
        const vorher = await liesVorherigesDatum(
          quelle.basis_url,
          datensatz,
          datum,
          defaultFetch
        )
        if (vorher === null) return null

        const zahlen = await liesGemeindezahlen(
          quelle.basis_url,
          datensatz,
          vorher,
          unsere.map((gemeinde) => gemeinde.bfs),
          defaultFetch
        )

        return vergleichAus(
          vorher,
          zahlen.zeilen as Abstimmungszeile[],
          unsere.map((gemeinde) => gemeinde.bfs)
        )
      } catch (error) {
        ergebnis.hinweise.push(
          `${quelle.name}: die letzte Abstimmung davor konnte nicht gelesen werden (${fehlerText(error)}). Der Vergleich fehlt, die Zahlen des Tages stehen.`
        )
        return null
      }
    }
  }
})
