// The municipal-news desk: what the Sichtung asks, how a Meldung is written
// from a municipality's own announcement, and the checks next to the prompts.
//
// Pure. The Directus-bound half is `gemeindeseitenlauf.ts`, the reader is
// `shared/gemeindeseite/`. Wherever the gazette desk already had the right
// shape — the triage schema and parser, the example digest, the German date —
// it is imported and re-exported under this desk's names rather than copied:
// one parser, one digest renderer, one date formatter.

import {
  alleDaten,
  heuteAus,
  VERANSTALTUNGS_FENSTER_TAGE,
  type Heute
} from '../shared/gemeindeseite'
import {
  datumDeutsch,
  lernDigest,
  parseTriage,
  TRIAGE_SCHEMA,
  type LernEintrag,
  type TriageUrteil
} from './amtsblatt'
import { verschiebe } from './feiertage'
import { terminTageZeilen } from './termin'
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
  parseMeldungstext as parseMitteilung
} from './spielbericht'

// ---------------------------------------------------------------------------
// 1. Sichtung — sorts, never filters
// ---------------------------------------------------------------------------

/**
 * Byte-identical across a run. Everything per municipality — its name, its
 * decision history, its events calendar — goes into the user turn.
 */
export const SICHTUNG_SYSTEM_PROMPT = `Du sichtest fuer eine lokale Redaktion in der Region Basel die Mitteilungen auf der offiziellen Website einer Gemeinde und entscheidest, welche davon eine Redaktorin ansehen sollte.

Beurteile jede Mitteilung einzeln. Es geht NICHT darum, ob die Gemeinde sie
wichtig findet, sondern ob daraus eine Meldung fuer die Leserschaft der
Gemeinde werden koennte. Der Text ist die Selbstdarstellung der Gemeinde —
beurteile die Sache, nicht den Ton.

Dafuer spricht: Beschluesse von Gemeinderat, Einwohnerrat oder
Gemeindeversammlung, Abstimmungsvorlagen, Budget, Steuerfuss und Rechnung,
Bauprojekte und Planungen mit Wirkung ueber ein Grundstueck hinaus, Personelles
an der Spitze von Behoerde und Verwaltung, Schule, Kita und Tagesstrukturen —
und SERVICE mit breiter Wirkung: Strassensperrungen und Umleitungen,
Unterbrueche bei Wasser, Strom oder Fernwaerme, Aenderungen bei der
Abfallentsorgung, Wasserqualitaet, Ereignisse wie Unwetter oder Brand,
laufende Vernehmlassungs-, Anmelde- und Einsprachefristen.

Dagegen: Routine ohne Neuigkeit — Oeffnungszeiten und Feiertagsschliessungen,
Stellenausschreibungen, Schalter- und Formularhinweise, Wahlwerbung,
Baupublikationen und amtliche Anzeigen (die kommen ueber das Amtsblatt),
Gratulationen, Hinweise auf den eigenen Newsletter.

Abfuhren: Die Abfuhrtermine stehen vollstaendig und richtig im
Abfuhrkalender der Gemeinde, und die Erinnerungen dazu schreibt der
Entsorgungs-Tisch. Eine Mitteilung, die Abfuhrtermine ankuendigt oder in
Erinnerung ruft, ist darum KEIN Vorschlag. Faellt eine Abfuhr aus oder wird
sie verschoben, ist das eine Meldung.

Anlaesse: Was im Veranstaltungskalender der Gemeinde steht, bringt der
Veranstaltungs-Tisch zum richtigen Zeitpunkt. Nennt eine Mitteilung
kuenftige Tage, steht bei ihr, was der Kalender an diesen Tagen fuehrt
(Kalender-Abgleich). Fehlt der Anlass dort, bringt ihn sonst niemand — das
spricht FUER die Mitteilung, nicht gegen sie.

Gewicht: Dass eine Gemeinde etwas als Mitteilung veroeffentlicht, hat fuer
sich schon Gewicht. Legt sie Flyer oder andere Unterlagen dazu, eher noch
mehr — da macht sich jemand die Muehe, ein Angebot bekannt zu machen.

Vergib jeder Mitteilung eine STUFE ihres Nachrichtenwerts. Die Note ist
deine; ab welcher Stufe etwas auf den Tisch kommt, stellt die Redaktion ein —
in einer ruhigen Woche tiefer, sonst hoeher. Benote darum die Sache, nicht
die Lage:
4 = wichtig: ein Beschluss, eine Sperrung, ein Unterbruch, ein Ausfall, eine
    Frist, ein Ereignis mit Wirkung fuer viele
3 = klare Meldung: was eine Redaktion an einem normalen Tag aufgreift
2 = moeglich: in einer ruhigen Woche eine Meldung wert — ein weitergereichter
    Vereinsanlass, ein Service-Hinweis ohne Dringlichkeit, ein Rueckblick
    oder eine Fotogalerie mit Substanz
1 = Routine ohne Neuigkeit (siehe oben)
Im Zweifel zwischen zwei Stufen die tiefere. Nichts verschwindet: die
Redaktion sieht jede Mitteilung, die Stufe entscheidet nur, was zuoberst
liegt. Die Bilanz und die Beispiele der Redaktion zeigen, was sie
tatsaechlich aufgreift: ein Vorschlag, den sie liegen liess, war zu hoch
benotet.

Begruende jede Stufe in EINEM kurzen Satz, der sagt WARUM, nicht WAS.

Weiterreichen an die Chefredaktion: NUR wenn eine der nummerierten Regeln der
Redaktion (R1, R2, …) verlangt, dass solche Mitteilungen an die Chefredaktion
gehen, setze "empfehlung": "weiterreichen" und nenne die Nummer dieser Regel
in "empfehlung_regel". Ohne eine solche Regel sind beide null.

Antworte ausschliesslich mit JSON:
{"urteile": [{"nummer": 1, "stufe": 3, "begruendung": "...", "empfehlung": null, "empfehlung_regel": null}]}`

/** One item as the Sichtung sees it: title, an excerpt, the caveats the reader left. */
export interface SichtungsZeile {
  id: string
  titel: string
  auszug: string
  publiziertAm: string | null
  kategorie: string | null
  textAbgeschnitten: boolean
  anhaenge: number
  anhaengeGelesen: number
  /** What the attachments are called — a flyer is a signal the count alone cannot give. */
  anhangNamen: readonly string[]
  /** The events-calendar cross-check for this item, when it names days ahead; null otherwise. */
  kalender: string | null
  /** The day the event takes place — set on an events row, null on a news row. */
  veranstaltungAm: string | null
}

/**
 * Whether an event has already taken place. The one thing the Sichtung must
 * not leave to the model: a date comparison is arithmetic, and an event that
 * happened yesterday is not a proposal today, however it reads.
 */
export function terminVorbei(
  zeile: { veranstaltung_am: string | null },
  heute: string
): boolean {
  // A missing value counts as "no event", not as "an event on no day": a row
  // written before the column existed answers with the field absent, and
  // `undefined !== null` would otherwise make it an event forever.
  const termin = zeile.veranstaltung_am
  return typeof termin === 'string' && termin < heute
}

/**
 * What the one model call of the run is asked about, and what code decides by
 * itself: a past event is never proposed, and asking would cost tokens for an
 * answer we already have.
 */
export function sichtungsAuswahl(
  zeilen: readonly SichtungsZeile[],
  heute: string
): { zuBeurteilen: SichtungsZeile[]; vorbei: SichtungsZeile[] } {
  const zuBeurteilen: SichtungsZeile[] = []
  const vorbei: SichtungsZeile[] = []
  for (const z of zeilen) {
    if (terminVorbei({ veranstaltung_am: z.veranstaltungAm }, heute))
      vorbei.push(z)
    else zuBeurteilen.push(z)
  }
  return { zuBeurteilen, vorbei }
}

/** What the desk shows on a row the run set aside without asking. */
export const VORBEI_BEGRUENDUNG =
  'Der Termin hat vor der Sichtung stattgefunden — kein Vorschlag.'

export const AUSZUG_ZEICHEN = 400

/**
 * The teaser where the list printed one, else the opening of the text — with
 * a visible seam where it is cut. An excerpt rather than the title alone
 * because "Aus dem Gemeinderat" says nothing, and at one or two items per
 * municipality and day the excerpt costs next to nothing.
 */
export function auszugVon(
  zeile: { teaser: string | null; text: string | null },
  max = AUSZUG_ZEICHEN
): string {
  const quelle =
    (zeile.teaser ?? '').trim() !== ''
      ? (zeile.teaser ?? '')
      : (zeile.text ?? '')
  return gekuerzt(quelle.replace(/\s+/g, ' ').trim(), max)
}

export const ANHANG_NAMEN_MAX = 4

/**
 * ": Flyer A, Flyer B (2 weitere)" — the attachments' names, capped and
 * declared; '' when none are known. The newsroom's rule of 1 October 2026:
 * a notice with flyers behind it weighs more, someone is making an effort
 * to push an offer — and a count cannot tell a flyer from a Reglement.
 */
function anhangNamenText(namen: readonly string[]): string {
  const bekannt = namen.map((n) => n.trim()).filter((n) => n !== '')
  if (bekannt.length === 0) return ''
  const gezeigt = bekannt
    .slice(0, ANHANG_NAMEN_MAX)
    .map((n) => (n.length > 60 ? `${n.slice(0, 57)}…` : n))
  const rest = bekannt.length - gezeigt.length
  return `: ${gezeigt.join(', ')}${rest > 0 ? ` (${rest} weitere)` : ''}`
}

export function buildSichtungPrompt(
  gemeinde: string,
  zeilen: readonly SichtungsZeile[],
  digest: string,
  /** The desk's Sichtung rules, already rendered (`regelnBlock`) — user turn, like the digest. */
  regeln = ''
): string {
  const eintrag = (z: SichtungsZeile, i: number): string[] => {
    const kopf = [
      z.veranstaltungAm === null
        ? z.kategorie
        : `Termin am ${datumDeutsch(z.veranstaltungAm)}`,
      z.publiziertAm === null ? null : datumDeutsch(z.publiziertAm)
    ]
      .filter((t): t is string => t !== null && t !== '')
      .join(' · ')
    const zeilenDazu = [
      `${i + 1}. ${kopf === '' ? '' : `[${kopf}] `}"${z.titel}"`
    ]
    if (z.auszug !== '') zeilenDazu.push(`   Auszug: ${z.auszug}`)
    if (z.textAbgeschnitten)
      zeilenDazu.push('   (Der Text wurde beim Lesen gekuerzt.)')
    if (z.anhaenge > 0)
      zeilenDazu.push(
        `   (${z.anhaenge} ${z.anhaenge === 1 ? 'Anhang' : 'Anhaenge'}, davon gelesen: ${z.anhaengeGelesen}${anhangNamenText(z.anhangNamen)})`
      )
    if (z.kalender !== null) zeilenDazu.push(`   ${z.kalender}`)
    return zeilenDazu
  }
  return [
    `Gemeinde: ${gemeinde}`,
    '',
    'Neue Mitteilungen auf der Gemeindewebsite:',
    ...zeilen.flatMap(eintrag),
    ...(regeln === '' ? [] : ['', regeln]),
    ...(digest === '' ? [] : ['', digest]),
    '',
    `Beurteile alle ${zeilen.length} und antworte fuer jede mit ihrer Nummer.`
  ].join('\n')
}

// ---------------------------------------------------------------------------
// 1b. Kalender-Abgleich — what the events desk already carries on the days an item names
// ---------------------------------------------------------------------------
//
// Until 1 October 2026 the one cross-check here was the Abfuhrkalender. The
// newsroom retired it: the waste calendar is complete and correct by
// assumption, so a waste notice is a Meldung only when a collection is
// cancelled or moved — a prompt rule, no calendar in the prompt. What the
// newsroom asked for instead, on Münchenstein's "Offene Turnhalle" (four
// Sundays, three flyers, absent from the municipality's own events calendar):
// does the events desk already carry this? The grade stays the model's; the
// code says what the calendar holds on the days the item names.

/** An events-desk row as the cross-check reads it. */
export interface KalenderAnlass {
  titel: string
  lokalitaet: string | null
  von: string
  bis: string | null
  termine: readonly string[] | null
  rhythmus: string | null
}

/** Whether any calendar is registered for the municipality at all, and the rows ahead. */
export interface KalenderStand {
  vorhanden: boolean
  anlaesse: readonly KalenderAnlass[]
}

export interface AbgleichZeile {
  titel: string
  teaser: string | null
  text: string | null
  anhaenge?: ReadonlyArray<{ gelesen: boolean; text?: string | null }> | null
}

/**
 * The days ahead an item names — in its title, teaser, text and READ
 * attachments, the same material the Meldung's termin is bound to. The
 * flyers are where the later dates stand (measured: the text named two of
 * four Sundays, every flyer all four).
 */
export function kuenftigeTage(zeile: AbgleichZeile, heute: string): string[] {
  const material = [
    zeile.titel,
    zeile.teaser ?? '',
    zeile.text ?? '',
    ...(zeile.anhaenge ?? []).map((a) => (a.gelesen ? (a.text ?? '') : ''))
  ].join('\n')
  return alleDaten(material, heuteAus(heute)).filter((tag) => tag >= heute)
}

const ABGLEICH_MAX_TAGE = 8
const ABGLEICH_MAX_ANLAESSE = 4

function anlassAnTag(a: KalenderAnlass, tag: string): boolean {
  if (a.termine !== null && a.termine.includes(tag)) return true
  if (a.von === tag) return true
  // A running span (an exhibition, a Ferienpass) covers every day between
  // its ends; a series of single dates does not — its row names them all.
  return (
    a.rhythmus === 'laufend' && a.bis !== null && a.von <= tag && tag <= a.bis
  )
}

/**
 * For every day ahead the item names: what the events desk carries on it.
 * A fact for the prompt, never a verdict — "25. Oktober 2026: kein Anlass im
 * Veranstaltungskalender" lets the model see that nobody else brings this,
 * "im Kalender «Herbstmarkt»" that the events desk has it. Null when the
 * item names no day ahead: most notices do not, and a line on every one
 * would be noise. A day beyond the calendar's read horizon is said to be
 * beyond it — "not in the calendar" would be a claim the run never checked.
 */
export function kalenderAbgleich(
  zeile: AbgleichZeile,
  kalender: KalenderStand,
  heute: string,
  horizontTage = VERANSTALTUNGS_FENSTER_TAGE
): string | null {
  const tage = kuenftigeTage(zeile, heute)
  if (tage.length === 0) return null
  if (!kalender.vorhanden) {
    return 'Kalender-Abgleich: kein Veranstaltungskalender dieser Gemeinde erfasst — der Veranstaltungs-Tisch bringt hier nichts.'
  }
  const horizont = verschiebe(heute, horizontTage)
  const teile = tage.slice(0, ABGLEICH_MAX_TAGE).map((tag) => {
    if (tag > horizont) {
      return `${datumDeutsch(tag)}: jenseits des gelesenen Kalenderfensters (${horizontTage} Tage)`
    }
    const dran = kalender.anlaesse.filter((a) => anlassAnTag(a, tag))
    if (dran.length === 0) {
      return `${datumDeutsch(tag)}: kein Anlass im Veranstaltungskalender`
    }
    const gezeigt = dran.slice(0, ABGLEICH_MAX_ANLAESSE).map((a) => {
      const ort = (a.lokalitaet ?? '').trim()
      return `«${a.titel}»${ort === '' ? '' : ` (${ort})`}`
    })
    const rest = dran.length - gezeigt.length
    return `${datumDeutsch(tag)}: im Kalender ${gezeigt.join(', ')}${rest > 0 ? ` (${rest} weitere)` : ''}`
  })
  const rest = tage.length - ABGLEICH_MAX_TAGE
  return `Kalender-Abgleich: ${teile.join('; ')}${rest > 0 ? `; (${rest} weitere Tage nicht abgeglichen)` : ''}`
}

// ---------------------------------------------------------------------------
// 2. Cleanup — the desk empties itself
// ---------------------------------------------------------------------------

/** How long an unproposed item waits before the desk drops it. */
export const AUFRAEUM_TAGE = 7
/** How long an undecided PROPOSAL waits before it counts as left lying. */
export const VORSCHLAG_VERFALL_TAGE = 14

export interface AufraeumZeile {
  id: string
  entscheid: string
  vorschlag: boolean | null
  publiziert_am: string | null
  date_created: string | null
  /** Set on an events row; it is what retires the row instead of its age. */
  veranstaltung_am: string | null
}

function alterInTagen(datum: string | null, heute: string): number | null {
  if (datum === null) return null
  const tage = Math.floor(
    (Date.parse(heute) - Date.parse(datum.slice(0, 10))) / 86_400_000
  )
  return Number.isFinite(tage) ? tage : null
}

/**
 * Two rules, different in kind. What the Sichtung did not propose is not
 * wrong, only unremarkable, and after a week it is stale: deleted. A PROPOSAL
 * the editor let lie is a signal — "not worth a click" is the loudest form of
 * "too many proposals" — so after two weeks it becomes `verfallen` and counts
 * in the next Sichtung's tally. Municipal news is perishable, unlike a permit
 * with a deadline, which is why a proposal here does not wait for ever.
 *
 * Never inside the run's own look-back window (a row deleted and re-fetched
 * minutes later is a triage paid twice), and never for a decided row.
 */
export function aufraeumAktion(
  zeile: AufraeumZeile,
  heute: string,
  fensterTage = 0
): 'verfallen' | 'loeschen' | null {
  if (zeile.entscheid !== 'offen') return null

  // An events row is a row of the OLD shape: since 20 September 2026 the
  // events desk carries every Anlass, and nothing arrives here with a date
  // any more. Such a row waits for nothing — it is retired outright, on its
  // day or before it, what was a proposal lapsing as memory and the rest
  // going. Measured on 29 September 2026: a Strick-Treff two months out stood
  // between the news for nine days because the old rule let it wait for its
  // day. The run's look-back window does not protect it either — the forward
  // window can never fetch such a row back.
  if (typeof zeile.veranstaltung_am === 'string')
    return zeile.vorschlag === true ? 'verfallen' : 'loeschen'

  const alter = alterInTagen(zeile.publiziert_am ?? zeile.date_created, heute)
  if (alter === null || alter < fensterTage) return null
  if (zeile.vorschlag === true)
    return alter >= VORSCHLAG_VERFALL_TAGE ? 'verfallen' : null
  return alter >= AUFRAEUM_TAGE ? 'loeschen' : null
}

// ---------------------------------------------------------------------------
// 3. The Meldung
// ---------------------------------------------------------------------------

export interface MitteilungAnhangFakt {
  bezeichnung: string
  url: string
  typ: 'pdf' | 'link'
  gelesen: boolean
  text: string | null
  grund: string | null
}

export interface MitteilungFakten {
  gemeinde: string
  titel: string
  teaser: string | null
  publiziertAm: string | null
  /** The day the event takes place — on an events row; null on a news row. */
  veranstaltungAm: string | null
  kategorie: string | null
  text: string
  textAbgeschnitten: boolean
  anhaenge: readonly MitteilungAnhangFakt[]
  /** The page the article is shown on — canonical where known, else the list link. */
  url: string
  /**
   * Every calendar day CODE found in the wording and the read attachments —
   * the only days the model may name as the article's termin. Optional
   * because older callers and fixtures predate it; absent means "none found".
   */
  datenImText?: readonly string[]
}

export const MELDUNG_SYSTEM_PROMPT = `Du schreibst fuer eine lokale Redaktion in der Region Basel kurze Meldungen aus Mitteilungen, die Gemeinden auf ihrer offiziellen Website veroeffentlichen.

Regeln, ohne Ausnahme:
- Verwende NUR die Fakten aus dem uebergebenen Wortlaut und den gelesenen
  Anhaengen. Erfinde nichts und rechne nichts aus.
- Schreibe in EIGENEN Worten. Der Text der Gemeinde ist ihre Selbstdarstellung,
  nicht unsere Meldung: uebernimm keine Saetze, keine Werbeformeln ("freut
  sich", "attraktiv", "einladend"), keine Aufrufe. Berichte die Sache.
- Nenne die Quelle IM TEXT mit dem genauen Namen der Gemeinde: "wie die
  Gemeinde {Name} mitteilt", "teilt die Gemeinde {Name} mit" oder "laut der
  Gemeinde {Name}".
- Nenne Daten ABSOLUT ("am 22. September 2026"), niemals relativ ("naechste
  Woche", "ab morgen"). Der Text muss in fuenf Jahren noch stimmen.
- Behoerdenmitglieder und Verwaltungsleute in ihrer Funktion darfst du nennen.
  Private Personen nennst du nur, wenn die Mitteilung sie selbst nennt und die
  Sache es verlangt.
- Zahlen genau so, wie sie im Wortlaut stehen. Keine Adressen, keine Links —
  die Quellenzeile setzt der Code.
- Ein Anlass braucht Datum, Zeit und Ort, wo sie dastehen; eine Frist gehoert
  in den Lead.
- Schreibe nuechtern und knapp. Keine Wertung, keine Dramatisierung.
- Schweizer Rechtschreibung: "ss" statt "ß".

Umfang: Titel (maximal 70 Zeichen), Lead (ein Satz), Text (ein bis zwei kurze
Absaetze, durch eine Leerzeile getrennt).

Zusaetzlich beurteilst du zwei Dinge FUER DEN NEWSLETTER — sie erscheinen
nicht im Text:
- "termin": Hat die Mitteilung einen Tag, an dem sie fuer die Leserin zaehlt
  — eine Sperrung ab, ein Anlass am, eine Frist bis, eine Aenderung gueltig
  ab? Dann nenne "ideal" (den ersten Tag, an dem es gilt, oder die Frist) und
  "ende" (den letzten Tag, an dem die Meldung noch Sinn hat — bei einer
  Sperrung ihr letzter Tag, sonst derselbe wie "ideal"). NUR Tage aus der
  Liste "Im Wortlaut genannte Tage"; steht der passende Tag nicht dort, ist
  "termin" null. Ein Beschluss, eine Personalie, eine Rechnung, ein Bericht
  ohne Stichtag hat "termin": null.
- "wichtig": true, wenn die Sache fuer viele im Dorf zaehlt und eine FRUEHE
  Ankuendigung verdient — ein Dorffest, eine Gemeindeversammlung, eine
  Strassensperrung, ein Unterbruch bei Wasser, Strom oder Fernwaerme, eine
  Abstimmung, ein Baustart mit Folgen fuer die Nachbarschaft. false bei
  Routine, kleinen Anlaessen und Fristen, die nur wenige betreffen. Stehen
  unten Entscheide der Redaktion, richte dich danach.

Antworte ausschliesslich mit JSON:
{"titel": "...", "lead": "...", "text": "...", "termin": {"ideal": "JJJJ-MM-TT", "ende": "JJJJ-MM-TT"} | null, "wichtig": true | false}`

export const MAX_TEXT = 12_000
export const MAX_ANHANG = 6_000
export const MAX_ANHAENGE_GESAMT = 20_000

function anhangZeilen(anhaenge: readonly MitteilungAnhangFakt[]): string[] {
  if (anhaenge.length === 0) return []
  const zeilen: string[] = ['']
  let budget = MAX_ANHAENGE_GESAMT
  const ausgelassen: string[] = []
  for (const a of anhaenge) {
    if (!a.gelesen || a.text === null || a.text.trim() === '') {
      zeilen.push(
        `Anhang "${a.bezeichnung}" liegt vor, wurde aber nicht gelesen (${a.grund ?? 'kein Text'}) — behaupte nichts ueber seinen Inhalt.`
      )
      continue
    }
    if (budget <= 0) {
      ausgelassen.push(a.bezeichnung)
      continue
    }
    const stueck = gekuerzt(a.text.trim(), Math.min(MAX_ANHANG, budget))
    budget -= stueck.length
    zeilen.push(`Anhang "${a.bezeichnung}" (PDF, gelesen):`, stueck, '')
  }
  if (ausgelassen.length > 0) {
    zeilen.push(
      `(${ausgelassen.length} weitere gelesene Anhaenge nicht aufgefuehrt: ${ausgelassen.join(', ')})`
    )
  }
  return zeilen
}

function faktenZeilen(fakten: MitteilungFakten): string[] {
  return [
    `Gemeinde: ${fakten.gemeinde}`,
    fakten.veranstaltungAm === null
      ? `Mitteilung der Gemeinde${fakten.publiziertAm === null ? '' : ` vom ${datumDeutsch(fakten.publiziertAm)}`}${fakten.kategorie === null ? '' : ` (Kategorie: ${fakten.kategorie})`}`
      : `Veranstaltung aus dem Veranstaltungskalender der Gemeinde, Termin am ${datumDeutsch(fakten.veranstaltungAm)}`,
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
    ...anhangZeilen(fakten.anhaenge),
    ...terminTageZeilen(fakten.datenImText ?? [])
  ]
}

export function buildMitteilungPrompt(
  fakten: MitteilungFakten,
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
export function buildMitteilungRevision(
  fakten: MitteilungFakten,
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

export const QUELLE_DOKUMENTE_MAX = 3

/**
 * The source line, appended by code — never left to the model. The page the
 * item is shown on comes first; the read documents follow, one paragraph each
 * (the renderer splits on blank lines), at most three.
 */
export function quelleZeile(fakten: MitteilungFakten): string {
  const datum =
    fakten.publiziertAm === null
      ? ''
      : ` vom ${datumDeutsch(fakten.publiziertAm)}`
  const teile = [
    fakten.veranstaltungAm === null
      ? `Quelle: Mitteilung der Gemeinde ${fakten.gemeinde}${datum}, ${fakten.url}`
      : `Quelle: Veranstaltungskalender der Gemeinde ${fakten.gemeinde}, ${fakten.url}`
  ]
  const gelesene = fakten.anhaenge.filter((a) => a.gelesen)
  for (const a of gelesene.slice(0, QUELLE_DOKUMENTE_MAX))
    teile.push(`Dokument: ${a.bezeichnung}, ${a.url}`)
  if (gelesene.length > QUELLE_DOKUMENTE_MAX)
    teile.push('Weitere Dokumente auf der Seite der Gemeinde.')
  return teile.join('\n\n')
}

export function mitQuelle(text: string, fakten: MitteilungFakten): string {
  return `${text.trim()}\n\n${quelleZeile(fakten)}`
}

/** The whole handed material — what the verbatim-overlap check runs against. */
export function volltextVon(
  fakten: Pick<MitteilungFakten, 'text' | 'anhaenge'>
): string {
  return [fakten.text, ...fakten.anhaenge.map((a) => a.text ?? '')]
    .filter((t) => t.trim() !== '')
    .join('\n\n')
}

// ---------------------------------------------------------------------------
// The checks — a prompt is a request, a check is a rule
// ---------------------------------------------------------------------------

const ATTRIBUTION =
  /mitteil|teilt\b.{0,60}?\bmit\b|informier|laut der gemeinde|gem[äa]e?ss der gemeinde|schreibt die gemeinde|meldet die gemeinde|gibt\b.{0,60}?\bbekannt|bekannt ?gegeben|wie die gemeinde|so die gemeinde|nach angaben der gemeinde/i

/**
 * The municipality must be named AS the source: its exact name, and a word
 * that says it is telling us. Reported, then retried once — an article built
 * from a municipality's announcement that does not say so reads as the
 * newsroom's own reporting, which it is not.
 */
export function attributionsWarnung(
  text: string,
  fakten: Pick<MitteilungFakten, 'gemeinde'>
): string | null {
  const klein = text.normalize('NFC').toLowerCase()
  const name = fakten.gemeinde.normalize('NFC').toLowerCase()
  if (!klein.includes(name))
    return `Die Meldung nennt die Gemeinde ${fakten.gemeinde} nicht als Quelle.`
  if (!ATTRIBUTION.test(klein)) {
    return `Die Meldung sagt nicht, dass die Gemeinde ${fakten.gemeinde} die Quelle ist ("wie die Gemeinde ${fakten.gemeinde} mitteilt").`
  }
  return null
}

/**
 * Every digit in the text must come from the handed material. Run BEFORE
 * `mitQuelle` appends the addresses, whose digits are nobody's claim.
 */
export function zahlWarnungen(
  text: string,
  fakten: MitteilungFakten
): string[] {
  const erlaubt = new Set<string>()
  const sammle = (quelle: string | null): void => {
    if (quelle === null) return
    for (const treffer of quelle.matchAll(/\d+/g)) {
      erlaubt.add(treffer[0])
      // "07" in an ISO date is spoken as "7" in prose.
      erlaubt.add(String(Number(treffer[0])))
    }
  }
  sammle(fakten.titel)
  sammle(fakten.teaser)
  sammle(fakten.publiziertAm)
  sammle(fakten.veranstaltungAm)
  sammle(fakten.text)
  for (const a of fakten.anhaenge) sammle(a.text)

  const gefunden = [...text.matchAll(/\d+/g)].map((t) => t[0])
  return [...new Set(gefunden.filter((z) => !erlaubt.has(z)))].map(
    (z) => `Zahl "${z}" steht nicht in den Angaben.`
  )
}

/** Today as the date helpers want it — one place to build it from the ISO day. */
export function heuteFuer(heute: string): Heute {
  return heuteAus(heute)
}
