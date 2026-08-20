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

Umfang: Titel (maximal 70 Zeichen), Lead (ein Satz), Text (zwei bis drei kurze
Absaetze, durch Leerzeilen getrennt).

Antworte ausschliesslich mit JSON:
{"titel": "...", "lead": "...", "text": "..."}`

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
    zeilen.push('', 'Frueher in dieser Saison:')
    for (const f of fakten.frueher.slice(0, 5)) {
      zeilen.push(
        `- ${absolutesDatum(f.datum)}: ${f.heim} ${f.toreHeim}:${f.toreGast} ${f.gast}`
      )
    }
  }

  return zeilen
}

export function buildSpielberichtPrompt(fakten: SpielFakten): string {
  return [
    ...faktenZeilen(fakten),
    '',
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
    `Lead: ${bisher.lead ?? ''}`,
    bisher.text ?? '',
    '',
    'Anweisung der Redaktion:',
    anweisung,
    '',
    'Schreibe den Spielbericht neu. Setze die Anweisung um, aber verwende weiterhin ausschliesslich die Angaben oben.'
  ].join('\n')
}

export interface Spielbericht {
  titel: string
  lead: string
  text: string
}

/** The model's answer is a promise, not a proof — never trust its shape. */
export function parseSpielbericht(antwort: unknown): Spielbericht {
  if (typeof antwort !== 'object' || antwort === null) {
    throw new Error('Antwort ist kein Objekt.')
  }
  const roh = antwort as Record<string, unknown>
  const feld = (name: string): string => {
    const wert = roh[name]
    if (typeof wert !== 'string' || wert.trim() === '') {
      throw new Error(`Feld "${name}" fehlt oder ist leer.`)
    }
    return wert.trim()
  }
  return { titel: feld('titel'), lead: feld('lead'), text: feld('text') }
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
 */
export function zeitWarnungen(text: string): string[] {
  const klein = text.toLowerCase()
  return RELATIV.filter((wort) => klein.includes(wort)).map(
    (wort) => `Relativer Zeitbezug: "${wort}"`
  )
}

/**
 * Every number in the article must be one we handed over.
 *
 * The goals, the date and the year are legitimate; anything else is the model
 * doing arithmetic it was told not to do — a table position, a points total, a
 * goal difference. Those are the figures that quietly turn out wrong.
 */
export function zahlWarnungen(text: string, fakten: SpielFakten): string[] {
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
  // League names carry their own digits — "2. Liga interregional".
  for (const treffer of (fakten.liga ?? '').matchAll(/\d+/g))
    erlaubt.add(treffer[0])
  for (const treffer of fakten.wettbewerb.matchAll(/\d+/g))
    erlaubt.add(treffer[0])

  const gefunden = [...text.matchAll(/\d+/g)].map((t) => t[0])
  return [...new Set(gefunden.filter((z) => !erlaubt.has(z)))].map(
    (z) => `Zahl "${z}" steht nicht in den Angaben.`
  )
}
