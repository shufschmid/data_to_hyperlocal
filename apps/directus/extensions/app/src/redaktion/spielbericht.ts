// The prompt for a match report, and the checks that hold it to the facts.
//
// A match report is the shortest article this newsroom writes and the easiest
// to get wrong: the score is the whole point, and a reversed or invented one is
// worse than no article. So the model is given the figures and forbidden to
// derive any — the same rule `zahlen.ts` enforces for statistics.
//
// The tense matters as much as the figures. `zeitbezug.ts` exists because these
// articles must still read correctly in five years, and a match report is the
// worst offender: "am Samstag", "letzte Runde", "nächste Woche" all rot within
// days. The prompt demands absolute dates and the check below catches the rest.

/** The association page a report points at, and how the source line names it. */
export interface SpielQuelle {
  name: string
  url: string
}

export interface SpielFakten {
  heim: string
  gast: string
  toreHeim: number
  toreGast: number
  wettbewerb: string
  /** ISO instant of kick-off. */
  datum: string
  ort: string | null
  /** The club this report is written for — the local angle. */
  verein: string
  gemeinde: string
  liga: string | null
  /** Why the club matters locally, in the newsroom's own words. */
  notiz: string | null
  /** Where a reader can see the result for themselves. Null only if we have no address. */
  quelle: SpielQuelle | null
  /** Earlier results of the same club this season, newest first. */
  frueher: ReadonlyArray<{
    datum: string
    heim: string
    gast: string
    toreHeim: number
    toreGast: number
  }>
}

export const SPIELBERICHT_SYSTEM_PROMPT = `Du schreibst kurze Spielberichte fuer eine lokale Redaktion in der Region Basel.

Regeln, ohne Ausnahme:
- Schreibe NUR, was in den Angaben steht. Erfinde nichts: keine Torschuetzen, keine
  Spielminuten, keine Zuschauerzahlen, keine Stimmen, keinen Spielverlauf.
- Uebernimm das Resultat exakt und in Spielrichtung: Heimteam zuerst.
- Rechne nichts aus, was nicht dasteht. Keine Tabellenplaetze, keine Punktzahlen,
  keine Torbilanzen.
- Nenne Daten absolut ("am 19. August 2026"), niemals relativ ("am Samstag",
  "letzte Woche", "kuerzlich"). Der Text muss in fuenf Jahren noch stimmen.
- Schreibe aus der Sicht der Gemeinde, ohne Vereinsjargon und ohne Fanton.
- Schweizer Rechtschreibung: "ss" statt "ß".
- Schreibe KEINE Links und keine Webadressen. Die Quelle wird unter den Text
  gesetzt, das ist nicht deine Aufgabe.

Umfang: Titel (maximal 70 Zeichen), dann EIN einziger Absatz mit drei bis
fuenf kurzen Saetzen. Kein Lead und keine Zwischentitel — ein Spielbericht ist
hier eine kurze Notiz, kein Artikel.

Antworte ausschliesslich mit JSON:
{"titel": "...", "text": "..."}`

/** Formats an ISO instant as the Swiss long date the prompt must use. */
export function absolutesDatum(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('de-CH', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Zurich'
  })
}

function ausgang(fakten: SpielFakten): string {
  const heimIstUnser = fakten.heim.startsWith(fakten.verein)
  const eigene = heimIstUnser ? fakten.toreHeim : fakten.toreGast
  const fremde = heimIstUnser ? fakten.toreGast : fakten.toreHeim
  if (eigene > fremde) return `${fakten.verein} hat gewonnen.`
  if (eigene < fremde) return `${fakten.verein} hat verloren.`
  return `Die Partie endete unentschieden.`
}

/**
 * Everything known about one match, as plain lines — shared by the first write
 * and every revision, so the two cannot drift apart.
 *
 * The outcome is stated outright rather than left to be inferred from the two
 * numbers: deciding who won means knowing which side the club played on, and
 * that is arithmetic the model should not be doing.
 */
function faktenZeilen(fakten: SpielFakten): string[] {
  const zeilen = [
    `Gemeinde: ${fakten.gemeinde}`,
    `Verein, um den es geht: ${fakten.verein}`,
    fakten.liga === null ? null : `Liga: ${fakten.liga}`,
    fakten.notiz === null ? null : `Bedeutung des Vereins: ${fakten.notiz}`,
    '',
    `Wettbewerb: ${fakten.wettbewerb}`,
    `Datum: ${absolutesDatum(fakten.datum)}`,
    fakten.ort === null ? null : `Ort: ${fakten.ort}`,
    `Heim: ${fakten.heim}`,
    `Gast: ${fakten.gast}`,
    `Resultat: ${fakten.toreHeim}:${fakten.toreGast} (Heim:Gast)`,
    ausgang(fakten)
  ].filter((z): z is string => z !== null)

  if (fakten.frueher.length > 0) {
    // Labelled as the selection it is: from "the last five" the model cannot
    // derive season totals ("erst der fuenfte Sieg") — from an unlabelled list
    // it silently might.
    zeilen.push('', 'Frueher in dieser Saison (nur die letzten 5 Resultate):')
    for (const f of fakten.frueher.slice(0, 5)) {
      zeilen.push(
        `- ${absolutesDatum(f.datum)}: ${f.heim} ${f.toreHeim}:${f.toreGast} ${f.gast}`
      )
    }
  }

  return zeilen
}

/**
 * Whether the result is genuinely all we know.
 *
 * No league, no note on what the club means to the place, no earlier matches to
 * put it against: everything the system prompt asks for — context, meaning,
 * a line of development — has nothing to draw on. Padding a bare 2:2 out to
 * three paragraphs can only be done by inventing, so the length shrinks with
 * the facts instead.
 */
export function nurDasResultat(fakten: SpielFakten): boolean {
  return (
    fakten.liga === null && fakten.notiz === null && fakten.frueher.length === 0
  )
}

export function buildSpielberichtPrompt(fakten: SpielFakten): string {
  return [
    ...faktenZeilen(fakten),
    '',
    // In the USER turn, never in the system prompt: that one has to stay
    // byte-identical across a run for the prompt cache, and the revision path
    // reuses it unchanged.
    ...(nurDasResultat(fakten)
      ? [
          'Mehr als das Resultat ist nicht bekannt. Halte dich deshalb SEHR kurz:',
          'zwei bis drei Saetze. Kein Ausschmuecken, keine Vermutungen ueber',
          'Spielverlauf, Tragweite oder Tabellenstand.',
          ''
        ]
      : []),
    'Schreibe den Spielbericht. Verwende ausschliesslich diese Angaben.'
  ].join('\n')
}

/**
 * A revision: the same facts, the previous text, and what the editor wants
 * different.
 *
 * The system prompt stays byte-identical to the first write — the rules do not
 * change because the editor asked for a revision, and that identity is what the
 * prompt cache carries. The facts are repeated in full so the model rewrites
 * from the source, not from its own previous prose.
 */
export function buildSpielberichtRevision(
  fakten: SpielFakten,
  bisher: { titel: string | null; lead: string | null; text: string | null },
  anweisung: string
): string {
  return [
    ...faktenZeilen(fakten),
    '',
    'Bisheriger Bericht:',
    `Titel: ${bisher.titel ?? ''}`,
    // Older reports carried a lead; hand it over as material so nothing is
    // lost, but the answer follows today's shape — one paragraph, no lead.
    ...(bisher.lead === null || bisher.lead.trim() === ''
      ? []
      : [`Lead: ${bisher.lead}`]),
    bisher.text ?? '',
    '',
    'Anweisung der Redaktion:',
    anweisung,
    '',
    'Schreibe den Spielbericht neu. Setze die Anweisung um, aber verwende weiterhin ausschliesslich die Angaben oben.'
  ].join('\n')
}

// ---------------------------------------------------------------------------
// The source line — built here, never written by the model
// ---------------------------------------------------------------------------

/**
 * How each connector's association is named in the running text.
 *
 * Keyed on `vereine.quelle`, the same value that decides which connector reads
 * the club, so a source cannot be read from one place and credited to another.
 */
const VERBAND: Readonly<Record<string, string>> = {
  fvnws: 'Fussballverband Nordwestschweiz',
  swissvolley: 'Swiss Volley',
  handball: 'Swiss Handball'
}

export function verbandsName(quelle: string | null): string {
  return VERBAND[quelle ?? ''] ?? 'Verbandsseite'
}

/**
 * The page the report points at — the club's own results page where there is
 * one, the page the fixture was read from otherwise.
 *
 * The order is not a preference. For football `spiele.quelle_url` is the
 * association's "what's on" page, and that page only looks FORWARD: a week
 * after the match it no longer carries it, so a reader following the link would
 * find everything except the result they came for. The club page keeps it —
 * it is where the score is read back from in the first place. For volleyball
 * and handball the two addresses are the same anyway, one page per team.
 */
export function verbandsQuelle(
  verein: { quelle: string | null; ergebnis_url: string | null },
  fixtureUrl: string | null
): SpielQuelle | null {
  const url = (verein.ergebnis_url ?? fixtureUrl ?? '').trim()
  if (url === '') return null
  return { name: verbandsName(verein.quelle), url }
}

/**
 * The source line, appended by code — never left to the model.
 *
 * Same division of labour as the press review and the gazette: the prompt owns
 * the prose, the code owns the URL. `quelle.ts` has the lesson on record —
 * asked for a link without being given one, a model answers with the bare host,
 * which is the source of nothing.
 *
 * Null only where we genuinely hold no address; better no line than a made-up
 * one. The status hook is what stops such a report from being published.
 */
export function quelleZeile(fakten: SpielFakten): string | null {
  if (fakten.quelle === null) return null
  return `Quelle: ${fakten.quelle.name}, ${fakten.quelle.url}`
}

/** Model text plus the deterministic source line — shared by write and revision. */
export function mitQuelle(text: string, fakten: SpielFakten): string {
  const zeile = quelleZeile(fakten)
  if (zeile === null) return text.trim()
  return `${text.trim()}\n\n${zeile}`
}

/** The line `mitQuelle` appends, as a trailing paragraph of its own. */
const QUELLENZEILE = /\n{2,}Quelle: [^\n]*$/

/**
 * The stored report without the line the code put under it.
 *
 * A revision hands the model its own earlier text back, and that text already
 * carries the source line. Left in, the model copies it into the new draft,
 * `linkWarnungen` flags the copy as an address it invented, and `mitQuelle`
 * appends a second one below it. So the line comes off before the prompt is
 * built and goes back on after — it belongs to the code at every point, never
 * to the model.
 */
export function ohneQuelle(text: string | null): string | null {
  if (text === null) return null
  return text.replace(QUELLENZEILE, '').trimEnd()
}

/** Any http(s) address, the same shape `quelle.ts` looks for. */
const ADRESSE = /https?:\/\/[^\s"'<>)]+/gi

/**
 * An address the model wrote itself.
 *
 * There is exactly one legitimate link in a match report and the code puts it
 * there. Anything else is invention — run BEFORE `mitQuelle` appends, so the
 * appended address is never mistaken for the model's own.
 */
export function linkWarnungen(text: string): string[] {
  const gefunden = [...text.matchAll(ADRESSE)].map((t) => t[0])
  return [...new Set(gefunden)].map(
    (adresse) => `Der Text nennt selbst eine Adresse: ${adresse}`
  )
}

/**
 * The full three-part article shape — NOT the match report's.
 *
 * The press review, the gazette and the broadcast feed all answer with
 * titel/lead/text and re-export this parser under their own names; it lives
 * here only because the match report had it first. The match report itself has
 * moved on to the two-part shape below.
 */
export interface Meldungstext {
  titel: string
  lead: string
  text: string
}

export function parseMeldungstext(antwort: unknown): Meldungstext {
  const roh = alsObjekt(antwort)
  return {
    titel: feld(roh, 'titel'),
    lead: feld(roh, 'lead'),
    text: feld(roh, 'text')
  }
}

/** A match report is a short notice: a title and one paragraph, no lead. */
export interface Spielbericht {
  titel: string
  text: string
}

/**
 * The model's answer is a promise, not a proof — never trust its shape.
 *
 * A `lead` in the answer is ignored rather than rejected: the shape used to
 * have one, and a model that slips back into it should cost a field, not the
 * whole report.
 */
export function parseSpielbericht(antwort: unknown): Spielbericht {
  const roh = alsObjekt(antwort)
  return { titel: feld(roh, 'titel'), text: feld(roh, 'text') }
}

function alsObjekt(antwort: unknown): Record<string, unknown> {
  if (typeof antwort !== 'object' || antwort === null) {
    throw new Error('Antwort ist kein Objekt.')
  }
  return antwort as Record<string, unknown>
}

function feld(roh: Record<string, unknown>, name: string): string {
  const wert = roh[name]
  if (typeof wert !== 'string' || wert.trim() === '') {
    throw new Error(`Feld "${name}" fehlt oder ist leer.`)
  }
  return wert.trim()
}

const RELATIV = [
  'gestern',
  'heute',
  'morgen',
  'am wochenende',
  'letzte woche',
  'letztes wochenende',
  'diese woche',
  'naechste woche',
  'nächste woche',
  'kuerzlich',
  'kürzlich',
  'zuletzt',
  'vergangenen samstag',
  'vergangenen sonntag',
  'am samstag',
  'am sonntag',
  'am freitag',
  'am mittwoch'
]

/**
 * Relative time references, which rot.
 *
 * Reported rather than rewritten: the editor decides whether "am Samstag" is
 * worth a revision, exactly as with the statistics articles.
 *
 * Matched at word boundaries, not as substrings: "morgendlichen" contains
 * "morgen" and is a perfectly durable word — the press-review walkthrough
 * flagged exactly that.
 */
export function zeitWarnungen(text: string): string[] {
  const klein = text.toLowerCase()
  return RELATIV.filter((wort) =>
    new RegExp(`(?<!\\p{L})${wort}(?!\\p{L})`, 'u').test(klein)
  ).map((wort) => `Relativer Zeitbezug: "${wort}"`)
}

/**
 * Every number in the article must be one we handed over.
 *
 * The goals, the date and the year are legitimate; anything else is the model
 * doing arithmetic it was told not to do — a table position, a points total, a
 * goal difference. Those are the figures that quietly turn out wrong.
 */
export function zahlWarnungen(
  text: string,
  fakten: SpielFakten,
  akzeptiert: readonly string[] = []
): string[] {
  const erlaubt = new Set<string>([
    String(fakten.toreHeim),
    String(fakten.toreGast),
    String(new Date(fakten.datum).getFullYear())
  ])
  const datum = new Date(fakten.datum)
  if (!Number.isNaN(datum.getTime())) {
    erlaubt.add(String(datum.getDate()))
  }
  for (const f of fakten.frueher) {
    erlaubt.add(String(f.toreHeim))
    erlaubt.add(String(f.toreGast))
  }
  // Digits that arrive inside the facts themselves are "in den Angaben" by
  // definition: the league ("2. Liga interregional"), a year in a club's name
  // ("FC Concordia 1907"), a pitch number in the venue ("Fiechten - 1"), a
  // figure in the newsroom's own note. Flagging those taught the editor to
  // ignore the warning, which is worse than not warning at all.
  const angaben = [
    fakten.wettbewerb,
    fakten.liga ?? '',
    fakten.heim,
    fakten.gast,
    fakten.verein,
    fakten.gemeinde,
    fakten.ort ?? '',
    fakten.notiz ?? ''
  ]
  for (const angabe of angaben) {
    for (const treffer of angabe.matchAll(/\d+/g)) erlaubt.add(treffer[0])
  }
  // What the editor has already waved through for this club — see
  // `gelernteZahlen` below.
  for (const zahl of akzeptiert) erlaubt.add(zahl)

  const gefunden = [...text.matchAll(/\d+/g)].map((t) => t[0])
  return [...new Set(gefunden.filter((z) => !erlaubt.has(z)))].map(
    (z) => `Zahl "${z}" steht nicht in den Angaben.`
  )
}

/** The exact face of a number warning — the learning below matches on it. */
const ZAHL_WARNUNG = /^Zahl "(\d+)" steht nicht in den Angaben\.$/

/**
 * The numbers an editor accepted, read back out of a published report's
 * warnings.
 *
 * Publishing a report that still carries a number warning IS the verdict: the
 * editor looked at the flagged figure and sent the text out anyway. That
 * verdict is remembered on the club (`vereine.akzeptierte_zahlen`, written by
 * the meldung-status hook), so the same number is flagged once and then never
 * again for this club. Only number warnings learn — a relative time reference
 * ("am Samstag") is wrong afresh every time, and an editor waving one through
 * says nothing about the next.
 */
export function gelernteZahlen(warnungen: readonly string[] | null): string[] {
  if (warnungen === null) return []
  const zahlen: string[] = []
  for (const warnung of warnungen) {
    const treffer = ZAHL_WARNUNG.exec(warnung)
    if (treffer?.[1] !== undefined) zahlen.push(treffer[1])
  }
  return [...new Set(zahlen)]
}
