// The events desk: what the Sichtung asks about an Anlass with an anchor, how
// a Meldung is written from the calendar's own fields, and the checks next to
// the prompts.
//
// Pure. The Directus-bound half is `veranstaltungslauf.ts`, the reader is
// `shared/veranstaltung/`. The shapes the municipal-news desk already has —
// triage schema and parser, the example digest, the German date, the
// verbatim-overlap and time checks — are imported and re-exported under this
// desk's names rather than copied.
//
// What is different from the news desk, and why it is a desk of its own: the
// unit is an Anlass with a list of dates, not a row with a publication date;
// what reaches the model is decided by CODE (the anchor, see
// `shared/veranstaltung/anker.ts`), never by the model; and the editor's
// rules of September 2026 differ in one point from the news rules — the model
// never lowers an event for WHO organises it. "Wenn im Dorf etwas los ist,
// interessiert es."

import type { Anker, Zugang } from '../types/schema'
import {
  datumDeutsch,
  lernDigest,
  parseTriage,
  TRIAGE_SCHEMA,
  type LernEintrag,
  type TriageUrteil
} from './amtsblatt'
import { vorgabenZeilen } from './lernen'
import { gekuerzt } from './presseschau'

export { lernDigest, datumDeutsch }
export type { LernEintrag }
export { TRIAGE_SCHEMA as SICHTUNG_SCHEMA, parseTriage as parseSichtung }
export type { TriageUrteil as SichtungsUrteil }
export { ueberlappungsWarnungen } from './presseschau'
export {
  linkWarnungen,
  zeitWarnungen,
  parseMeldungstext as parseMeldung
} from './spielbericht'
export {
  VORSCHLAGSFENSTER_TAGE,
  DAUERANGEBOT_INTERVALL_TAGE,
  DAUERANGEBOTE_JE_WOCHE
} from '../shared/veranstaltung/anker'

/** How the anchor reads on the desk and in the prompt. */
export const ANKER_TEXT: Record<Anker, string> = {
  neu: 'Neu — erste Durchfuehrung',
  einmalig: 'Einmalig',
  erinnerung: 'Erinnerung — monatlich oder seltener',
  abweichung: 'Abweichung vom Muster',
  beginnt: 'Beginnt',
  endet: 'Letzte Gelegenheit — endet',
  ausfall: 'Faellt aus',
  verschoben: 'Verschoben',
  frist: 'Anmeldefrist',
  gremium: 'Gremium — Traktanden',
  dauerangebot: 'Dauerangebot — Erinnerung',
  routine: 'Routine',
  abfuhr: 'Abfuhr (Entsorgungs-Tisch)',
  platzhalter: 'Platzhalter'
}

// ---------------------------------------------------------------------------
// 1. Sichtung — sorts, never filters, and never for the organiser's sake
// ---------------------------------------------------------------------------

/**
 * Byte-identical across a run. Everything per municipality — its name, its
 * decision history, its news page's recent titles — goes into the user turn.
 */
export const SICHTUNG_SYSTEM_PROMPT = `Du sichtest fuer eine lokale Redaktion in der Region Basel die Anlaesse aus dem Veranstaltungskalender einer Gemeinde und entscheidest, welche davon eine Redaktorin ansehen sollte.

Jeder Anlass traegt einen ANKER, den der Code berechnet hat — was ihn heute
auf den Tisch bringt: neu (erste Durchfuehrung einer Serie), einmalig,
Erinnerung (monatlich oder seltener), Abweichung vom Muster, beginnt, endet
(letzte Gelegenheit), faellt aus, verschoben, Anmeldefrist, Gremium,
Dauerangebot. Der Anker ist eine TATSACHE, keine Bewertung. Ob der Anlass eine
Meldung wert ist, beurteilst du.

Grundsatz der Redaktion: Wenn im Dorf etwas los ist, interessiert es. Ein
einmaliger Anlass in der Gemeinde ist ein Vorschlag. Eine Erinnerung an etwas
Monatliches ist ein Vorschlag, weil niemand daran denkt. Eine letzte
Gelegenheit ist ein Vorschlag. Ein Ausfall oder eine Verschiebung ist ein
Vorschlag, auch bei einer Routine. Ein Gremium (Einwohnerrat,
Gemeindeversammlung, Abstimmung) ist ein Vorschlag WEGEN seiner Traktanden
oder Vorlagen — nenne in der Begruendung, was verhandelt wird.

Du stufst NIE herab, weil eine Partei, ein Verein, eine Kirche oder ein
Unternehmen der Veranstalter ist. Wer veranstaltet, ist eine Tatsache fuer
die Begruendung ("Anlass einer Partei, Landratskandidierende
anwesend"), kein Grund. Die Redaktion entscheidet das.

Eine Herabstufung braucht einen GENANNTEN Grund, und es gibt nur wenige: der
Ort liegt ausserhalb der Gemeinde; das Publikum ist geschlossen (ein Kurs mit
Gebuehr und Anmeldung, ein Vereinsinterna, eine Probe); die Sache ist ohne
Datum, Zeit und Ort nicht meldbar. Ein Dauerangebot ist eine bewusste
Erinnerung der Redaktion an ein laufendes Angebot (fuer Neuzugezogene) und
wird als solche beurteilt, nicht als Neuigkeit.

Was schon auf der Newsseite der Gemeinde stand, ist KONTEXT, kein
Ausschluss: der Kalender bringt dieselbe Sache zum richtigen Zeitpunkt.
Nenne es in der Begruendung, wenn es dir auffaellt.

Die Bilanz und die Beispiele der Redaktion zeigen, was sie tatsaechlich
aufgreift: ein Vorschlag, den sie liegen liess, war ein Fehlvorschlag.

Begruende jeden Entscheid in EINEM kurzen Satz, der sagt WARUM, nicht WAS.

Weiterreichen an die Chefredaktion: NUR wenn eine der nummerierten Regeln der
Redaktion (R1, R2, …) verlangt, dass solche Anlaesse an die Chefredaktion
gehen, setze "empfehlung": "weiterreichen" und nenne die Nummer dieser Regel
in "empfehlung_regel". Ohne eine solche Regel sind beide null.

Antworte ausschliesslich mit JSON:
{"urteile": [{"nummer": 1, "vorschlag": true, "begruendung": "...", "empfehlung": null, "empfehlung_regel": null}]}`

/** One Anlass as the Sichtung sees it: the anchor as a fact, the fields, the caveats. */
export interface SichtungsAnlass {
  id: string
  titel: string
  anker: Anker
  ankerAm: string | null
  ankerGrund: string | null
  termine: readonly string[]
  zeit: string | null
  lokalitaet: string | null
  ort: string | null
  ortAusserhalb: boolean
  veranstalter: string | null
  kategorie: string | null
  preis: string | null
  anmeldung: string | null
  fristAm: string | null
  traktanden: readonly string[]
  dokumente: number
  auszug: string
  textAbgeschnitten: boolean
  /** Presented as a Dauerangebot reminder, not as news. */
  dauerangebot: boolean
  hinweise: readonly string[]
}

export const AUSZUG_ZEICHEN = 400
/** How many news titles of the municipality ride along as context. */
export const NEWS_KONTEXT_MAX = 30
/** How far back the news context reaches. */
export const NEWS_KONTEXT_TAGE = 14
/** How many dates a list names before it counts the rest. */
export const TERMINE_GENANNT = 6
/** How many agenda items ride into the Sichtung before the rest is counted. */
export const TRAKTANDEN_GENANNT = 12

export function auszugVon(
  zeile: { teaser: string | null; beschreibung: string | null },
  max = AUSZUG_ZEICHEN
): string {
  const quelle =
    (zeile.beschreibung ?? '').trim() !== ''
      ? (zeile.beschreibung ?? '')
      : (zeile.teaser ?? '')
  return gekuerzt(quelle.replace(/\s+/g, ' ').trim(), max)
}

/** "21.9.2026, 22.9.2026, 23.9.2026 (+5 weitere)" */
export function termineText(
  termine: readonly string[],
  max = TERMINE_GENANNT
): string {
  const genannt = termine.slice(0, max).map(datumDeutsch)
  const rest = termine.length - genannt.length
  return rest > 0
    ? `${genannt.join(', ')} (+${rest} weitere)`
    : genannt.join(', ')
}

export function buildSichtungPrompt(
  gemeinde: string,
  anlaesse: readonly SichtungsAnlass[],
  digest: string,
  /** The desk's Sichtung rules, already rendered (`regelnBlock`) — user turn, like the digest. */
  regeln = '',
  /** Titles the municipality's news page carried in the last two weeks — context, never exclusion. */
  newsKontext: readonly string[] = []
): string {
  const eintrag = (a: SichtungsAnlass, i: number): string[] => {
    const kopf = [
      `Anker: ${ANKER_TEXT[a.anker]}${a.ankerAm === null ? '' : ` am ${datumDeutsch(a.ankerAm)}`}`,
      a.zeit,
      [a.lokalitaet, a.ort].filter((t) => t !== null && t !== '').join(', ')
    ]
      .filter((t): t is string => t !== null && t !== '')
      .join(' · ')
    const zeilen = [`${i + 1}. [${kopf}] "${a.titel}"`]
    if (a.ankerGrund !== null && a.ankerGrund !== '')
      zeilen.push(`   Grund des Ankers: ${a.ankerGrund}`)
    const fakten = [
      a.veranstalter === null ? null : `Veranstalter: ${a.veranstalter}`,
      a.kategorie === null ? null : `Kategorie: ${a.kategorie}`,
      a.preis === null ? null : `Preis: ${a.preis}`,
      a.anmeldung === null ? null : `Anmeldung: ${a.anmeldung}`,
      a.fristAm === null ? null : `Anmeldefrist: ${datumDeutsch(a.fristAm)}`
    ].filter((t): t is string => t !== null)
    if (fakten.length > 0) zeilen.push(`   ${fakten.join(' · ')}`)
    if (a.termine.length > 1)
      zeilen.push(`   Termine: ${termineText(a.termine)}`)
    if (a.ortAusserhalb)
      zeilen.push(
        `   Ort ausserhalb der Gemeinde${a.ort === null ? '' : `: ${a.ort}`}`
      )
    if (a.traktanden.length > 0) {
      const genannt = a.traktanden.slice(0, TRAKTANDEN_GENANNT)
      const rest = a.traktanden.length - genannt.length
      zeilen.push(
        `   Traktanden: ${genannt.join(' | ')}${rest > 0 ? ` (+${rest} weitere)` : ''}`
      )
    }
    if (a.auszug !== '') zeilen.push(`   Auszug: ${a.auszug}`)
    if (a.textAbgeschnitten)
      zeilen.push('   (Der Text wurde beim Lesen gekuerzt.)')
    if (a.dokumente > 0)
      zeilen.push(
        `   (${a.dokumente} ${a.dokumente === 1 ? 'Dokument' : 'Dokumente'} gelesen)`
      )
    if (a.dauerangebot)
      zeilen.push(
        '   (Dauerangebot: als Erinnerung an ein laufendes Angebot vorgelegt, nicht als Neuigkeit.)'
      )
    for (const h of a.hinweise) zeilen.push(`   Hinweis: ${h}`)
    return zeilen
  }

  const kontext: string[] = []
  if (newsKontext.length > 0) {
    const genannt = newsKontext.slice(0, NEWS_KONTEXT_MAX)
    const rest = newsKontext.length - genannt.length
    kontext.push(
      '',
      `Bereits auf der Newsseite der Gemeinde (letzte ${NEWS_KONTEXT_TAGE} Tage):`,
      ...genannt.map((t) => `- ${t}`),
      ...(rest > 0 ? [`(+${rest} weitere)`] : [])
    )
  }

  return [
    `Gemeinde: ${gemeinde}`,
    '',
    'Anlaesse mit Anker aus dem Veranstaltungskalender:',
    ...anlaesse.flatMap(eintrag),
    ...kontext,
    ...(regeln === '' ? [] : ['', regeln]),
    ...(digest === '' ? [] : ['', digest]),
    '',
    `Beurteile alle ${anlaesse.length} und antworte fuer jeden mit seiner Nummer.`
  ].join('\n')
}

// ---------------------------------------------------------------------------
// 2. Cleanup — the desk empties itself
// ---------------------------------------------------------------------------

/** A row the calendar has not shown for this long is no longer in it. */
export const RUHEND_TAGE = 21

export interface AufraeumAnlass {
  id: string
  entscheid: string
  vorschlag: boolean | null
  anker: string | null
  anker_am: string | null
  von: string | null
  bis: string | null
  termine: string[] | null
  zuletzt_gesehen_am: string | null
  dauerangebot: string | null
}

/** Der letzte Tag, den wir von diesem Anlass kennen. */
export function letzterTag(
  zeile: Pick<AufraeumAnlass, 'von' | 'bis' | 'termine'>
): string | null {
  const termine = zeile.termine ?? []
  return zeile.bis ?? termine[termine.length - 1] ?? zeile.von ?? null
}

function tageSeit(datum: string | null, heute: string): number | null {
  if (datum === null) return null
  const tage = Math.floor(
    (Date.parse(heute) - Date.parse(datum.slice(0, 10))) / 86_400_000
  )
  return Number.isFinite(tage) ? tage : null
}

/**
 * Was vom Tisch geht.
 *
 * **Vorbei ist vorbei.** Die Redaktion hat das am 20. September 2026
 * ausdruecklich verlangt: ein Anlass, dessen letzter Termin hinter uns liegt,
 * verschwindet — auch wenn der Tisch ein paar Tage niemand angefasst hat.
 * Vorher hing das am ANKER, und ein Anlass ohne Anker-Datum blieb drei Wochen
 * liegen; wer montags aus den Ferien kam, raeumte von Hand ein Dutzend
 * vergangener Termine weg. Was ein Vorschlag war oder einen Schalter traegt,
 * verfaellt (und bleibt als Gedaechtnis stehen), alles andere wird geloescht:
 * es hat nie etwas gefragt und haelt keine Lehre.
 *
 * **Abfuhren gehoeren nicht hierher.** Sie stehen laengst auf dem
 * Entsorgungstisch, aus dem Abfuhrkalender, den eine Redaktorin einmal im Jahr
 * erfasst. Auf diesem Tisch waeren sie nur Rauschen — 21 Zeilen am ersten Tag.
 * Der Anker wird weiter gerechnet (er ist die Erklaerung dafuer, WARUM eine
 * Zeile fehlt, und der Lauf zaehlt sie), die Zeile selbst geht.
 *
 * Ein entschiedener Anlass bleibt unangetastet: seine Meldung entscheidet,
 * wie lange er in Arbeit ist.
 */
export function aufraeumAnlass(
  zeile: AufraeumAnlass,
  heute: string
): 'verfallen' | 'loeschen' | null {
  if (zeile.entscheid !== 'offen') return null
  if (zeile.anker === 'abfuhr') return 'loeschen'
  const letzter = letzterTag(zeile)
  if (letzter !== null && letzter < heute)
    return zeile.vorschlag === true || zeile.dauerangebot !== null
      ? 'verfallen'
      : 'loeschen'
  if (zeile.vorschlag === true)
    return zeile.anker_am !== null && zeile.anker_am < heute
      ? 'verfallen'
      : null
  if (zeile.dauerangebot !== null) return null
  const ruhend = tageSeit(zeile.zuletzt_gesehen_am, heute)
  return ruhend !== null && ruhend >= RUHEND_TAGE ? 'loeschen' : null
}

// ---------------------------------------------------------------------------
// 3. The Meldung — from fields, attributed to the calendar's owner
// ---------------------------------------------------------------------------

export interface AnlassDokumentFakt {
  bezeichnung: string
  url: string
  typ: 'pdf' | 'link'
  gelesen: boolean
  text: string | null
  grund: string | null
}

export interface AnlassFakten {
  gemeinde: string
  /** What the calendar is called — the attribution names it. */
  quelleName: string
  titel: string
  termine: readonly string[]
  von: string
  bis: string | null
  zeit: string | null
  lokalitaet: string | null
  adresse: string | null
  ort: string | null
  veranstalter: string | null
  kategorie: string | null
  preis: string | null
  anmeldung: string | null
  fristAm: string | null
  beschreibung: string
  textAbgeschnitten: boolean
  dokumente: readonly AnlassDokumentFakt[]
  traktanden: readonly string[]
  traktandenUrl: string | null
  anker: Anker
  zugang: Zugang
  /** Written as a reminder of a standing offer, with a "Stand" line. */
  dauerangebot: boolean
  /** The Anlass's own page — the source line. */
  url: string
  /** Today, ISO — the "Stand" line of a Dauerangebot names it. */
  heute: string
}

export const MELDUNG_SYSTEM_PROMPT = `Du schreibst fuer eine lokale Redaktion in der Region Basel kurze Meldungen ueber Anlaesse aus dem Veranstaltungskalender einer Gemeinde.

Regeln, ohne Ausnahme:
- Verwende NUR die uebergebenen Angaben: die Felder, den Beschrieb, die
  gelesenen Dokumente, die Traktanden. Erfinde nichts und rechne nichts aus.
- Schreibe in EIGENEN Worten. Der Beschrieb ist die Einladung des
  Veranstalters, nicht unsere Meldung: uebernimm keine Saetze, keine
  Werbeformeln ("freut sich", "einladend", "spannend"), keine Aufrufe.
  Berichte die Sache: was, wann, wo, wer, was es kostet, ob man sich anmelden
  muss.
- Nenne die Quelle IM TEXT mit dem genauen Namen: "laut dem
  {Kalender} der Gemeinde {Name}", "wie die Gemeinde {Name} in ihrem
  Veranstaltungskalender ankuendigt" oder "wie aus dem {Kalender} hervorgeht".
- Datum, Uhrzeit und Ort ABSOLUT: "am Freitag, 25. September 2026, von 13 bis
  18 Uhr im Kultur- und Sportzentrum" — niemals "naechste Woche", "morgen",
  "am Freitag". Der Text muss in fuenf Jahren noch stimmen.
- Bei einem Anker "Letzte Gelegenheit": sage, dass der Anlass endet und bis
  wann. Bei "Anmeldefrist": die Frist gehoert in den Lead. Bei "Faellt aus" oder
  "Verschoben": das ist die Nachricht, nicht der Anlass. Bei "Gremium": die
  Traktanden sind die Nachricht — nenne die wichtigsten.
- Ein DAUERANGEBOT ist eine Erinnerung an ein laufendes Angebot: sage im ersten
  Satz, dass es ein regelmaessiges Angebot ist und fuer wen, nenne den
  Rhythmus und die Zeit ("jeden Freitag von 14 bis 17 Uhr"), Ort, Kosten und
  Anmeldung. Keine Neuigkeit vortaeuschen.
- Zahlen genau so, wie sie in den Angaben stehen. Keine Adressen als Links,
  keine URLs, keine Telefonnummern, keine E-Mail-Adressen — die Quellenzeile
  setzt der Code.
- Personen nennst du nur in ihrer oeffentlichen Rolle (Referentin,
  Gemeindepraesident, Kursleiterin), wie die Angaben sie nennen.
- Schreibe nuechtern und knapp. Keine Wertung, keine Dramatisierung.
- Schweizer Rechtschreibung: "ss" statt "ß".

Umfang: Titel (maximal 70 Zeichen), Lead (ein Satz), Text (ein bis zwei kurze
Absaetze, durch eine Leerzeile getrennt).

Antworte ausschliesslich mit JSON:
{"titel": "...", "lead": "...", "text": "..."}`

export const MAX_TEXT = 12_000
export const MAX_DOKUMENT = 6_000
export const MAX_DOKUMENTE_GESAMT = 20_000

function dokumentZeilen(dokumente: readonly AnlassDokumentFakt[]): string[] {
  if (dokumente.length === 0) return []
  const zeilen: string[] = ['']
  let budget = MAX_DOKUMENTE_GESAMT
  const ausgelassen: string[] = []
  for (const d of dokumente) {
    if (!d.gelesen || d.text === null || d.text.trim() === '') {
      zeilen.push(
        `Dokument "${d.bezeichnung}" liegt vor, wurde aber nicht gelesen (${d.grund ?? 'kein Text'}) — behaupte nichts ueber seinen Inhalt.`
      )
      continue
    }
    if (budget <= 0) {
      ausgelassen.push(d.bezeichnung)
      continue
    }
    const stueck = gekuerzt(d.text.trim(), Math.min(MAX_DOKUMENT, budget))
    budget -= stueck.length
    zeilen.push(`Dokument "${d.bezeichnung}" (PDF, gelesen):`, stueck, '')
  }
  if (ausgelassen.length > 0)
    zeilen.push(
      `(${ausgelassen.length} weitere gelesene Dokumente nicht aufgefuehrt: ${ausgelassen.join(', ')})`
    )
  return zeilen
}

/** "Freitag, 25. September 2026" — the weekday helps the prose, and it is arithmetic the model must not do. */
export function datumMitWochentag(iso: string): string {
  const [j, m, t] = iso.split('-').map(Number)
  const tag = new Date(Date.UTC(j ?? 1970, (m ?? 1) - 1, t ?? 1)).getUTCDay()
  const namen = [
    'Sonntag',
    'Montag',
    'Dienstag',
    'Mittwoch',
    'Donnerstag',
    'Freitag',
    'Samstag'
  ]
  return `${namen[tag] ?? ''}, ${datumDeutsch(iso)}`
}

function faktenZeilen(f: AnlassFakten): string[] {
  const wann =
    f.bis === null || f.bis === f.von
      ? f.termine.length > 1
        ? `Termine: ${f.termine.map(datumMitWochentag).join('; ')}`
        : `Termin: ${datumMitWochentag(f.von)}`
      : `Zeitraum: ${datumMitWochentag(f.von)} bis ${datumMitWochentag(f.bis)}${
          f.termine.length > 2 && f.termine.length <= TERMINE_GENANNT * 2
            ? ` (Termine: ${f.termine.map(datumDeutsch).join(', ')})`
            : ''
        }`
  const ort = [f.lokalitaet, f.adresse, f.ort]
    .filter((t): t is string => t !== null && t !== '')
    .join(', ')
  return [
    `Gemeinde: ${f.gemeinde}`,
    `Quelle: ${f.quelleName}`,
    `Anker: ${ANKER_TEXT[f.anker]}`,
    `Titel des Anlasses: "${f.titel}"`,
    wann,
    ...(f.zeit === null ? [] : [`Uhrzeit: ${f.zeit}`]),
    ...(ort === '' ? ['Ort: nicht genannt'] : [`Ort: ${ort}`]),
    ...(f.veranstalter === null ? [] : [`Veranstalter: ${f.veranstalter}`]),
    ...(f.kategorie === null ? [] : [`Kategorie: ${f.kategorie}`]),
    ...(f.preis === null ? [] : [`Kosten: ${f.preis}`]),
    ...(f.anmeldung === null ? [] : [`Anmeldung: ${f.anmeldung}`]),
    ...(f.fristAm === null
      ? []
      : [`Anmeldefrist: ${datumMitWochentag(f.fristAm)}`]),
    ...(f.zugang === 'programm'
      ? ['Zugang: Teilnahme ueber die ganze Dauer (Kurs, Lager, Programm).']
      : []),
    ...(f.dauerangebot
      ? [
          `Dauerangebot: Erinnerung an ein laufendes Angebot, Stand ${datumDeutsch(f.heute)}.`
        ]
      : []),
    ...(f.traktanden.length > 0
      ? ['', 'Traktanden:', ...f.traktanden.map((t) => `- ${t}`)]
      : []),
    '',
    'Beschrieb des Veranstalters:',
    f.beschreibung.trim() === ''
      ? '(kein Beschrieb)'
      : gekuerzt(f.beschreibung.trim(), MAX_TEXT),
    ...(f.textAbgeschnitten
      ? [
          '',
          'Der Beschrieb liegt nur unvollstaendig vor (beim Lesen gekuerzt) — behaupte keine Vollstaendigkeit.'
        ]
      : []),
    ...dokumentZeilen(f.dokumente)
  ]
}

export function buildMeldungPrompt(
  fakten: AnlassFakten,
  regeln: readonly string[] = []
): string {
  return [
    ...faktenZeilen(fakten),
    ...vorgabenZeilen(regeln),
    '',
    'Schreibe die Meldung. Verwende ausschliesslich diese Angaben, in eigenen Worten.'
  ].join('\n')
}

/** Same facts, previous text, editor's instruction — system prompt unchanged. */
export function buildMeldungRevision(
  fakten: AnlassFakten,
  bisher: { titel: string | null; lead: string | null; text: string | null },
  anweisung: string,
  regeln: readonly string[] = []
): string {
  return [
    ...faktenZeilen(fakten),
    ...vorgabenZeilen(regeln),
    '',
    'Bisherige Meldung:',
    `Titel: ${bisher.titel ?? ''}`,
    `Lead: ${bisher.lead ?? ''}`,
    bisher.text ?? '',
    '',
    'Anweisung der Redaktion:',
    anweisung,
    '',
    'Schreibe die Meldung neu. Setze die Anweisung um, aber verwende weiterhin ausschliesslich die Angaben oben, in eigenen Worten.'
  ].join('\n')
}

export const QUELLE_DOKUMENTE_MAX = 3

/**
 * The source line, appended by code — never left to the model: the calendar
 * by name, the Anlass's own page, the read documents, the agenda page.
 */
export function quelleZeile(f: AnlassFakten): string {
  const teile = [`Quelle: ${f.quelleName}, ${f.url}`]
  if (f.traktandenUrl !== null && f.traktandenUrl !== f.url)
    teile.push(`Traktanden: ${f.traktandenUrl}`)
  const gelesene = f.dokumente.filter((d) => d.gelesen)
  for (const d of gelesene.slice(0, QUELLE_DOKUMENTE_MAX))
    teile.push(`Dokument: ${d.bezeichnung}, ${d.url}`)
  if (gelesene.length > QUELLE_DOKUMENTE_MAX)
    teile.push('Weitere Dokumente auf der Seite des Anlasses.')
  return teile.join('\n\n')
}

/**
 * The line that keeps a Dauerangebot reminder true in the archive: it says
 * what the calendar said on which day. Only on a Dauerangebot — a one-off
 * carries its own absolute date.
 */
export function standZeile(f: AnlassFakten): string | null {
  if (!f.dauerangebot) return null
  return `Stand: ${datumDeutsch(f.heute)}, laut ${f.quelleName}.`
}

export function mitQuelle(text: string, f: AnlassFakten): string {
  const stand = standZeile(f)
  return `${text.trim()}\n\n${stand === null ? '' : `${stand}\n\n`}${quelleZeile(f)}`
}

/** The whole handed material — what the verbatim-overlap check runs against. */
export function volltextVon(
  f: Pick<AnlassFakten, 'beschreibung' | 'dokumente'>
): string {
  return [f.beschreibung, ...f.dokumente.map((d) => d.text ?? '')]
    .filter((t) => t.trim() !== '')
    .join('\n\n')
}

// ---------------------------------------------------------------------------
// The checks — a prompt is a request, a check is a rule
// ---------------------------------------------------------------------------

const ATTRIBUTION =
  /veranstaltungskalender|laut\b|gem[äa]e?ss\b|ank[üu]ndig|mitteil|teilt\b.{0,60}?\bmit\b|wie die gemeinde|so die gemeinde|nach angaben|geht\b.{0,40}?\bhervor|schreibt\b|meldet\b|informier/i

/**
 * The calendar's owner must be named AS the source: the municipality's exact
 * name (or the calendar's), and a word that says it is telling us. Reported,
 * then retried once.
 */
export function attributionsWarnung(
  text: string,
  fakten: Pick<AnlassFakten, 'gemeinde' | 'quelleName'>
): string | null {
  const klein = text.normalize('NFC').toLowerCase()
  const name = fakten.gemeinde.normalize('NFC').toLowerCase()
  const kalender = fakten.quelleName.normalize('NFC').toLowerCase()
  if (!klein.includes(name) && !klein.includes(kalender))
    return `Die Meldung nennt weder die Gemeinde ${fakten.gemeinde} noch den Kalender «${fakten.quelleName}» als Quelle.`
  if (!ATTRIBUTION.test(klein))
    return `Die Meldung sagt nicht, dass ${fakten.quelleName} die Quelle ist ("laut dem Veranstaltungskalender der Gemeinde ${fakten.gemeinde}").`
  return null
}

/**
 * Every digit in the text must come from the handed material. Run BEFORE
 * `mitQuelle` appends the addresses, whose digits are nobody's claim. The
 * weekday-and-date form the prompt asks for is handed material too.
 */
export function zahlWarnungen(text: string, f: AnlassFakten): string[] {
  const erlaubt = new Set<string>()
  const sammle = (quelle: string | null): void => {
    if (quelle === null) return
    for (const treffer of quelle.matchAll(/\d+/g)) {
      erlaubt.add(treffer[0])
      erlaubt.add(String(Number(treffer[0])))
    }
  }
  sammle(f.titel)
  for (const t of f.termine) sammle(t)
  sammle(f.von)
  sammle(f.bis)
  sammle(f.zeit)
  sammle(f.lokalitaet)
  sammle(f.adresse)
  sammle(f.ort)
  sammle(f.veranstalter)
  sammle(f.preis)
  sammle(f.anmeldung)
  sammle(f.fristAm)
  sammle(f.beschreibung)
  sammle(f.heute)
  for (const t of f.traktanden) sammle(t)
  for (const d of f.dokumente) sammle(d.text)

  const gefunden = [...text.matchAll(/\d+/g)].map((t) => t[0])
  return [...new Set(gefunden.filter((z) => !erlaubt.has(z)))].map(
    (z) => `Zahl "${z}" steht nicht in den Angaben.`
  )
}
