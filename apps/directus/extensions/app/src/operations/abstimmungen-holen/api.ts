import { defineOperationApi } from '@directus/extensions-sdk'
import { defaultFetch } from '../../shared/ods'
import {
  liesAbstimmungen,
  liesGemeindezahlen,
  liesVorherigesDatum,
  type Abstimmungszeile
} from '../../shared/abstimmung'
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
  gemeindenAusgezaehlt: number
  gemeindenOffen: number
  /** German sentences: counting in progress is not an error and must not read like one. */
  hinweise: string[]
  fehler: string[]
}

function fehlerText(error: unknown): string {
  return error instanceof Error ? error.message : 'Unbekannter Fehler'
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
        await holeQuelle(quelle, datensatz)
      } catch (error) {
        // One unreachable portal must not stop the others.
        logger.error(error, `abstimmungen-holen: ${quelle.name} fehlgeschlagen`)
        ergebnis.fehler.push(`${quelle.name}: ${fehlerText(error)}`)
      }
    }

    return ergebnis

    async function holeQuelle(
      quelle: Pick<Quelle, 'id' | 'name' | 'basis_url'>,
      datensatz: string
    ): Promise<void> {
      // The one request of an ordinary Sunday. No rows for today means no
      // ballot today, and the run is over.
      const gelesen = await liesAbstimmungen(
        quelle.basis_url,
        datensatz,
        datum,
        defaultFetch
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

        const bestehende = vorhandene[0]
        if (bestehende === undefined) {
          await abstimmungenService.createOne(felder)
        } else {
          await abstimmungenService.updateOne(bestehende.id, felder)
        }
        ergebnis.vorlagen += 1
      }
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
