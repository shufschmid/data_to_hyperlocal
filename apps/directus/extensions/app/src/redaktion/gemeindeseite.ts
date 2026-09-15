// The municipal-news desk: what the Sichtung asks, how a Meldung is written
// from a municipality's own announcement, and the checks next to the prompts.
//
// Pure. The Directus-bound half is `gemeindeseitenlauf.ts`, the reader is
// `shared/gemeindeseite/`. Wherever the gazette desk already had the right
// shape — the triage schema and parser, the example digest, the German date —
// it is imported and re-exported under this desk's names rather than copied:
// one parser, one digest renderer, one date formatter.

import { alleDaten, heuteAus, type Heute } from '../shared/gemeindeseite'
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
  parseMeldungstext as parseMitteilung
} from './spielbericht'

// ---------------------------------------------------------------------------
// 1. Sichtung — sorts, never filters
// ---------------------------------------------------------------------------

/**
 * Byte-identical across a run. Everything per municipality — its name, its
 * decision history, its waste calendar — goes into the user turn.
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
weitergereichte Vereinsanlaesse (die kommen ueber die Wochenblaetter),
Baupublikationen und amtliche Anzeigen (die kommen ueber das Amtsblatt),
Rueckblicke, Fotogalerien, Gratulationen, Hinweise auf den eigenen Newsletter.

Abfuhren: Eine Mitteilung, die nur Abfuhrtermine ankuendigt, die im
mitgegebenen Abfuhrkalender schon stehen, ist KEIN Vorschlag — die Erinnerung
schreibt der Entsorgungs-Tisch. Faellt eine Abfuhr aus, wird sie verschoben,
kommt eine neue hinzu oder aendert sich der Ablauf, ist das eine Meldung.
Begruende mit dem Abgleich, der bei der Mitteilung steht.

Im Zweifel: nein. Die nicht vorgeschlagenen Mitteilungen verschwinden nicht,
sie stehen der Redaktion weiterhin zur Verfuegung — ein falsches Ja kostet
Aufmerksamkeit, ein falsches Nein kostet einen Klick. Die Bilanz und die
Beispiele der Redaktion zeigen, was sie tatsaechlich aufgreift: ein Vorschlag,
den sie liegen liess, war ein Fehlvorschlag.

Begruende jeden Entscheid in EINEM kurzen Satz, der sagt WARUM, nicht WAS.

Weiterreichen an die Chefredaktion: NUR wenn eine der nummerierten Regeln der
Redaktion (R1, R2, …) verlangt, dass solche Mitteilungen an die Chefredaktion
gehen, setze "empfehlung": "weiterreichen" und nenne die Nummer dieser Regel
in "empfehlung_regel". Ohne eine solche Regel sind beide null.

Antworte ausschliesslich mit JSON:
{"urteile": [{"nummer": 1, "vorschlag": true, "begruendung": "...", "empfehlung": null, "empfehlung_regel": null}]}`

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
  /** The waste-calendar cross-check for this item, when it talks about collections. */
  abfuhr: string | null
}

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

export function buildSichtungPrompt(
  gemeinde: string,
  zeilen: readonly SichtungsZeile[],
  digest: string,
  /** The desk's Sichtung rules, already rendered (`regelnBlock`) — user turn, like the digest. */
  regeln = '',
  /** The municipality's waste calendar, already rendered (`abfuhrkalenderBlock`); '' when no item talks about collections. */
  abfuhrkalender = ''
): string {
  const eintrag = (z: SichtungsZeile, i: number): string[] => {
    const kopf = [
      z.kategorie,
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
        `   (${z.anhaenge} ${z.anhaenge === 1 ? 'Anhang' : 'Anhaenge'}, davon gelesen: ${z.anhaengeGelesen})`
      )
    if (z.abfuhr !== null) zeilenDazu.push(`   ${z.abfuhr}`)
    return zeilenDazu
  }
  return [
    `Gemeinde: ${gemeinde}`,
    '',
    'Neue Mitteilungen auf der Gemeindewebsite:',
    ...zeilen.flatMap(eintrag),
    ...(abfuhrkalender === '' ? [] : ['', abfuhrkalender]),
    ...(regeln === '' ? [] : ['', regeln]),
    ...(digest === '' ? [] : ['', digest]),
    '',
    `Beurteile alle ${zeilen.length} und antworte fuer jede mit ihrer Nummer.`
  ].join('\n')
}

// ---------------------------------------------------------------------------
// 1b. Waste collections — what the calendar already announces is no proposal
// ---------------------------------------------------------------------------

export interface AbfuhrTermin {
  kategorie: string
  zone: string | null
  datum: string
}

const ABFUHR_WORTE =
  /\b(?:abfuhr\w*|kehricht\w*|gr[üu]e?ngut\w*|papiersammlung\w*|kartonsammlung\w*|altpapier\w*|h[äa]e?ckseldienst\w*|altmetall\w*|sonderabf[äa]e?ll\w*|sperrgut\w*|entsorgung\w*|sammelstell\w*|abfallkalender\w*|abfuhrkalender\w*|bioabf[äa]e?ll\w*|kompost\w*)\b/iu

/** Whether an item talks about waste collections at all — the gate for loading the calendar. */
export function hatAbfuhrbezug(zeile: {
  titel: string
  teaser: string | null
  text: string | null
}): boolean {
  return ABFUHR_WORTE.test(
    `${zeile.titel}\n${zeile.teaser ?? ''}\n${zeile.text ?? ''}`.normalize(
      'NFC'
    )
  )
}

const ABGLEICH_MAX_DATEN = 8

/**
 * For every day the item names: what the calendar has on it. A fact for the
 * prompt, never a verdict — "22.09.2026: im Abfuhrkalender (Papier)" lets the
 * model see that the item merely repeats the calendar, "nicht im
 * Abfuhrkalender" that something changed.
 */
export function abfuhrAbgleich(
  zeile: { titel: string; teaser: string | null; text: string | null },
  termine: readonly AbfuhrTermin[],
  heute: Heute
): string | null {
  const daten = alleDaten(
    `${zeile.titel}\n${zeile.teaser ?? ''}\n${zeile.text ?? ''}`,
    heute
  )
  if (daten.length === 0)
    return 'Abfuhr-Abgleich: Die Mitteilung nennt keinen konkreten Tag.'
  const teile = daten.slice(0, ABGLEICH_MAX_DATEN).map((datum) => {
    const dran = termine.filter((t) => t.datum === datum)
    if (dran.length === 0)
      return `${datumDeutsch(datum)}: nicht im Abfuhrkalender`
    const was = dran
      .map((t) => `${t.kategorie}${t.zone === null ? '' : ` (${t.zone})`}`)
      .join(', ')
    return `${datumDeutsch(datum)}: im Abfuhrkalender (${was})`
  })
  const rest = daten.length - ABGLEICH_MAX_DATEN
  return `Abfuhr-Abgleich: ${teile.join('; ')}${rest > 0 ? `; (${rest} weitere Tage nicht abgeglichen)` : ''}`
}

export const KALENDER_TERMINE_MAX = 40

/**
 * The municipality's calendar as the Sichtung sees it — the dates ahead,
 * capped and declared, plus the regular collections the calendar keeps as a
 * note. Without a calendar the block says so, and waste items are judged like
 * any other.
 */
export function abfuhrkalenderBlock(
  gemeinde: string,
  kalender: {
    vorhanden: boolean
    termine: readonly AbfuhrTermin[]
    merkblatt: string | null
  },
  max = KALENDER_TERMINE_MAX
): string {
  if (!kalender.vorhanden) {
    return `Abfuhrkalender ${gemeinde}: keiner erfasst — Abfuhrtermine wie jede andere Mitteilung beurteilen.`
  }
  const sortiert = [...kalender.termine].sort((a, b) =>
    a.datum.localeCompare(b.datum)
  )
  const gezeigt = sortiert.slice(0, max)
  const zeilen = [
    `Abfuhrkalender ${gemeinde} (bekannte Termine, ${gezeigt.length === 0 ? 'keine im Fenster' : `${gezeigt.length} im Fenster`}):`,
    ...(gezeigt.length === 0
      ? []
      : [
          gezeigt
            .map(
              (t) =>
                `${t.datum.slice(8, 10)}.${t.datum.slice(5, 7)}. ${t.kategorie}${t.zone === null ? '' : ` (${t.zone})`}`
            )
            .join(' · ')
        ]),
    ...(sortiert.length > max
      ? [`(${sortiert.length - max} weitere Termine nicht aufgefuehrt)`]
      : [])
  ]
  if (kalender.merkblatt !== null && kalender.merkblatt.trim() !== '') {
    zeilen.push(
      `Regelmaessige Abfuhren laut Merkblatt: ${gekuerzt(kalender.merkblatt.replace(/\s+/g, ' ').trim(), 600)}`
    )
  }
  return zeilen.join('\n')
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
  kategorie: string | null
  text: string
  textAbgeschnitten: boolean
  anhaenge: readonly MitteilungAnhangFakt[]
  /** The page the article is shown on — canonical where known, else the list link. */
  url: string
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

Antworte ausschliesslich mit JSON:
{"titel": "...", "lead": "...", "text": "..."}`

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
    `Mitteilung der Gemeinde${fakten.publiziertAm === null ? '' : ` vom ${datumDeutsch(fakten.publiziertAm)}`}${fakten.kategorie === null ? '' : ` (Kategorie: ${fakten.kategorie})`}`,
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
    ...anhangZeilen(fakten.anhaenge)
  ]
}

export function buildMitteilungPrompt(
  fakten: MitteilungFakten,
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
export function buildMitteilungRevision(
  fakten: MitteilungFakten,
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
    `Quelle: Mitteilung der Gemeinde ${fakten.gemeinde}${datum}, ${fakten.url}`
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
