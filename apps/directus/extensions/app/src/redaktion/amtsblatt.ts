/**
 * The official gazette feed's editorial rules — the prompts and, next to each,
 * the check that enforces what the prompt asks for.
 *
 * Three model calls live here, and they are deliberately different sizes:
 *   1. the triage, once per municipality per run, over titles only;
 *   2. the plan reading, only for what the triage proposed or an editor asked
 *      for, over the actual drawings;
 *   3. the article, only once an editor takes a publication over.
 * Nothing is written without a person's decision.
 */

import type Anthropic from '@anthropic-ai/sdk'
import type { Angabe, Gruppe, Planbild, Unterlage } from '../shared/amtsblatt'
import { GRUPPEN_TEXT } from '../shared/amtsblatt'

export { parseSpielbericht as parseAmtsblattMeldung } from './spielbericht'

// ---------------------------------------------------------------------------
// 1. Triage — which of the day's publications deserve an editor's minute
// ---------------------------------------------------------------------------

/**
 * Byte-identical across a run, like `buildArtikelSystemPrompt`. Everything that
 * differs per municipality — its name, its own decision history — goes into the
 * user turn, or the prompt cache is worthless and only the invoice shows it.
 */
export const TRIAGE_SYSTEM_PROMPT = `Du sichtest fuer eine lokale Redaktion in der Region Basel die amtlichen Publikationen einer Gemeinde und entscheidest, welche davon eine Redaktorin ansehen sollte.

Beurteile jede Publikation einzeln. Es geht NICHT darum, ob sie amtlich wichtig
ist, sondern ob daraus eine Meldung fuer die Leserschaft der Gemeinde werden
koennte.

Sprich dafuer: Vorhaben mit Wirkung ueber ein Grundstueck hinaus (Neubauten,
Umnutzungen, Mobilfunk, Solaranlagen auf oeffentlichen Bauten, Strassen- und
Leitungsprojekte), Beschluesse von Gemeinde- und Einwohnerrat, Abstimmungen und
Referendumsfristen, Planauflagen, Verkehrsanordnungen mit spuerbarer Wirkung,
Firmen mit erkennbarer lokaler Bedeutung (Neugruendung mit Betrieb vor Ort,
Konkurs eines bekannten Betriebs), alles mit einer laufenden Einsprache- oder
Auflagefrist.

Dagegen: private Kleinbauten (Wintergarten, Whirlpool, Balkon, Gartenhaus,
Dachfenster, Fassadenanstrich), Routinemutationen im Handelsregister
(Zeichnungsberechtigung, Adressaenderung, Domizilwechsel), einzelne
Handaenderungen von Wohneigentum, Zahlungsbefehle und Betreibungen gegen
Privatpersonen, Erbschaftsuebernahmen, Stelleninserate.

Im Zweifel: nein. Die abgelehnten Publikationen verschwinden nicht, sie stehen
der Redaktion weiterhin zur Verfuegung — ein falsches Ja kostet Aufmerksamkeit,
ein falsches Nein kostet einen Klick.

Begruende jeden Entscheid in EINEM kurzen Satz, der sagt WARUM, nicht WAS.

Antworte ausschliesslich mit JSON:
{"urteile": [{"nummer": 1, "vorschlag": true, "begruendung": "..."}]}`

export const TRIAGE_SCHEMA = {
  type: 'object',
  properties: {
    urteile: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          nummer: { type: 'integer' },
          vorschlag: { type: 'boolean' },
          begruendung: { type: 'string' }
        },
        required: ['nummer', 'vorschlag', 'begruendung'],
        additionalProperties: false
      }
    }
  },
  required: ['urteile'],
  additionalProperties: false
} as const

/** One publication as the triage sees it — title, kind, office. No content. */
export interface TriageZeile {
  id: string
  titel: string
  rubrikName: string
  gruppe: Gruppe
  amt: string
}

/** A decision the newsroom already made, fed back as an example. */
export interface LernEintrag {
  titel: string
  rubrikName: string
  entscheid: 'uebernommen' | 'abgelehnt' | 'weitergereicht'
  grund: string | null
}

/**
 * The newsroom's own decisions, per municipality, as few-shot examples.
 *
 * The decision rows ARE the memory — no distillation call, no second store,
 * exactly as in the press review. Scoped per municipality on purpose: what
 * counts as local news in Riehen says little about Dornach.
 */
export function lernDigest(
  eintraege: readonly LernEintrag[],
  max = 20
): string {
  const letzte = eintraege.slice(0, max)
  if (letzte.length === 0) return ''

  const zeile = (e: LernEintrag): string => {
    const urteil =
      e.entscheid === 'uebernommen'
        ? 'ja, daraus wurde eine Meldung'
        : e.entscheid === 'weitergereicht'
          ? 'ja, aber zuerst zu recherchieren'
          : 'nein'
    return `- [${e.rubrikName}] "${e.titel}" → ${urteil}${e.grund === null ? '' : ` (${e.grund})`}`
  }

  return [
    'So hat die Redaktion bei dieser Gemeinde zuletzt entschieden — richte dich danach:',
    ...letzte.map(zeile)
  ].join('\n')
}

export function buildTriagePrompt(
  gemeinde: string,
  zeilen: readonly TriageZeile[],
  digest: string
): string {
  return [
    `Gemeinde: ${gemeinde}`,
    '',
    'Neue amtliche Publikationen:',
    ...zeilen.map(
      (z, i) =>
        `${i + 1}. [${GRUPPEN_TEXT[z.gruppe]} · ${z.rubrikName}] "${z.titel}"` +
        (z.amt === '' ? '' : ` — publiziert von ${z.amt}`)
    ),
    ...(digest === '' ? [] : ['', digest]),
    '',
    `Beurteile alle ${zeilen.length} und antworte fuer jede mit ihrer Nummer.`
  ].join('\n')
}

export interface TriageUrteil {
  id: string
  vorschlag: boolean
  begruendung: string
}

/**
 * Answers back onto rows by position.
 *
 * A publication the model skipped stays `vorschlag: null` — undecided is not
 * "no". It still shows on the desk; it just has no recommendation.
 */
export function parseTriage(
  antwort: unknown,
  zeilen: readonly TriageZeile[]
): TriageUrteil[] {
  if (typeof antwort !== 'object' || antwort === null)
    throw new Error('Antwort ist kein Objekt.')
  const urteile = (antwort as { urteile?: unknown }).urteile
  if (!Array.isArray(urteile)) throw new Error('Feld "urteile" fehlt.')

  const treffer: TriageUrteil[] = []
  const vergeben = new Set<string>()
  for (const roh of urteile) {
    if (typeof roh !== 'object' || roh === null) continue
    const u = roh as Record<string, unknown>
    const nummer = typeof u.nummer === 'number' ? u.nummer : NaN
    const zeile = zeilen[nummer - 1]
    if (zeile === undefined || vergeben.has(zeile.id)) continue
    if (typeof u.vorschlag !== 'boolean') continue
    vergeben.add(zeile.id)
    treffer.push({
      id: zeile.id,
      vorschlag: u.vorschlag,
      begruendung:
        typeof u.begruendung === 'string'
          ? u.begruendung.trim().slice(0, 300)
          : ''
    })
  }
  return treffer
}

/** How long an unproposed publication waits before the desk drops it. */
export const AUFRAEUM_TAGE = 7

export interface AufraeumZeile {
  id: string
  entscheid: string
  vorschlag: boolean | null
  frist: string | null
  publiziert_am: string | null
}

/**
 * Whether an undecided publication has outlived its usefulness.
 *
 * Two rules from the newsroom, and they are different in kind. A passed
 * DEADLINE is final: nobody can object to a building permit whose objection
 * period closed, so the row is of no use to anyone — that holds even for a
 * proposal. Everything the triage did NOT propose is different: it is not
 * wrong, only unremarkable, and after a week untouched it is stale.
 *
 * A proposal WITHOUT a deadline is left alone on purpose. It is the editor's
 * own queue — the number on the tab — and it empties by being decided, not by
 * expiring. Deciding it is also what teaches the next triage; letting it rot
 * away would throw that signal out.
 *
 * Only ever applied to `entscheid === 'offen'`. A decided row is the memory of
 * this feed and is never deleted.
 */
export function darfWeg(
  zeile: AufraeumZeile,
  heute: string,
  tage = AUFRAEUM_TAGE,
  fensterTage = 0
): boolean {
  if (zeile.entscheid !== 'offen') return false

  const alter = alterInTagen(zeile.publiziert_am, heute)

  // Never delete inside the run's own look-back window. Measured the hard way:
  // with a seven-day window and seven-day retention, one run deleted 32 rows
  // and re-fetched them minutes later — paying for the same triage again every
  // morning, for ever.
  if (alter !== null && alter < fensterTage) return false

  if (zeile.frist !== null) return zeile.frist < heute
  if (zeile.vorschlag === true) return false
  return alter !== null && alter >= tage
}

function alterInTagen(datum: string | null, heute: string): number | null {
  if (datum === null) return null
  const alter =
    (Date.parse(`${heute}T00:00:00Z`) - Date.parse(`${datum}T00:00:00Z`)) /
    86_400_000
  return Number.isFinite(alter) ? alter : null
}

// ---------------------------------------------------------------------------
// 2. Reading the plans
// ---------------------------------------------------------------------------

/**
 * A drawing is evidence, not prose, and a model reading one is exactly the
 * situation where invented figures appear. So the prompt asks for what is
 * LEGIBLE and demands the sheet it stood on, and `parsePlanbefund` keeps only
 * findings that name one — an unsourced number is dropped before it can reach
 * an article.
 */
export const PLAN_SYSTEM_PROMPT = `Du siehst die oeffentlich aufgelegten Plaene eines Schweizer Baugesuchs an und berichtest einer Redaktorin, was daraus hervorgeht.

Regeln, ohne Ausnahme:
- Berichte NUR, was auf den Plaenen tatsaechlich lesbar ist. Rechne nichts aus,
  schaetze nichts, ergaenze nichts aus Erfahrung.
- Gib zu jedem Befund an, auf welchem Blatt du ihn gelesen hast (Nummer der
  Abbildung, 1 fuer die erste).
- Uebernimm Zahlen genau so, wie sie dastehen (Geschosse, Wohnungen,
  Parkplaetze, Hoehen, Flaechen, Bauetappen, Baumfaellungen).
- Wenn ein Plan unleserlich ist oder nichts hergibt, sage das und erfinde keinen
  Befund.
- Interessant ist, was ueber den Titel des Baugesuchs HINAUSGEHT: Groesse und
  Nutzung, Zahl der Wohnungen, Abbruch von Bestehendem, Baeume, Parkplaetze,
  Etappierung, Naehe zu oeffentlichen Bauten. Auch Widersprueche zur
  Publikation gehoeren dazu (andere Adresse, neuere Planversion).
- Ueberspringe reine Vermessungs- und Bauphysikdaten: Hoehenkoten, Fixpunkte,
  U-Werte, Wandaufbauten, Raumhoehen, Bezeichnungen einzelner Kellerabteile.
  Die interessieren die Leserschaft nicht.
- Hoechstens ZWOELF Befunde, die zwoelf wichtigsten.

Fasse zusaetzlich in EINEM Satz zusammen, ob die Plaene die Meldung tragen —
also ob sie mehr sagen als der Titel.

Antworte ausschliesslich mit JSON:
{"befunde": [{"blatt": 1, "aussage": "..."}], "fazit": "..."}`

export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    befunde: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          blatt: { type: 'integer' },
          aussage: { type: 'string' }
        },
        required: ['blatt', 'aussage'],
        additionalProperties: false
      }
    },
    fazit: { type: 'string' }
  },
  required: ['befunde', 'fazit'],
  additionalProperties: false
} as const

export function buildPlanMessages(
  bilder: readonly Planbild[],
  kontext: { titel: string; gemeinde: string; angaben: readonly Angabe[] }
): Anthropic.MessageParam[] {
  const bloecke: Anthropic.ContentBlockParam[] = bilder.map((b) => ({
    type: 'image',
    source: { type: 'base64', media_type: b.medienTyp, data: b.base64 }
  }))

  return [
    {
      role: 'user',
      content: [
        ...bloecke,
        {
          type: 'text',
          text: [
            `Das sind die ${bilder.length} aufgelegten Plaene zum Baugesuch`,
            `"${kontext.titel}" in ${kontext.gemeinde}.`,
            '',
            'Aus der amtlichen Publikation ist bekannt:',
            ...kontext.angaben.map((a) => `- ${a.bezeichnung}: ${a.wert}`),
            '',
            'Berichte, was die Plaene darueber hinaus hergeben.'
          ].join('\n')
        }
      ]
    }
  ]
}

export interface Planbefund {
  blatt: number
  aussage: string
}

export interface Planlesung {
  befunde: Planbefund[]
  fazit: string
}

/**
 * Twelve is the cap, and it is not arbitrary: the first run over an eight-sheet
 * building file came back with 24 findings, half of them survey marks and
 * cellar labels. The article prompt is handed this list as its only source, so
 * a long one buys nothing and costs the checks their teeth — every digit in it
 * becomes an allowed digit.
 */
export const PLAN_MAX_BEFUNDE = 12

export function parsePlanbefund(
  antwort: unknown,
  anzahlBilder: number
): Planlesung {
  if (typeof antwort !== 'object' || antwort === null)
    throw new Error('Antwort ist kein Objekt.')
  const roh = antwort as Record<string, unknown>
  const rohe = Array.isArray(roh.befunde) ? roh.befunde : []

  const befunde: Planbefund[] = []
  for (const e of rohe) {
    if (typeof e !== 'object' || e === null) continue
    const b = e as Record<string, unknown>
    const blatt = typeof b.blatt === 'number' ? b.blatt : NaN
    const aussage = typeof b.aussage === 'string' ? b.aussage.trim() : ''
    // A finding whose sheet does not exist has no source we can point at.
    if (!Number.isInteger(blatt) || blatt < 1 || blatt > anzahlBilder) continue
    if (aussage === '') continue
    befunde.push({ blatt, aussage })
  }

  return {
    befunde: befunde.slice(0, PLAN_MAX_BEFUNDE),
    fazit: typeof roh.fazit === 'string' ? roh.fazit.trim() : ''
  }
}

// ---------------------------------------------------------------------------
// 3. The article
// ---------------------------------------------------------------------------

export interface AmtsblattFakten {
  gemeinde: string
  kanton: string
  titel: string
  rubrikName: string
  gruppe: Gruppe
  amt: string
  publiziertAm: string
  frist: string | null
  angaben: readonly Angabe[]
  /** Findings from the plans, already checked — empty when none were read. */
  planbefunde: readonly string[]
  /** Names the publication attributes to natural persons — kept OUT of the text. */
  personen: readonly string[]
  pdfUrl: string
  /** The document link that belongs in the article, when there is a readable one. */
  unterlage: Unterlage | null
}

export const AMTSBLATT_SYSTEM_PROMPT = `Du schreibst fuer eine lokale Redaktion in der Region Basel kurze Meldungen aus amtlichen Publikationen (Amtsblatt des Kantons, SHAB).

Regeln, ohne Ausnahme:
- Verwende NUR die Fakten aus den Angaben. Erfinde nichts und rechne nichts aus.
  Auch keine Umrechnung von Flaechen, Kosten oder Anteilen.
- Nenne die Quelle IM TEXT: "wie das Amtsblatt des Kantons {Kanton} publiziert"
  oder, beim Handelsregister, "wie das Schweizerische Handelsamtsblatt meldet".
- Nenne Daten ABSOLUT ("bis zum 7. September 2026"), niemals relativ ("bis
  naechste Woche", "in einem Monat"). Der Text muss in fuenf Jahren noch
  stimmen. Das gilt besonders fuer Einsprache- und Auflagefristen: sie sind der
  Grund, warum die Meldung erscheint.
- Wo eine Frist laeuft, gehoert sie in den Lead.
- Nenne KEINE Namen natuerlicher Personen und keine privaten Wohnadressen, auch
  wenn sie in den Angaben stehen. Firmen, Aemter und Behoerdenmitglieder in
  ihrer Funktion nennst du. Die amtliche Publikation darf Namen nennen; eine
  redaktionelle Meldung entscheidet das eigenstaendig, und die Redaktorin
  ergaenzt sie von Hand, wenn sie es will.
- Strassennamen und Parzellennummern des Vorhabens nennst du — das ist der Ort,
  nicht die Person.
- Schreibe nuechtern und knapp. Keine Wertung, keine Dramatisierung.
- Schweizer Rechtschreibung: "ss" statt "ß".

Umfang: Titel (maximal 70 Zeichen), Lead (ein Satz), Text (ein bis zwei kurze
Absaetze, durch eine Leerzeile getrennt).

Antworte ausschliesslich mit JSON:
{"titel": "...", "lead": "...", "text": "..."}`

function faktenZeilen(fakten: AmtsblattFakten): string[] {
  return [
    `Gemeinde: ${fakten.gemeinde} (Kanton ${fakten.kanton})`,
    `Art der Publikation: ${fakten.rubrikName} (${GRUPPEN_TEXT[fakten.gruppe]})`,
    `Publiziert am ${fakten.publiziertAm}${fakten.amt === '' ? '' : ` von: ${fakten.amt}`}`,
    `Titel der Publikation: "${fakten.titel}"`,
    ...(fakten.frist === null
      ? []
      : [`Frist fuer Einsprachen/Einwendungen: ${fakten.frist}`]),
    '',
    'Angaben aus der Publikation:',
    ...fakten.angaben.map((a) => `- ${a.bezeichnung}: ${a.wert}`),
    ...(fakten.planbefunde.length === 0
      ? []
      : [
          '',
          'Aus den oeffentlich aufgelegten Plaenen (gelesen, nicht geschaetzt):',
          ...fakten.planbefunde.map((b) => `- ${b}`)
        ]),
    ...(fakten.personen.length === 0
      ? []
      : [
          '',
          `NICHT nennen (natuerliche Personen): ${fakten.personen.join(', ')}`
        ])
  ]
}

export function buildAmtsblattPrompt(fakten: AmtsblattFakten): string {
  return [
    ...faktenZeilen(fakten),
    '',
    'Schreibe die Meldung. Verwende ausschliesslich diese Angaben.'
  ].join('\n')
}

/** Same facts, previous text, editor's instruction — system prompt unchanged. */
export function buildAmtsblattRevision(
  fakten: AmtsblattFakten,
  bisher: { titel: string | null; lead: string | null; text: string | null },
  anweisung: string
): string {
  return [
    ...faktenZeilen(fakten),
    '',
    'Bisherige Meldung:',
    `Titel: ${bisher.titel ?? ''}`,
    `Lead: ${bisher.lead ?? ''}`,
    bisher.text ?? '',
    '',
    'Anweisung der Redaktion:',
    anweisung,
    '',
    'Schreibe die Meldung neu. Setze die Anweisung um, aber verwende weiterhin ausschliesslich die Angaben oben.'
  ].join('\n')
}

const MONATE = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember'
] as const

/**
 * "27. August 2026".
 *
 * Spelled out rather than taken from `toLocaleDateString`, for the reason
 * `erinnerung.ts` gives: a date-only string has no timezone, and parsing it as
 * a local instant shifts it by a day everywhere east of UTC — which is here,
 * every day of the year.
 */
export function datumDeutsch(iso: string): string {
  const [jahr, monat, tag] = iso.split('-').map(Number)
  if (jahr === undefined || monat === undefined || tag === undefined) return iso
  return `${tag}. ${MONATE[monat - 1] ?? ''} ${jahr}`
}

/**
 * How a link is named for the reader.
 *
 * Derived from the kind, not read back from the stored `bezeichnung`: that
 * string is data at rest, so rows written before a wording change would keep
 * the old spelling for ever — inside published articles.
 */
const UNTERLAGEN_TEXT: Record<Unterlage['art'], string> = {
  plaene: 'Baugesuchspläne',
  akten: 'Gesuchsunterlagen',
  ebau: 'Baugesuch im eBau-Portal',
  karte: 'Lage auf der Karte',
  andere: 'Weitere Unterlagen'
}

export function unterlagenText(art: Unterlage['art']): string {
  return UNTERLAGEN_TEXT[art] ?? 'Unterlagen'
}

/**
 * The source line, appended by code — never left to the model.
 *
 * Two addresses where there are two: the official publication, and the
 * documents behind it — each its own paragraph, because the renderer splits on
 * a BLANK line (`/
{2,}/`) and a single newline would run the two together
 * into one unreadable blob. Both are built here from values the connector resolved,
 * so no model-written URL can enter an article. Asked for a link without being
 * given one, a model produces the bare host — that lesson is in `quelle.ts` and
 * applies here unchanged.
 */
export function quelleZeile(fakten: AmtsblattFakten): string {
  const kopf =
    `Quelle: Amtliche Publikation vom ${datumDeutsch(fakten.publiziertAm)}, ` +
    fakten.pdfUrl
  if (fakten.unterlage === null) return kopf
  return `${kopf}\n\n${unterlagenText(fakten.unterlage.art)}: ${fakten.unterlage.url}`
}

export function mitQuelle(text: string, fakten: AmtsblattFakten): string {
  return `${text.trim()}\n\n${quelleZeile(fakten)}`
}

// ---------------------------------------------------------------------------
// The checks — a prompt is a request, a check is a rule
// ---------------------------------------------------------------------------

/** Which gazette the text has to name, given the canton it came from. */
export function quellenName(kanton: string, gruppe: Gruppe): string {
  if (gruppe === 'wirtschaft') return 'Handelsamtsblatt'
  const kantone: Record<string, string> = {
    BL: 'Basel-Landschaft',
    BS: 'Basel-Stadt',
    SO: 'Solothurn'
  }
  return kantone[kanton] ?? kanton
}

/**
 * The attribution has to survive every revision — reported, then retried once.
 * A gazette article that does not say it comes from the gazette reads as the
 * newsroom's own reporting, which it is not.
 */
export function attributionsWarnung(
  text: string,
  fakten: Pick<AmtsblattFakten, 'kanton' | 'gruppe'>
): string | null {
  const klein = text.normalize('NFC').toLowerCase()
  const name = quellenName(fakten.kanton, fakten.gruppe).toLowerCase()
  if (!klein.includes('amtsblatt') && !klein.includes('amtlich'))
    return 'Die Meldung nennt nicht, dass sie aus einer amtlichen Publikation stammt.'
  if (!klein.includes(name.normalize('NFC')))
    return `Die Quelle ("${quellenName(fakten.kanton, fakten.gruppe)}") wird im Text nicht genannt.`
  return null
}

/**
 * Names of natural persons that made it into the text anyway.
 *
 * The rule the whole feed hangs on: an official publication may name a private
 * person, a piece of journalism decides that for itself. Checked on the surname
 * alone, because the model rephrases "Faller Dieter" as "Dieter Faller" — and
 * short surnames are skipped, since a three-letter name matches half the German
 * language by accident.
 */
export function personenWarnungen(
  text: string,
  personen: readonly string[]
): string[] {
  const klein = text.normalize('NFC').toLowerCase()
  const warnungen: string[] = []

  for (const person of personen) {
    const teile = person
      .normalize('NFC')
      .split(/[\s,]+/)
      .filter((t) => t.length >= 4)
    const treffer = teile.filter((t) =>
      new RegExp(
        `\\b${t.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`
      ).test(klein)
    )
    if (treffer.length > 0)
      warnungen.push(`Name einer Privatperson im Text: "${person}".`)
  }
  return warnungen
}

/**
 * Every digit in the text must come from the handed facts. Run BEFORE
 * `mitQuelle` appends the addresses, whose digits are nobody's claim.
 */
export function zahlWarnungen(text: string, fakten: AmtsblattFakten): string[] {
  const erlaubt = new Set<string>()
  const sammle = (quelle: string): void => {
    for (const treffer of quelle.matchAll(/\d+/g)) {
      erlaubt.add(treffer[0])
      // "07" in an ISO date is spoken as "7" in prose.
      erlaubt.add(String(Number(treffer[0])))
    }
  }
  sammle(fakten.titel)
  sammle(fakten.publiziertAm)
  if (fakten.frist !== null) sammle(fakten.frist)
  for (const a of fakten.angaben) {
    sammle(a.bezeichnung)
    sammle(a.wert)
  }
  for (const b of fakten.planbefunde) sammle(b)

  const gefunden = [...text.matchAll(/\d+/g)].map((t) => t[0])
  return [...new Set(gefunden.filter((z) => !erlaubt.has(z)))].map(
    (z) => `Zahl "${z}" steht nicht in den Angaben.`
  )
}

/**
 * Which link belongs in the article, if any.
 *
 * The question here is what a READER can open, which is not the same as
 * `Unterlage.lesbar` — that one says whether WE can read it. Solothurn's eBau
 * portal is a single-page app we cannot parse, but a person opens it fine, so
 * it belongs in the article even though the plan reading skips it. A map
 * deep-link does not: it is orientation for the editor, not a source.
 */
export function artikelUnterlage(
  unterlagen: readonly Unterlage[]
): Unterlage | null {
  const rang: Unterlage['art'][] = ['plaene', 'akten', 'ebau']
  for (const art of rang) {
    const treffer = unterlagen.find((u) => u.art === art)
    if (treffer !== undefined) return treffer
  }
  return null
}
