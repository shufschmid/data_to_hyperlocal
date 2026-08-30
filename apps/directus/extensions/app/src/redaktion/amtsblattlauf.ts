import { completeChatJson, type MessageSender } from '../shared/claude'
import {
  artikelUnterlage,
  buildPlanMessages,
  parsePlanbefund,
  PLAN_SCHEMA,
  PLAN_SYSTEM_PROMPT
} from './amtsblatt'
import {
  fetchInhalt,
  fetchPlanbilder,
  type AbrufOptionen,
  type Angabe,
  type Unterlage
} from '../shared/amtsblatt'

// Filling in what the list does not carry — shared by the 07:00 run and the
// editor's button, so a publication read by hand and one read by the run end up
// identical.
//
// Two steps, deliberately separate and separately triggerable:
//   `ladeAngaben` fetches the single publication's XML — the labelled facts,
//   the deadline, the links, and the names of natural persons the article must
//   keep out.
//   `lesePlaene` looks at the drawings behind a Baselland building permit.
//
// The run does both for what the triage proposed. Everything else keeps its
// link and gets the same two steps the moment an editor asks — which is why
// they take a row, not a run.

interface ItemsServiceLike {
  readByQuery(query: Record<string, unknown>): Promise<unknown[]>
  updateOne(
    key: string,
    payload: Record<string, unknown>
  ): Promise<string | number>
}

export interface AmtsblattZeile {
  id: string
  publikations_id: string
  titel: string
  gemeinde: { id: string; name: string } | string
  angaben: Angabe[] | null
  unterlagen: Unterlage[] | null
  plan_status: string
}

export interface LaufKontext {
  meldungen: ItemsServiceLike
  logger: { warn: (e: unknown, m?: string) => void }
  abruf: AbrufOptionen
  model?: string | null
  /** Test seam, exactly as in shared/claude.ts. */
  send?: MessageSender
}

function gemeindeName(zeile: AmtsblattZeile): string {
  return typeof zeile.gemeinde === 'string' ? '' : zeile.gemeinde.name
}

/**
 * The single publication's facts onto the row.
 *
 * Fetched lazily rather than for all 18 a day: the list gives title, rubric and
 * date, which is everything the triage and the desk need. The XML is one more
 * request per publication and only worth making for one somebody will act on.
 */
export async function ladeAngaben(
  zeile: AmtsblattZeile,
  kontext: LaufKontext
): Promise<{ angaben: Angabe[]; unterlagen: Unterlage[] }> {
  const inhalt = await fetchInhalt(zeile.publikations_id, kontext.abruf)

  await kontext.meldungen.updateOne(zeile.id, {
    angaben: inhalt.angaben,
    unterlagen: inhalt.unterlagen,
    personen: inhalt.personen,
    ...(inhalt.frist === null ? {} : { frist: inhalt.frist })
  })

  return { angaben: inhalt.angaben, unterlagen: inhalt.unterlagen }
}

export interface PlanErgebnis {
  status: 'gelesen' | 'nicht_lesbar' | 'fehler'
  befunde: string[]
  fazit: string
  blaetter: number
}

/**
 * Reading the drawings.
 *
 * This is the one call in the feed that looks at evidence rather than prose,
 * and it is where a model would most readily invent a figure — so every finding
 * has to name the sheet it stood on, `parsePlanbefund` drops the ones that name
 * a sheet that does not exist, and `zahlWarnungen` later checks the article's
 * digits against exactly these strings. Opus, because reading a hatched
 * elevation is not a Sonnet job.
 *
 * Only Baselland: `bgauflage.bl.ch` publishes the sheets as plain images, which
 * is what makes this possible at all. Basel-Stadt and Solothurn keep theirs
 * behind viewers we do not read, and say so rather than returning nothing.
 */
export async function lesePlaene(
  zeile: AmtsblattZeile,
  kontext: LaufKontext
): Promise<PlanErgebnis> {
  const unterlagen = zeile.unterlagen ?? []
  const plaene = unterlagen.find((u) => u.art === 'plaene' && u.lesbar)

  if (plaene === undefined) {
    await kontext.meldungen.updateOne(zeile.id, { plan_status: 'nicht_lesbar' })
    return { status: 'nicht_lesbar', befunde: [], fazit: '', blaetter: 0 }
  }

  await kontext.meldungen.updateOne(zeile.id, { plan_status: 'liest' })

  try {
    const bilder = await fetchPlanbilder(plaene.url, kontext.abruf)
    if (bilder.length === 0) {
      await kontext.meldungen.updateOne(zeile.id, {
        plan_status: 'nicht_lesbar',
        plan_fazit: 'Die Auflageseite hat keine lesbaren Planbilder geliefert.'
      })
      return { status: 'nicht_lesbar', befunde: [], fazit: '', blaetter: 0 }
    }

    const antwort = await completeChatJson<unknown>(
      {
        system: PLAN_SYSTEM_PROMPT,
        messages: buildPlanMessages(bilder, {
          titel: zeile.titel,
          gemeinde: gemeindeName(zeile),
          angaben: zeile.angaben ?? []
        }),
        maxTokens: 4096,
        model: kontext.model ?? 'claude-opus-5',
        schema: PLAN_SCHEMA
      },
      kontext.send
    )

    const lesung = parsePlanbefund(antwort, bilder.length)
    const befunde = lesung.befunde.map(
      (b) => `${b.aussage} (Blatt ${b.blatt} von ${bilder.length})`
    )

    await kontext.meldungen.updateOne(zeile.id, {
      plan_status: 'gelesen',
      planbefunde: befunde,
      plan_fazit: lesung.fazit
    })
    return {
      status: 'gelesen',
      befunde,
      fazit: lesung.fazit,
      blaetter: bilder.length
    }
  } catch (fehler) {
    kontext.logger.warn(
      fehler,
      `Plaene zu ${zeile.publikations_id} nicht lesbar.`
    )
    await kontext.meldungen.updateOne(zeile.id, {
      plan_status: 'fehler',
      plan_fazit:
        fehler instanceof Error
          ? fehler.message.slice(0, 500)
          : 'Unbekannter Fehler'
    })
    return { status: 'fehler', befunde: [], fazit: '', blaetter: 0 }
  }
}

/**
 * Facts first, then the drawings — the order the plan reading depends on, since
 * the links only exist once the XML has been read.
 */
export async function ergaenzeZeile(
  zeile: AmtsblattZeile,
  kontext: LaufKontext
): Promise<PlanErgebnis> {
  const { angaben, unterlagen } =
    zeile.angaben === null || zeile.angaben.length === 0
      ? await ladeAngaben(zeile, kontext)
      : { angaben: zeile.angaben, unterlagen: zeile.unterlagen ?? [] }

  return lesePlaene({ ...zeile, angaben, unterlagen }, kontext)
}

/** Whether a row has something an editor could ask us to read. */
export function hatLesbareUnterlagen(zeile: AmtsblattZeile): boolean {
  return (zeile.unterlagen ?? []).some((u) => u.lesbar)
}

export { artikelUnterlage }
