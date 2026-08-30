import type { Redaktionswissen } from '../types/schema'
import type { Quellenlink } from './quelle'

// Prompt building and answer validation for the two-stage generation.
//
// Stage A runs once per run and settles the angle: what is the story in this
// dataset, canton-wide. Stage B runs once per municipality and writes the
// article, and those N calls share a byte-identical system prompt so the cache
// can carry it.
//
// That is the reason for the split in this file. `buildArtikelSystemPrompt`
// takes nothing municipality-specific — not the name, not the numbers — and
// `buildArtikelUserPrompt` takes nothing else. One interpolated municipality
// name in the system half and every call pays full price with zero cache reads,
// which is invisible in the output and only shows up on the invoice.

export interface Briefing {
  jahr: string
  winkel: string
  kernaussagen: string[]
  kanton_kontext: string
  vergleichsbasis: string
}

export interface Artikel {
  titel: string
  lead: string
  text: string
}

// --- Stage A: the briefing ---------------------------------------------------

export const BRIEFING_SYSTEM_PROMPT = [
  'Du bist Redaktionsleiterin eines Lokalmediums im Kanton Basel-Landschaft.',
  'Du bekommst einen statistischen Datensatz und legst den Winkel fest, unter dem',
  'daraus je eine Meldung pro Gemeinde entsteht.',
  '',
  'Du schreibst hier noch keinen Text. Du entscheidest, was die Geschichte ist:',
  'Was faellt an den Zahlen auf? Was ist der kantonale Rahmen, vor dem eine',
  'einzelne Gemeinde eingeordnet werden muss? Woran misst man sie sinnvoll?',
  '',
  // The briefing is treated as established fact by every article of the run, so
  // anything invented here is repeated N times and reads like reporting. The
  // first version of this prompt lacked these three lines, and the model duly
  // supplied background knowledge about plastic recycling that appears nowhere
  // in the data — which then went into the articles as a statement about the
  // canton.
  'Halte dich streng an das Gegebene:',
  '- Nenne nur Zahlen, die in den kantonalen Zahlen unten stehen. Rechne nichts',
  '  aus, was sich daraus nicht direkt ergibt.',
  '- Bringe kein Fachwissen von aussen ein. Was nicht in diesen Daten steht,',
  '  gehoert nicht ins Briefing — auch nicht als Hintergrund oder Einordnung.',
  '- Jede Zahl wird mit ihrer Kategorie und Einheit genannt. Die Zahlen sind',
  '  nach Gruppen getrennt; vergleiche nie ueber Gruppen hinweg.',
  '- Wenn die Daten fuer eine Aussage nicht reichen, lass sie weg.',
  '',
  'Antworte ausschliesslich mit JSON in dieser Form:',
  '{"jahr": string, "winkel": string, "kernaussagen": string[],',
  ' "kanton_kontext": string, "vergleichsbasis": string}',
  '',
  '"jahr" ist die Periode, um die es geht, als reine Jahreszahl oder Datum.',
  '"winkel" ist ein Satz: der rote Faden aller Meldungen dieses Laufs.',
  '"kernaussagen" sind zwei bis vier Punkte, die in jeder Meldung vorkommen sollen.',
  '"kanton_kontext" nennt die kantonalen Vergleichszahlen in einem Satz.',
  '"vergleichsbasis" sagt, woran eine Gemeinde gemessen wird (z. B. Kantonsschnitt,',
  'Vorjahreswert, Bezirksschnitt).'
].join('\n')

/**
 * Shape the briefing answer must have.
 *
 * Passed as `schema` so the API guarantees valid JSON of this form rather than
 * `extractJson` having to find it in prose. Note what is *not* here: length
 * caps and content checks. JSON Schema in this mode does not support
 * `maxLength`, and business rules belong in `parseBriefing` regardless.
 */
export const BRIEFING_SCHEMA = {
  type: 'object',
  properties: {
    jahr: { type: 'string' },
    winkel: { type: 'string' },
    kernaussagen: { type: 'array', items: { type: 'string' } },
    kanton_kontext: { type: 'string' },
    vergleichsbasis: { type: 'string' }
  },
  required: [
    'jahr',
    'winkel',
    'kernaussagen',
    'kanton_kontext',
    'vergleichsbasis'
  ],
  additionalProperties: false
} as const satisfies Record<string, unknown>

export interface BriefingEingabe {
  datensatzTitel: string
  datensatzBeschreibung: string | null
  periode: string
  /** Canton-wide figures, already condensed — see `kontext.ts`. */
  kantonszahlen: string
  /** The canton's own development over the earlier periods, or null. */
  kantonsverlauf?: string | null
  /** What the editor asked this run to do, verbatim. */
  vorgabe?: string | null
  regeln: readonly Pick<Redaktionswissen, 'regel'>[]
  /** Titles and leads of what was published from this dataset before. */
  frueher: readonly { periode: string; titel: string; lead: string | null }[]
  /**
   * The office's own article about this publication, where the agenda links
   * one. Framing only — every figure still comes from the dataset.
   */
  webartikel?: string | null
}

export function buildBriefingPrompt(eingabe: BriefingEingabe): string {
  const teile = [
    `Datensatz: ${eingabe.datensatzTitel}`,
    eingabe.datensatzBeschreibung === null
      ? ''
      : `Beschreibung: ${eingabe.datensatzBeschreibung}`,
    `Periode: ${eingabe.periode}`,
    '',
    'Kantonale Zahlen:',
    eingabe.kantonszahlen
  ]

  if (
    eingabe.kantonsverlauf !== undefined &&
    eingabe.kantonsverlauf !== null &&
    eingabe.kantonsverlauf.trim() !== ''
  ) {
    teile.push(
      '',
      'Kantonale Entwicklung ueber die Perioden:',
      eingabe.kantonsverlauf
    )
  }

  // What the office itself said about this publication. It explains what was
  // counted and why it matters — the part a table cannot carry. The boundary is
  // stated outright, because an article full of cantonal figures is exactly the
  // place a municipality article could pick up a number that is not its own.
  if (
    eingabe.webartikel !== undefined &&
    eingabe.webartikel !== null &&
    eingabe.webartikel.trim() !== ''
  ) {
    teile.push(
      '',
      'Webartikel des Statistischen Amts zu dieser Publikation:',
      eingabe.webartikel.trim(),
      '',
      'Nutze ihn fuer Rahmen, Begriffe und Einordnung. Die Zahlen der Meldungen',
      'kommen ausschliesslich aus dem Datensatz — uebernimm keine Zahl aus diesem',
      'Text.'
    )
  }

  // The editor's instruction outranks the model's own idea of the story — that
  // is the whole point of typing it. It goes last so it is the freshest thing
  // in the context, and it is quoted rather than paraphrased.
  if (
    eingabe.vorgabe !== undefined &&
    eingabe.vorgabe !== null &&
    eingabe.vorgabe.trim() !== ''
  ) {
    teile.push(
      '',
      'Auftrag der Redaktion fuer diesen Lauf:',
      eingabe.vorgabe.trim(),
      '',
      'Richte den Winkel danach aus. Was der Auftrag verlangt, aber in den Zahlen',
      'nicht steht, laesst du weg und nennst es in "vergleichsbasis" — erfinde es nie.'
    )
  }

  if (eingabe.regeln.length > 0) {
    teile.push(
      '',
      'Redaktionelle Vorgaben aus frueherer Arbeit an diesem Datensatz:',
      ...eingabe.regeln.map((r) => `- ${r.regel}`)
    )
  }

  // The memory: what we already told readers about this statistic. Repeating
  // last year's angle verbatim is the failure this is meant to prevent.
  if (eingabe.frueher.length > 0) {
    teile.push(
      '',
      'Frueher aus demselben Datensatz publiziert:',
      ...eingabe.frueher.map(
        (f) =>
          `- ${f.periode}: ${f.titel}${f.lead === null ? '' : ` — ${f.lead}`}`
      ),
      '',
      'Wiederhole diesen Winkel nicht, wenn die Zahlen etwas anderes hergeben.'
    )
  }

  return teile.filter((t) => t !== '').join('\n')
}

export function parseBriefing(value: unknown): Briefing {
  const kandidat = alsObjekt(value, 'Briefing')

  return {
    jahr: pflichtText(kandidat['jahr'], 'jahr', 40),
    winkel: pflichtText(kandidat['winkel'], 'winkel', 600),
    kernaussagen: textListe(kandidat['kernaussagen'], 6, 300),
    kanton_kontext: pflichtText(
      kandidat['kanton_kontext'],
      'kanton_kontext',
      600
    ),
    vergleichsbasis: pflichtText(
      kandidat['vergleichsbasis'],
      'vergleichsbasis',
      300
    )
  }
}

// --- Stage B: one article per municipality -----------------------------------

/**
 * The half that must be identical for every municipality in a run.
 *
 * Everything here is shared: the craft rules, the lasting-validity rule, the
 * accumulated editorial knowledge, and the briefing. Nothing that varies per
 * municipality may enter this string — see the invariant test.
 */
export function buildArtikelSystemPrompt(
  briefing: Briefing,
  regeln: readonly Pick<Redaktionswissen, 'regel'>[],
  /**
   * The editor's instruction for this run. Per run, never per municipality —
   * that is what keeps this string identical across the N calls.
   */
  vorgabe?: string | null,
  /**
   * Where this run's figures can be verified. Per run like the briefing, so it
   * belongs in the cached half — and it is handed over rather than left to the
   * model, because a link is a claim about verifiability, not a phrase.
   */
  quelle?: Quellenlink | null
): string {
  const teile = [
    'Du schreibst fuer ein Lokalmedium im Kanton Basel-Landschaft eine Meldung',
    'ueber eine einzelne Gemeinde, auf Grundlage amtlicher Statistik.',
    '',
    'Handwerk:',
    '- Schreibe klassisch journalistisch: Fakt vor Deutung, keine Werbesprache,',
    '  keine Ausrufezeichen, keine rhetorischen Fragen.',
    '- Nenne jede Zahl mit ihrer Kategorie und Einheit und ordne sie ein. Eine',
    '  Zahl ohne Vergleich sagt der Leserin nichts.',
    '- Vergleiche nur Gleiches: Kilogramm pro Einwohner gegen Kilogramm pro',
    '  Einwohner derselben Kategorie. Nie ueber Kategorien oder Einheiten hinweg.',
    '- Erfinde nichts. Was nicht in den Zahlen dieser Gemeinde oder im kantonalen',
    '  Rahmen steht, steht nicht im Text — auch kein allgemeines Fachwissen ueber',
    '  das Thema, keine Erklaerung von Ursachen, keine Branchenkenntnis.',
    '- Ein Wert von null heisst, dass nichts erfasst wurde. Deute nicht, warum.',
    '- Rechne nicht selbst. Alle Vergleichswerte und Prozentangaben stehen fertig',
    '  in der Einordnung; uebernimm sie woertlich. Eine selbst gerechnete',
    '  Prozentzahl ist der Fehler, den beim Gegenlesen niemand bemerkt.',
    '- Sag pro Zahl nur eine Richtung: entweder darueber oder darunter. Wenn du',
    '  beides schreibst, ist der Satz falsch.',
    '- Nenne die Herkunft der Zahlen genau einmal, in einem natuerlichen Satz und',
    '  am besten im Lead oder im ersten Absatz: "wie das Statistische Amt',
    '  Basel-Landschaft meldet", "nach Angaben des Statistischen Amts",',
    '  "das Statistische Amt Basel-Landschaft hat neue Zahlen publiziert".',
    '  Die Leserin muss sehen, woher die Zahlen kommen.',
    '- Schreibe Schweizer Hochdeutsch: "ss" statt "ß".',
    '',
    'Der Text muss in Jahren noch stimmen:',
    '- Nenne Jahreszahlen und Daten immer ausdruecklich, etwa "im Jahr 2025".',
    '- Statt "vergangenes Jahr" schreibe die Jahreszahl.',
    '- Vermeide "aktuell", "derzeit", "momentan", "kuerzlich", "heute".',
    `- Die Meldung handelt von ${briefing.jahr}. Diese Angabe gehoert in den Text.`,
    '',
    `Winkel dieses Laufs: ${briefing.winkel}`,
    '',
    'In jeder Meldung sollen vorkommen:',
    ...briefing.kernaussagen.map((k) => `- ${k}`),
    '',
    `Kantonaler Rahmen: ${briefing.kanton_kontext}`,
    `Vergleichsbasis: ${briefing.vergleichsbasis}`
  ]

  if (regeln.length > 0) {
    teile.push(
      '',
      'Redaktionelle Vorgaben:',
      ...regeln.map((r) => `- ${r.regel}`)
    )
  }

  if (vorgabe !== undefined && vorgabe !== null && vorgabe.trim() !== '') {
    teile.push(
      '',
      'Auftrag der Redaktion fuer diese Meldung:',
      vorgabe.trim(),
      '',
      'Der Auftrag sagt, worum es geht — die Regeln oben sagen, was du dabei nicht',
      'darfst. Fehlt eine verlangte Zahl in den Daten dieser Gemeinde, schreibe',
      'stattdessen, dass sie nicht vorliegt.'
    )
  }

  // Asked for a source without being given one, the model wrote
  // `<a href="https://www.statistik.bl.ch">…</a>` — plausible, generic, and the
  // source of nothing. So the address is dictated here, and `quelle.ts` forces
  // it afterwards.
  if (quelle !== undefined && quelle !== null) {
    teile.push(
      '',
      'Quellenangabe — Pflicht in jeder Meldung:',
      `- Nenne ${quelle.bezeichnung} genau einmal im Fliesstext, in einem`,
      '  natuerlichen Satz ("wie das Statistische Amt Basel-Landschaft meldet",',
      '  "Das Statistische Amt hat neue Zahlen publiziert").',
      `- Verlinke dabei GENAU diese Adresse: <a href="${quelle.url}">…</a>`,
      '- Der verlinkte Teil ist die Erwaehnung des Amts, nicht das ganze Wort',
      '  "hier" und nicht der ganze Absatz.',
      '- Erfinde KEINE andere Adresse und nenne sonst keine URL. Genau ein Link.',
      quelle.webartikel
        ? '- Die Adresse fuehrt auf den Webartikel des Amts zu dieser Statistik.'
        : '- Die Adresse fuehrt auf den Datensatz, aus dem die Zahlen stammen.'
    )
  }

  teile.push(
    '',
    'Antworte ausschliesslich mit JSON in dieser Form:',
    '{"titel": string, "lead": string, "text": string}',
    '',
    '"titel" ist eine Zeile, hoechstens 90 Zeichen, nennt die Gemeinde.',
    '"lead" ist ein Anreisser von ein bis zwei Saetzen.',
    '"text" ist der Fliesstext, drei bis sechs Absaetze, durch Leerzeilen getrennt.'
  )

  return teile.join('\n')
}

/**
 * Shape an article answer must have.
 *
 * This is the one that earns its keep: a German article body carries
 * quotation marks, dashes and newlines, and the "first `{` to last `}`"
 * heuristic lost a complete generated article to a parse error before this
 * existed.
 */
export const ARTIKEL_SCHEMA = {
  type: 'object',
  properties: {
    titel: { type: 'string' },
    lead: { type: 'string' },
    text: { type: 'string' }
  },
  required: ['titel', 'lead', 'text'],
  additionalProperties: false
} as const satisfies Record<string, unknown>

export interface ArtikelEingabe {
  gemeinde: string
  bezirk: string
  /** This municipality's rows, condensed — see `kontext.ts`. */
  zahlen: string
  /** Earlier periods for this municipality, or null when there are none. */
  verlauf?: string | null
  /** How it sits against the comparison basis. */
  einordnung: string
  /** What we wrote about this municipality from this dataset before. */
  frueherText: string | null
  /** Set on a retry: what was wrong with the previous attempt. */
  korrektur?: string
}

export function buildArtikelUserPrompt(eingabe: ArtikelEingabe): string {
  const teile = [
    `Gemeinde: ${eingabe.gemeinde} (Bezirk ${eingabe.bezirk})`,
    '',
    'Zahlen dieser Gemeinde:',
    eingabe.zahlen,
    '',
    `Einordnung: ${eingabe.einordnung}`
  ]

  if (
    eingabe.verlauf !== undefined &&
    eingabe.verlauf !== null &&
    eingabe.verlauf.trim() !== ''
  ) {
    teile.push(
      '',
      'Entwicklung dieser Gemeinde ueber die Perioden:',
      eingabe.verlauf,
      '',
      'Diese Werte stehen fertig da. Nenne sie mit ihrer Jahreszahl und rechne',
      'keine Veraenderungsraten aus.'
    )
  }

  if (eingabe.frueherText !== null && eingabe.frueherText.trim() !== '') {
    teile.push(
      '',
      'Frueher ueber diese Gemeinde aus demselben Datensatz publiziert:',
      eingabe.frueherText,
      '',
      'Formuliere neu; wiederhole keine ganzen Saetze daraus.'
    )
  }

  if (eingabe.korrektur !== undefined && eingabe.korrektur.trim() !== '') {
    teile.push('', `Korrektur zum vorherigen Versuch: ${eingabe.korrektur}`)
  }

  return teile.join('\n')
}

const MAX_TITEL = 120
const MAX_LEAD = 400
const MAX_TEXT = 6000

export function parseArtikel(value: unknown): Artikel {
  const kandidat = alsObjekt(value, 'Artikel')

  return {
    titel: pflichtText(kandidat['titel'], 'titel', MAX_TITEL),
    lead: pflichtText(kandidat['lead'], 'lead', MAX_LEAD),
    text: pflichtText(kandidat['text'], 'text', MAX_TEXT)
  }
}

/**
 * Maps a validated article onto the collection's columns.
 *
 * One place, shared by the queue and by any future caller, so two writers
 * cannot drift into storing the same thing differently — the `summaryFields`
 * pattern from the template's example.
 */
export function artikelFelder(
  artikel: Artikel,
  zeitWarnungen: readonly string[]
): {
  titel: string
  lead: string
  text: string
  zeit_warnungen: string[]
} {
  return {
    titel: artikel.titel,
    lead: artikel.lead,
    text: artikel.text,
    zeit_warnungen: [...zeitWarnungen]
  }
}

// --- shared validation -------------------------------------------------------

function alsObjekt(value: unknown, was: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`Claude-Antwort fuer ${was} ist kein Objekt.`)
  }
  return value as Record<string, unknown>
}

function pflichtText(value: unknown, feld: string, max: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Claude-Antwort enthaelt kein brauchbares Feld "${feld}".`)
  }
  return value.trim().slice(0, max)
}

function textListe(
  value: unknown,
  maxAnzahl: number,
  maxLaenge: number
): string[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((eintrag): eintrag is string => typeof eintrag === 'string')
    .map((eintrag) => eintrag.trim().slice(0, maxLaenge))
    .filter((eintrag) => eintrag !== '')
    .slice(0, maxAnzahl)
}
