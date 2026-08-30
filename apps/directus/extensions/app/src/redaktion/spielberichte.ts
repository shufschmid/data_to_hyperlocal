import { completeJson, type MessageSender } from '../shared/claude'
import {
  buildSpielberichtPrompt,
  parseSpielbericht,
  SPIELBERICHT_SYSTEM_PROMPT,
  zahlWarnungen,
  zeitWarnungen
} from './spielbericht'

// One match report per result that has none yet.
//
// Shared by the two doors on purpose: the editor's button and the 06:30 scrape
// both end up here, so a report written by hand and one written by the run are
// the same article. Written straight through rather than queued — a report is
// one model call over facts we already hold, so there is nothing to schedule,
// and it keeps the statistics queue out of it (`drain` only picks up rows it
// marked `geplant` itself).

/** How many reports one pass writes. One model call each — the run stays bounded. */
export const SPIELBERICHTE_JE_LAUF = 10

interface ItemsServiceLike {
  readByQuery(query: Record<string, unknown>): Promise<unknown[]>
  // Directus types the key as `PrimaryKey` (string | number); nothing here uses
  // the return value, so it stays as wide as the service declares it.
  createOne(payload: Record<string, unknown>): Promise<string | number>
}

export interface SpielZeile {
  id: string
  datum: string
  heim: string
  gast: string
  tore_heim: number | null
  tore_gast: number | null
  wettbewerb: string
  ort: string | null
  gemeinde: { id: string; name: string }
  verein: {
    id: string
    name: string
    liga: string | null
    notiz: string | null
  }
}

export interface SpielberichtKontext {
  spiele: ItemsServiceLike
  meldungen: ItemsServiceLike
  logger: { warn: (e: unknown, m?: string) => void }
  /** Test seam, exactly as in shared/claude.ts. */
  send?: MessageSender
}

export interface SpielberichtErgebnis {
  erzeugt: number
  /** How many results were taken on in this pass. */
  offen: number
  fehlgeschlagen: string[]
}

// Ask for the ids explicitly: requesting `gemeinde` alongside `gemeinde.name`
// yields an object carrying only the name, and the write then fails validation
// on a field that looks present.
const SPIEL_FELDER = [
  'id',
  'datum',
  'heim',
  'gast',
  'tore_heim',
  'tore_gast',
  'wettbewerb',
  'ort',
  'gemeinde.id',
  'gemeinde.name',
  'verein.id',
  'verein.name',
  'verein.liga',
  'verein.notiz'
]

/**
 * Writes a report for every result that does not have one, newest first.
 *
 * Bounded by `hoechstens`: a backlog is worked off over several passes rather
 * than in one unbounded — and expensive — run. One failing match never costs
 * the others their report.
 */
export async function schreibeSpielberichte(
  kontext: SpielberichtKontext,
  hoechstens: number = SPIELBERICHTE_JE_LAUF
): Promise<SpielberichtErgebnis> {
  const beschrieben = (await kontext.meldungen.readByQuery({
    filter: { spiel: { _nnull: true } },
    fields: ['spiel'],
    limit: -1
  })) as Array<{ spiel: string }>
  const schonBeschrieben = new Set(beschrieben.map((m) => m.spiel))

  const mitResultat = (await kontext.spiele.readByQuery({
    filter: { tore_heim: { _nnull: true } },
    fields: SPIEL_FELDER,
    sort: ['-datum'],
    limit: -1
  })) as SpielZeile[]

  const offen = mitResultat
    .filter((spiel) => !schonBeschrieben.has(spiel.id))
    .slice(0, Math.max(hoechstens, 0))

  let erzeugt = 0
  const fehlgeschlagen: string[] = []

  for (const spiel of offen) {
    try {
      // The club's own earlier results — the memory this project keeps.
      const frueher = mitResultat
        .filter(
          (a) =>
            a.verein.id === spiel.verein.id &&
            a.id !== spiel.id &&
            a.datum < spiel.datum
        )
        .slice(0, 5)
        .map((a) => ({
          datum: a.datum,
          heim: a.heim,
          gast: a.gast,
          toreHeim: a.tore_heim as number,
          toreGast: a.tore_gast as number
        }))

      const fakten = {
        heim: spiel.heim,
        gast: spiel.gast,
        toreHeim: spiel.tore_heim as number,
        toreGast: spiel.tore_gast as number,
        wettbewerb: spiel.wettbewerb,
        datum: spiel.datum,
        ort: spiel.ort,
        verein: spiel.verein.name,
        gemeinde: spiel.gemeinde.name,
        liga: spiel.verein.liga,
        notiz: spiel.verein.notiz,
        frueher
      }

      const antwort = await completeJson<unknown>(
        {
          system: SPIELBERICHT_SYSTEM_PROMPT,
          prompt: buildSpielberichtPrompt(fakten),
          maxTokens: 1200
        },
        ...(kontext.send === undefined ? [] : ([kontext.send] as const))
      )
      const bericht = parseSpielbericht(antwort)

      const ganzerText = `${bericht.titel} ${bericht.lead} ${bericht.text}`
      const warnungen = [
        ...zeitWarnungen(ganzerText),
        ...zahlWarnungen(ganzerText, fakten)
      ]

      await kontext.meldungen.createOne({
        spiel: spiel.id,
        gemeinde: spiel.gemeinde.id,
        titel: bericht.titel,
        lead: bericht.lead,
        text: bericht.text,
        status: 'entwurf',
        verarbeitung: 'idle',
        zeit_warnungen: warnungen.length > 0 ? warnungen : null,
        // Provenance, so the figures in the article can be checked against what
        // was handed over.
        datengrundlage: {
          quelle: 'matchcenter',
          heim: spiel.heim,
          gast: spiel.gast,
          tore_heim: spiel.tore_heim,
          tore_gast: spiel.tore_gast,
          wettbewerb: spiel.wettbewerb,
          datum: spiel.datum
        }
      })
      erzeugt += 1
    } catch (fehler) {
      // One bad match must not cost the others their report.
      kontext.logger.warn(
        fehler,
        `spielberichte: Bericht fuer ${spiel.heim} – ${spiel.gast} fehlgeschlagen`
      )
      fehlgeschlagen.push(`${spiel.heim} – ${spiel.gast}`)
    }
  }

  return { erzeugt, offen: offen.length, fehlgeschlagen }
}
