// The Kanton desk: what the canton and its police say ABOUT a municipality.
//
// Pure. The Directus-bound half is `kantonlauf.ts`, the writer
// `kantonmeldungen.ts`, the reader `shared/kanton/`. Modelled on the
// Gemeindeseiten desk (`gemeindeseite.ts`), and wherever that desk already
// had the right shape — the triage schema and parser, the example digest,
// the excerpt, the cleanup, the German date — it is imported rather than
// copied.
//
// What differs, decided by the newsroom on 29 September 2026: only items
// that NAME a covered municipality reach the desk (code, word boundaries —
// `gemeindeTreffer`, the broadcasts' lesson: "Aeschenplatz" is not Aesch);
// the speaker is the canton or the police, never the municipality; a police
// notice is written about a PLACE and an event, never about a named person.

import {
  datumDeutsch,
  lernDigest,
  parseTriage,
  TRIAGE_SCHEMA
} from './amtsblatt'
import type { LernEintrag, TriageUrteil } from './amtsblatt'
import { personenWarnungen } from './amtsblatt'
import { aufraeumAktion, auszugVon, type AufraeumZeile } from './gemeindeseite'
import { vorgabenZeilen } from './lernen'
import { gekuerzt } from './presseschau'
import { gemeindeTreffer } from './sendung'
import { terminTageZeilen } from './termin'
import type { KantonQuelle } from '../types/schema'

export {
  lernDigest,
  datumDeutsch,
  auszugVon,
  gemeindeTreffer,
  personenWarnungen
}
export type { LernEintrag }
export { TRIAGE_SCHEMA as SICHTUNG_SCHEMA, parseTriage as parseSichtung }
export type { TriageUrteil as SichtungsUrteil }
export { ueberlappungsWarnungen } from './presseschau'
export {
  linkWarnungen,
  zeitWarnungen,
  parseMeldungstext as parseKantonMeldung
} from './spielbericht'

// ---------------------------------------------------------------------------
// 0. The pre-filter — code decides who is named, the model never
// ---------------------------------------------------------------------------

/**
 * The covered municipalities an item names, in title, teaser or text — with
 * word boundaries, so a Basel street does not become a Baselland village.
 * Measured 28/29 September 2026: 6 of 100 press releases name one in the
 * title, 9 of 20 police notices in title + teaser. What names none never
 * enters the desk.
 */
export function vorfilter(
  item: { titel: string; teaser: string | null; text: string | null },
  gemeinden: ReadonlyArray<{ id: string; name: string }>
): Array<{ id: string; name: string }> {
  const treffer = new Set(
    gemeindeTreffer(
      `${item.titel}\n${item.teaser ?? ''}\n${item.text ?? ''}`,
      gemeinden.map((g) => g.name)
    )
  )
  return gemeinden.filter((g) => treffer.has(g.name))
}

// ---------------------------------------------------------------------------
// 1. Sichtung — sorts, never filters
// ---------------------------------------------------------------------------

/** Byte-identical across a run; everything per municipality goes into the user turn. */
export const KANTON_SICHTUNG_SYSTEM_PROMPT = `Du sichtest fuer eine lokale Redaktion in der Region Basel Mitteilungen des Kantons Basel-Landschaft und seiner Polizei, die eine bestimmte Gemeinde beim Namen nennen, und entscheidest, welche davon eine Redaktorin fuer DIESE Gemeinde ansehen sollte.

Der Kanton und die Polizei sprechen UEBER die Gemeinde, nicht fuer sie. Die
Frage ist darum immer: betrifft die Mitteilung diese Gemeinde konkret — eine
Strasse, eine Schule, einen Entscheid, ein Ereignis, ein Projekt in ihr — oder
ist die Gemeinde nur ein Name in einer Aufzaehlung?

Dafuer spricht: ein Entscheid des Regierungsrats oder einer Direktion, der
diese Gemeinde trifft (Tempo 30, eine Strassensanierung, ein Schulstandort,
eine Bewilligung, eine Vernehmlassung mit Folgen vor Ort); ein Bauprojekt des
Kantons in ihr; ein Ereignis in ihr, ueber das die Polizei berichtet (Brand,
Unfall mit Verletzten, Sperrung, Einsatz) — ein Polizeieinsatz ist ein
Ereignis an einem Ort, und der Ort ist die Nachricht; Zahlen und Rangfolgen,
in denen die Gemeinde ausdruecklich herausgehoben wird.

Dagegen: die Gemeinde steht in einer Liste vieler Gemeinden (alle
Bezirkshauptorte, alle Gemeinden mit einer Tempo-30-Zone, alle Standorte
einer Aktion) ohne eigene Aussage; sie ist nur Adresse einer kantonalen Stelle
oder Ort einer Sitzung; die Mitteilung ist kantonale Politik ohne Bezug zum
Dorf, in der die Gemeinde beilaeufig faellt; Routine der Polizei ohne Folgen
(Kontrolle ohne Befund, Praeventionsaufruf).

Im Zweifel: nein. Die nicht vorgeschlagenen Mitteilungen verschwinden nicht,
sie stehen der Redaktion weiterhin zur Verfuegung — ein falsches Ja kostet
Aufmerksamkeit, ein falsches Nein kostet einen Klick. Die Bilanz und die
Beispiele der Redaktion zeigen, was sie tatsaechlich aufgreift; ein Vorschlag,
den sie liegen liess oder als "nur am Rand erwaehnt" ablehnte, war ein
Fehlvorschlag.

Begruende jeden Entscheid in EINEM kurzen Satz, der sagt WARUM, nicht WAS.

Weiterreichen an die Chefredaktion: NUR wenn eine der nummerierten Regeln der
Redaktion (R1, R2, …) verlangt, dass solche Mitteilungen an die Chefredaktion
gehen, setze "empfehlung": "weiterreichen" und nenne die Nummer dieser Regel
in "empfehlung_regel". Ohne eine solche Regel sind beide null.

Antworte ausschliesslich mit JSON:
{"urteile": [{"nummer": 1, "vorschlag": true, "begruendung": "...", "empfehlung": null, "empfehlung_regel": null}]}`

/** One item as the Sichtung sees it. */
export interface KantonSichtungsZeile {
  id: string
  titel: string
  auszug: string
  publiziertAm: string | null
  quelle: KantonQuelle
  behoerde: string | null
  /** The other covered municipalities the same item names. */
  weitereGemeinden: readonly string[]
  textAbgeschnitten: boolean
}

export function quelleText(quelle: KantonQuelle): string {
  return quelle === 'polizeimeldung' ? 'Polizeimeldung' : 'Medienmitteilung'
}

export function buildKantonSichtungPrompt(
  gemeinde: string,
  zeilen: readonly KantonSichtungsZeile[],
  digest: string,
  /** The desk's Sichtung rules, already rendered (`regelnBlock`) — user turn, like the digest. */
  regeln = ''
): string {
  const eintrag = (z: KantonSichtungsZeile, i: number): string[] => {
    const kopf = [
      quelleText(z.quelle),
      z.behoerde,
      z.publiziertAm === null ? null : datumDeutsch(z.publiziertAm)
    ]
      .filter((t): t is string => t !== null && t !== '')
      .join(' · ')
    const zeilenDazu = [`${i + 1}. [${kopf}] "${z.titel}"`]
    if (z.auszug !== '') zeilenDazu.push(`   Auszug: ${z.auszug}`)
    if (z.weitereGemeinden.length > 0)
      zeilenDazu.push(
        `   (nennt auch ${z.weitereGemeinden.join(', ')} — beurteile nur den Bezug zu ${gemeinde})`
      )
    if (z.textAbgeschnitten)
      zeilenDazu.push('   (Der Text wurde beim Lesen gekuerzt.)')
    return zeilenDazu
  }
  return [
    `Gemeinde: ${gemeinde}`,
    '',
    `Neue Mitteilungen des Kantons Basel-Landschaft und seiner Polizei, die ${gemeinde} nennen:`,
    ...zeilen.flatMap(eintrag),
    ...(regeln === '' ? [] : ['', regeln]),
    ...(digest === '' ? [] : ['', digest]),
    '',
    `Beurteile alle ${zeilen.length} und antworte fuer jede mit ihrer Nummer.`
  ].join('\n')
}

// ---------------------------------------------------------------------------
// 2. Cleanup — the same two rules as the municipal desk, no event branch
// ---------------------------------------------------------------------------

export function aufraeumAktionKanton(
  zeile: Omit<AufraeumZeile, 'veranstaltung_am'>,
  heute: string,
  fensterTage = 0
): 'verfallen' | 'loeschen' | null {
  return aufraeumAktion(
    { ...zeile, veranstaltung_am: null },
    heute,
    fensterTage
  )
}

// ---------------------------------------------------------------------------
// 3. The Meldung
// ---------------------------------------------------------------------------

export interface KantonFakten {
  gemeinde: string
  quelle: KantonQuelle
  /** Who speaks: «Kanton Basel-Landschaft» or «Polizei Basel-Landschaft». */
  quelleName: string
  behoerde: string | null
  titel: string
  teaser: string | null
  publiziertAm: string | null
  text: string
  textAbgeschnitten: boolean
  /** The public page the article links. */
  url: string
  weitereGemeinden: readonly string[]
  /** Every calendar day CODE found in the wording — the only days the model may name as termin. */
  datenImText: readonly string[]
}

export function quelleNameFuer(quelle: KantonQuelle): string {
  return quelle === 'polizeimeldung'
    ? 'Polizei Basel-Landschaft'
    : 'Kanton Basel-Landschaft'
}

export const KANTON_MELDUNG_SYSTEM_PROMPT = `Du schreibst fuer eine lokale Redaktion in der Region Basel kurze Meldungen fuer EINE Gemeinde aus Mitteilungen des Kantons Basel-Landschaft und seiner Polizei, die diese Gemeinde nennen.

Regeln, ohne Ausnahme:
- Verwende NUR die Fakten aus dem uebergebenen Wortlaut. Erfinde nichts und
  rechne nichts aus.
- Schreibe in EIGENEN Worten. Der Text des Kantons ist seine Mitteilung,
  nicht unsere Meldung: uebernimm keine Saetze, keine Amtsformeln. Berichte
  die Sache aus Sicht der Gemeinde: was bedeutet sie fuer die Leute dort.
- Nenne die Quelle IM TEXT: bei einer Medienmitteilung "wie der Kanton
  Basel-Landschaft mitteilt" (die Direktion darfst du dazu nennen), bei einer
  Polizeimeldung "wie die Polizei Basel-Landschaft mitteilt".
- Nenne Daten ABSOLUT ("am 2. Oktober 2026"), niemals relativ ("gestern",
  "am Freitag" ohne Datum). Der Text muss in fuenf Jahren noch stimmen.
- POLIZEIMELDUNG: Schreibe ueber den Ort und das Ereignis, nie ueber eine
  Person. Keine Namen von Privatpersonen, auch wenn die Meldung einen nennt;
  keine Kennzeichen, kein Alter und keine Herkunft als Kennzeichnung einer
  Person, sofern es nicht die Sache selbst ist (ein Aufruf nach Zeugen bleibt
  ein Aufruf). Behoerdenmitglieder in ihrer Funktion darfst du nennen.
- Zahlen genau so, wie sie im Wortlaut stehen. Keine Adressen, keine Links —
  die Quellenzeile setzt der Code.
- Schreibe nuechtern und knapp. Keine Wertung, keine Dramatisierung.
- Schweizer Rechtschreibung: "ss" statt "ß".

Umfang: Titel (maximal 70 Zeichen, nennt die Gemeinde, wo sie die Sache
ist), Lead (ein Satz), Text (ein bis zwei kurze Absaetze, durch eine
Leerzeile getrennt).

Zusaetzlich beurteilst du zwei Dinge FUER DEN NEWSLETTER — sie erscheinen
nicht im Text:
- "termin": Hat die Mitteilung einen Tag, an dem sie fuer die Leserin zaehlt
  — eine Sperrung ab, ein Baustart am, eine Frist bis, eine Aenderung gueltig
  ab? Dann nenne "ideal" (den ersten Tag, an dem es gilt, oder die Frist) und
  "ende" (den letzten Tag, an dem die Meldung noch Sinn hat — bei einer
  Sperrung ihr letzter Tag, sonst derselbe wie "ideal"). NUR Tage aus der
  Liste "Im Wortlaut genannte Tage"; steht der passende Tag nicht dort, ist
  "termin" null. Ein Entscheid, ein Bericht, ein Ereignis, das vorbei ist,
  hat "termin": null.
- "wichtig": true, wenn die Sache fuer viele im Dorf zaehlt und eine FRUEHE
  Ankuendigung verdient — eine Strassensperrung, ein Baustart mit Folgen fuer
  die Nachbarschaft, ein Unterbruch bei Wasser oder Strom, ein Entscheid, der
  das Dorf veraendert. false bei Routine, bei Ereignissen, die vorbei sind,
  und bei Fristen, die nur wenige betreffen. Stehen unten Entscheide der
  Redaktion, richte dich danach.

Antworte ausschliesslich mit JSON:
{"titel": "...", "lead": "...", "text": "...", "termin": {"ideal": "JJJJ-MM-TT", "ende": "JJJJ-MM-TT"} | null, "wichtig": true | false}`

export const MAX_TEXT = 12_000

function faktenZeilen(fakten: KantonFakten): string[] {
  const datum =
    fakten.publiziertAm === null
      ? ''
      : ` vom ${datumDeutsch(fakten.publiziertAm)}`
  return [
    `Gemeinde: ${fakten.gemeinde}`,
    `${quelleText(fakten.quelle)} — ${fakten.quelleName}${fakten.behoerde === null || fakten.behoerde === fakten.quelleName ? '' : ` (${fakten.behoerde})`}${datum}`,
    ...(fakten.weitereGemeinden.length > 0
      ? [
          `Die Mitteilung nennt auch ${fakten.weitereGemeinden.join(', ')} — die Meldung ist fuer ${fakten.gemeinde}.`
        ]
      : []),
    `Titel der Mitteilung: "${fakten.titel}"`,
    ...(fakten.teaser === null || fakten.teaser.trim() === ''
      ? []
      : [`Anriss: ${fakten.teaser.trim()}`]),
    '',
    'Wortlaut der Mitteilung:',
    gekuerzt(fakten.text.trim(), MAX_TEXT),
    ...(fakten.textAbgeschnitten
      ? [
          '',
          'Der Wortlaut liegt nur unvollstaendig vor (beim Lesen gekuerzt) — behaupte keine Vollstaendigkeit.'
        ]
      : []),
    ...terminTageZeilen(fakten.datenImText)
  ]
}

export function buildKantonPrompt(
  fakten: KantonFakten,
  regeln: readonly string[] = [],
  /** What the newsroom decided about importance lately — `wichtigkeitDigest`, or ''. */
  wichtigkeit = ''
): string {
  return [
    ...faktenZeilen(fakten),
    ...vorgabenZeilen(regeln),
    ...(wichtigkeit === '' ? [] : ['', wichtigkeit]),
    '',
    'Schreibe die Meldung. Verwende ausschliesslich diese Angaben, in eigenen Worten.'
  ].join('\n')
}

/** Same facts, previous text, editor's instruction — system prompt unchanged. */
export function buildKantonRevision(
  fakten: KantonFakten,
  bisher: { titel: string | null; lead: string | null; text: string | null },
  anweisung: string,
  regeln: readonly string[] = [],
  wichtigkeit = ''
): string {
  return [
    ...faktenZeilen(fakten),
    ...vorgabenZeilen(regeln),
    ...(wichtigkeit === '' ? [] : ['', wichtigkeit]),
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

/** The source line, appended by code — the notice's own page on the public site. */
export function quelleZeile(fakten: KantonFakten): string {
  const datum =
    fakten.publiziertAm === null
      ? ''
      : ` vom ${datumDeutsch(fakten.publiziertAm)}`
  const behoerde =
    fakten.quelle === 'medienmitteilung' &&
    fakten.behoerde !== null &&
    fakten.behoerde !== fakten.quelleName
      ? ` (${fakten.behoerde})`
      : ''
  const was =
    fakten.quelle === 'polizeimeldung'
      ? 'Polizeimeldung der Polizei Basel-Landschaft'
      : `Medienmitteilung des Kantons Basel-Landschaft${behoerde}`
  return `Quelle: ${was}${datum}, ${fakten.url}`
}

export function mitQuelle(text: string, fakten: KantonFakten): string {
  return `${text.trim()}\n\n${quelleZeile(fakten)}`
}

const QUELLENZEILE = /\n{2,}Quelle: [^\n]*$/

/** The stored text without its source line — for a revision, so the model cannot copy it. */
export function ohneQuelle(text: string | null): string | null {
  if (text === null) return null
  return text.replace(QUELLENZEILE, '').trimEnd()
}

// ---------------------------------------------------------------------------
// The checks — a prompt is a request, a check is a rule
// ---------------------------------------------------------------------------

const SPRECHER: Record<KantonQuelle, RegExp> = {
  medienmitteilung: /kantons? basel-landschaft/,
  polizeimeldung: /(?:kantons)?polizei basel-landschaft/
}

const ATTRIBUTION =
  /mitteil|teilt\b.{0,60}?\bmit\b|informier|laut (?:dem kanton|der (?:kantons)?polizei|der \w*direktion|dem regierungsrat)|gem[äa]e?ss (?:dem kanton|der (?:kantons)?polizei)|schreibt (?:der kanton|die (?:kantons)?polizei|die \w*direktion)|meldet (?:der kanton|die (?:kantons)?polizei)|gibt\b.{0,60}?\bbekannt|bekannt ?gegeben|wie (?:der kanton|die (?:kantons)?polizei|die \w*direktion|der regierungsrat)|so (?:der kanton|die (?:kantons)?polizei)|nach angaben (?:des kantons|der (?:kantons)?polizei)/i

/**
 * The speaker must be named AS the source — the canton for a press release,
 * the police for a police notice — with a word that says it is telling us.
 */
export function attributionsWarnung(
  text: string,
  fakten: Pick<KantonFakten, 'quelle' | 'quelleName'>
): string | null {
  const klein = text.normalize('NFC').toLowerCase()
  if (!SPRECHER[fakten.quelle].test(klein))
    return `Die Meldung nennt ${fakten.quelleName} nicht als Quelle.`
  if (!ATTRIBUTION.test(klein))
    return `Die Meldung sagt nicht, dass ${fakten.quelleName} die Quelle ist ("wie ${fakten.quelle === 'polizeimeldung' ? 'die' : 'der'} ${fakten.quelleName} mitteilt").`
  return null
}

/**
 * Every digit in the text must come from the handed material. Run BEFORE
 * `mitQuelle` appends the address, whose digits are nobody's claim.
 */
export function zahlWarnungen(text: string, fakten: KantonFakten): string[] {
  const erlaubt = new Set<string>()
  const sammle = (quelle: string | null): void => {
    if (quelle === null) return
    for (const treffer of quelle.matchAll(/\d+/g)) {
      erlaubt.add(treffer[0])
      erlaubt.add(String(Number(treffer[0])))
    }
  }
  sammle(fakten.titel)
  sammle(fakten.teaser)
  sammle(fakten.publiziertAm)
  sammle(fakten.text)
  const gefunden = [...text.matchAll(/\d+/g)].map((t) => t[0])
  return [...new Set(gefunden.filter((z) => !erlaubt.has(z)))].map(
    (z) => `Zahl "${z}" steht nicht in den Angaben.`
  )
}

/** Capitalised words that open a sentence, name a day, a body or a place — never a person. */
const KEIN_NAME = new Set(
  [
    'der die das den dem des ein eine einer eines einem einen am im in an auf aus bei beim mit nach ohne seit um vom von vor zu zum zur bis durch für gegen über unter wegen während trotz und oder als wie wenn weil dass ob',
    'es er sie wir ihr dabei dann danach davor zudem ebenfalls zuvor laut gemäss dort hier heute gestern morgen',
    'montag dienstag mittwoch donnerstag freitag samstag sonntag montagabend dienstagabend mittwochabend donnerstagabend freitagabend samstagabend sonntagabend montagnacht dienstagnacht mittwochnacht donnerstagnacht freitagnacht samstagnacht sonntagnacht montagmorgen dienstagmorgen mittwochmorgen donnerstagmorgen freitagmorgen samstagmorgen sonntagmorgen',
    'januar februar märz april mai juni juli august september oktober november dezember',
    'polizei kantonspolizei staatsanwaltschaft feuerwehr sanität rettungsdienst notruf basel landschaft bl kanton gemeinde regierungsrat landrat direktion sicherheitsdirektion uhr person personen verletzte fahrzeug fahrzeuge lenker lenkerin'
  ]
    .join(' ')
    .split(' ')
)

const ORTSENDUNG = /(?:strasse|str\.|weg|platz|gasse|matt|rain|tal|berg|hof)$/i

/**
 * Candidate person names in the SOURCE text — pairs of capitalised words,
 * neither of which opens a sentence, names a day, a body or a place. A
 * heuristic, declared as such: the police text carries no structured person
 * list the way the gazette's XML does. Measured on the Buus notice: zero
 * candidates, because the police names nobody — the rule in the prompt
 * carries the weight, and this check is the net for the rare notice that
 * does (a missing person, a named official).
 */
export function namensKandidaten(
  quelltext: string,
  ausschluss: readonly string[] = []
): string[] {
  const verboten = new Set([
    ...KEIN_NAME,
    ...ausschluss.map((a) => a.normalize('NFC').toLowerCase())
  ])
  const woerter = quelltext.normalize('NFC').split(/\s+/)
  const gefunden = new Set<string>()
  const istName = (w: string): boolean => {
    const rein = w.replace(/^[«„"'(]+|[»“"'),.;:!?]+$/g, '')
    if (!/^\p{Lu}[\p{Ll}\-]+$/u.test(rein)) return false
    if (verboten.has(rein.toLowerCase())) return false
    if (ORTSENDUNG.test(rein)) return false
    return true
  }
  for (let i = 0; i + 1 < woerter.length; i++) {
    const a = woerter[i] ?? ''
    const b = woerter[i + 1] ?? ''
    // A word that closes a sentence cannot be a first name.
    if (/[.!?]$/.test(a)) continue
    if (istName(a) && istName(b))
      gefunden.add(
        `${a.replace(/^[«„"'(]+/, '')} ${b.replace(/[»“"'),.;:!?]+$/, '')}`
      )
  }
  return [...gefunden]
}

/** Only a police notice is checked for named persons; a press release names officials in their function. */
export function polizeiPersonenWarnungen(
  text: string,
  fakten: Pick<
    KantonFakten,
    'quelle' | 'text' | 'gemeinde' | 'weitereGemeinden'
  >
): string[] {
  if (fakten.quelle !== 'polizeimeldung') return []
  const namen = namensKandidaten(fakten.text, [
    fakten.gemeinde,
    ...fakten.weitereGemeinden
  ])
  return namen.length === 0 ? [] : personenWarnungen(text, namen)
}
