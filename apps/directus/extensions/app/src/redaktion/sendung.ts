/**
 * The broadcast feed's editorial rules — the prompts and, next to each, the
 * check that enforces what the prompt asks for.
 *
 * Two model calls, and the first one is only reached when a cheap, purely
 * textual pre-filter already found a covered municipality in the transcript.
 * Both shows are Basel-heavy; on most days nothing in them is about Aesch or
 * Pratteln, and paying a model to confirm that would be the whole cost of the
 * feature for none of its value.
 */

export { parseMeldungstext as parseSendungMeldung } from './spielbericht'
// Dieselbe Schreibweise wie im Amtsblatt-Feed, und aus demselben Grund dort
// von Hand ausgeschrieben: ein reines Datum hat keine Zeitzone, und als lokaler
// Zeitpunkt geparst verschiebt es sich oestlich von UTC um einen Tag.
import { datumDeutsch, verwurfText, weitergereichtText } from './amtsblatt'
import { vorgabenZeilen } from './lernen'
import type { Beispielrahmen, HinweisUrteil, Verwurf } from './lernsignale'
// One direction only (presseschau → sendung would be circular in the bundle).
import { empfehlungAus, gekuerzt } from './presseschau'
export { ueberlappungsWarnungen } from './presseschau'

/** Which show a candidate came from. Decides attribution and the source link. */
export type SendungsQuelle = 'regionaljournal' | 'punkt6'

interface SendungsInfo {
  /** The name that must appear in the article's running text. */
  name: string
  /** The attribution the prompt asks for and the check looks for. */
  attribution: string
  sender: string
}

export const SENDUNGEN: Record<SendungsQuelle, SendungsInfo> = {
  regionaljournal: {
    name: 'Regionaljournal Basel Baselland',
    attribution: 'wie das Regionaljournal Basel Baselland von SRF berichtete',
    sender: 'SRF'
  },
  punkt6: {
    name: 'punkt6',
    attribution: 'wie Telebasel in der Sendung punkt6 berichtete',
    sender: 'Telebasel'
  }
}

// ---------------------------------------------------------------------------
// 1. The pre-filter — no model call unless a covered municipality is named
// ---------------------------------------------------------------------------

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Which covered municipalities the transcript actually names.
 *
 * Word boundaries are the whole point, and the trap is local: "Aesch" sits
 * inside "Aeschenplatz" and "Aeschenvorstadt", which are Basel city addresses
 * these two shows mention constantly; "Riehen" sits inside "Riehenring", a
 * street in Basel. A substring match would propose a candidate for the wrong
 * municipality nearly every day, and the editor would learn to ignore the feed.
 *
 * `\b` is ASCII-based, which is fine here: it is evaluated at the edges of the
 * name, and no municipality in the area starts or ends with an umlaut.
 */
export function gemeindeTreffer(
  text: string,
  gemeinden: readonly string[]
): string[] {
  const treffer: string[] = []
  for (const name of gemeinden) {
    if (name.trim() === '') continue
    if (new RegExp(`\\b${escape(name.trim())}\\b`, 'i').test(text)) {
      treffer.push(name)
    }
  }
  return treffer
}

// ---------------------------------------------------------------------------
// 2. The inventory — which contributions are ABOUT a covered municipality
// ---------------------------------------------------------------------------

/**
 * Byte-identical across a run, like every other cached system prefix in this
 * project. The municipality names and the newsroom's own past decisions differ
 * per call and belong in the user turn.
 */
export const INVENTAR_SYSTEM_PROMPT = `Du liest den Beitrag einer regionalen Radio- oder Fernsehsendung aus Basel und pruefst fuer eine lokale Redaktion, ob er von einer ihrer Gemeinden HANDELT.

Der entscheidende Unterschied:
- Der Beitrag HANDELT von der Gemeinde, wenn dort etwas geschieht, entschieden
  wird oder jemand von dort im Zentrum steht. Nur das ist ein Kandidat.
- Der Beitrag ERWAEHNT die Gemeinde bloss, wenn sie in einer Aufzaehlung, als
  Wohnort einer Person, als Durchfahrtsort oder als Vergleich vorkommt. Das ist
  KEIN Kandidat.

Im Zweifel: kein Kandidat. Ein verpasster Beitrag ist verschmerzbar, ein Tisch
voller Beitraege, die mit der Gemeinde nichts zu tun haben, macht den ganzen
Kanal wertlos.

Fuer jeden Kandidaten:
- "gemeinde": exakt einer der genannten Namen, nie ein anderer Ort.
- "titel": worum es geht, in hoechstens 70 Zeichen.
- "zusammenfassung": die FAKTEN aus dem Beitrag als knappe Liste in eigenen
  Worten — Namen, Zahlen, Entscheide, Daten. Diese Liste ist spaeter die
  EINZIGE Grundlage der Meldung, also darf nichts darin stehen, was der Beitrag
  nicht sagt, und nichts fehlen, was die Meldung braucht.
- "begruendung": ein Satz, warum das die Leserschaft der Gemeinde angeht.

Jeder Kandidat kostet die Redaktion Zeit: liegen gelassene und abgelehnte
Kandidaten sind Fehlvorschlaege. Schlage nur vor, was sie nach ihren Regeln
und Beispielen uebernehmen wuerde.

Weiterreichen an die Chefredaktion: NUR wenn eine der nummerierten Regeln der
Redaktion (R1, R2, …) verlangt, dass solche Beitraege an die Chefredaktion
gehen, setze "empfehlung": "weiterreichen" und nenne die Nummer dieser Regel
in "empfehlung_regel". Ohne eine solche Regel sind beide null.

Antworte ausschliesslich mit JSON:
{"kandidaten": [{"gemeinde": "...", "titel": "...", "zusammenfassung": "...", "begruendung": "...", "empfehlung": null, "empfehlung_regel": null}]}`

export const INVENTAR_SCHEMA = {
  type: 'object',
  properties: {
    kandidaten: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          gemeinde: { type: 'string' },
          titel: { type: 'string' },
          zusammenfassung: { type: 'string' },
          begruendung: { type: 'string' },
          empfehlung: {
            type: ['string', 'null'],
            enum: ['weiterreichen', null]
          },
          empfehlung_regel: { type: ['string', 'null'] }
        },
        required: [
          'gemeinde',
          'titel',
          'zusammenfassung',
          'begruendung',
          'empfehlung',
          'empfehlung_regel'
        ],
        additionalProperties: false
      }
    }
  },
  required: ['kandidaten'],
  additionalProperties: false
} as const

/** A decision the newsroom already made, fed back as an example. */
export interface LernEintrag {
  titel: string
  gemeinde: string
  entscheid: 'uebernommen' | 'abgelehnt' | 'weitergereicht'
  grund: string | null
  /** The editor's own words on a rejection — stored since day one, read since now. */
  kommentar?: string | null
  /** Taken over, but the Meldung written from it was discarded afterwards. */
  meldungVerworfen?: Verwurf | null
  /** For a hand-up: what the Chefredaktion made of it. */
  faehrte?: HinweisUrteil | null
}

const GRUND_TEXT: Record<string, string> = {
  nicht_relevant: 'nicht relevant',
  nur_erwaehnt: 'nur am Rand erwaehnt',
  doublette: 'Doublette',
  veraltet: 'veraltet',
  falsche_gemeinde: 'falsche Gemeinde',
  andere: 'anderer Grund'
}

/**
 * The newsroom's own decisions as few-shot examples, scoped PER SHOW.
 *
 * The decision rows are the memory — no distillation call, no second store, the
 * same arrangement as the press review and the gazette. Per show rather than
 * per municipality: what counts as "only mentioned" is a property of how a
 * programme talks, and the two shows talk very differently.
 *
 * `nur_erwaehnt` is rendered in words — it is the distinction the system
 * prompt asks for, and the example should say it the way the prompt does.
 */
export function lernDigest(
  eintraege: readonly LernEintrag[],
  max = 20,
  rahmen: Partial<Beispielrahmen> = {}
): string {
  const sichtbar = eintraege.filter(
    (e) =>
      !(
        e.entscheid === 'weitergereicht' &&
        e.faehrte?.automatisch === true &&
        e.faehrte.status === 'offen'
      )
  )
  const letzte = sichtbar.slice(0, max)
  const bilanz = rahmen.bilanz ?? ''
  const verfallene = rahmen.verfallene ?? []
  if (letzte.length === 0 && bilanz === '' && verfallene.length === 0) return ''

  const zeile = (e: LernEintrag): string => {
    let urteil: string
    if (e.entscheid === 'uebernommen') {
      urteil = `ja, daraus wurde eine Meldung${verwurfText(e.meldungVerworfen)}`
    } else if (e.entscheid === 'weitergereicht') {
      urteil = weitergereichtText(e.faehrte)
    } else {
      const grund = e.grund === null ? '' : (GRUND_TEXT[e.grund] ?? e.grund)
      const kommentar = e.kommentar == null ? '' : `: ${e.kommentar}`
      urteil =
        grund === '' && kommentar === ''
          ? 'nein'
          : `nein (${grund}${kommentar})`
    }
    return `- [${e.gemeinde}] "${e.titel}" → ${urteil}`
  }

  return [
    'So hat die Redaktion bei dieser Sendung zuletzt entschieden — richte dich danach:',
    ...(bilanz === '' ? [] : [bilanz]),
    ...(verfallene.length === 0
      ? []
      : [
          'Liegen gelassen — Kandidaten, die der Redaktion nicht einmal einen Klick wert waren:',
          ...verfallene.map((t) => `- "${t}"`)
        ]),
    ...letzte.map(zeile),
    ...(rahmen.kappung === undefined || rahmen.kappung === ''
      ? []
      : [rahmen.kappung])
  ].join('\n')
}

export interface Beitrag {
  titel: string
  /** The contribution's own text — the transcript slice, never the whole show. */
  text: string
  sendung: SendungsQuelle
  datum: string
  /**
   * True when no transcript passage could be located and `text` is only the
   * show's own short summary. The label below then says so: a summary offered
   * as "Wortlaut" would have the HANDELT/ERWAEHNT question answered on false
   * premises.
   */
  nurZusammenfassung?: boolean
}

export function buildInventarPrompt(
  beitrag: Beitrag,
  gemeinden: readonly string[],
  digest: string,
  /** The desk's Sichtung rules, already rendered (`regelnBlock`) — user turn, like the digest. */
  regeln = ''
): string {
  return [
    `Sendung: ${SENDUNGEN[beitrag.sendung].name} vom ${beitrag.datum}`,
    `Beitrag: "${beitrag.titel}"`,
    '',
    `Gemeinden der Redaktion, die im Text vorkommen: ${gemeinden.join(', ')}`,
    'Nur diese Namen sind erlaubt. Andere Orte sind kein Kandidat.',
    '',
    ...(regeln === '' ? [] : [regeln, '']),
    ...(digest === '' ? [] : [digest, '']),
    ...(beitrag.nurZusammenfassung === true
      ? [
          'Zusammenfassung des Beitrags (der Wortlaut liess sich im Transkript',
          'nicht auffinden — urteile entsprechend vorsichtig):'
        ]
      : ['Wortlaut des Beitrags:']),
    beitrag.text
  ].join('\n')
}

export interface InventarKandidat {
  gemeinde: string
  titel: string
  zusammenfassung: string
  begruendung: string
  /** Only ever set when a numbered rule of the newsroom asked for it — checked by code. */
  empfehlung: 'weiterreichen' | null
  empfehlung_regel: string | null
}

/**
 * Answers into candidates, with the municipality checked against the list that
 * was offered.
 *
 * A candidate filed under a name the newsroom does not cover is DROPPED, never
 * refiled under the nearest one — the same rule as the press review's
 * `parseInventar`. The model naming "Basel" is not a hint that the piece is
 * about Binningen.
 */
export function parseInventar(
  antwort: unknown,
  erlaubteGemeinden: readonly string[]
): InventarKandidat[] {
  if (typeof antwort !== 'object' || antwort === null)
    throw new Error('Antwort ist kein Objekt.')
  const roh = (antwort as { kandidaten?: unknown }).kandidaten
  if (!Array.isArray(roh)) throw new Error('Feld "kandidaten" fehlt.')

  const erlaubt = new Map(
    erlaubteGemeinden.map((g) => [g.trim().toLowerCase(), g])
  )
  const kandidaten: InventarKandidat[] = []

  for (const eintrag of roh) {
    if (typeof eintrag !== 'object' || eintrag === null) continue
    const k = eintrag as Record<string, unknown>
    const gemeinde =
      typeof k.gemeinde === 'string'
        ? erlaubt.get(k.gemeinde.trim().toLowerCase())
        : undefined
    if (gemeinde === undefined) continue

    const titel = typeof k.titel === 'string' ? k.titel.trim() : ''
    const zusammenfassung =
      typeof k.zusammenfassung === 'string' ? k.zusammenfassung.trim() : ''
    if (titel === '' || zusammenfassung === '') continue

    kandidaten.push({
      gemeinde,
      titel: titel.slice(0, 500),
      zusammenfassung,
      begruendung:
        typeof k.begruendung === 'string'
          ? k.begruendung.trim().slice(0, 500)
          : '',
      ...empfehlungAus(k)
    })
  }
  return kandidaten
}

// ---------------------------------------------------------------------------
// 3. The article
// ---------------------------------------------------------------------------

export interface SendungsFakten {
  gemeinde: string
  sendung: SendungsQuelle
  datum: string
  titel: string
  /** The handed fact list — the ONLY source the drafting call ever sees. */
  zusammenfassung: string
  /** Where the contribution starts in the show, for the source line. */
  zeitmarkeSekunden: number | null
  /** Audio (Regionaljournal) or the episode page (punkt6). Resolved, never written. */
  quellUrl: string | null
}

export const SENDUNG_SYSTEM_PROMPT = `Du schreibst fuer eine lokale Redaktion in der Region Basel kurze Meldungen darueber, was eine regionale Radio- oder Fernsehsendung ueber eine Gemeinde berichtet hat.

Regeln, ohne Ausnahme:
- Verwende NUR die Fakten aus den Angaben. Erfinde nichts und rechne nichts aus.
- Schreibe in EIGENEN WORTEN. Uebernimm keine Saetze und keine Formulierungen
  der Sendung — die Angaben sind bereits eine Faktenliste, bleib bei ihr.
- Nenne die Quelle IM TEXT, mit dem Namen der Sendung. Die genaue Wendung steht
  in den Angaben; verwende sie.
- Nenne Daten ABSOLUT ("am 26. August 2026"), niemals relativ ("gestern",
  "diese Woche"). Der Text muss in fuenf Jahren noch stimmen.
- Schreibe nuechtern und knapp — die Meldung macht neugierig auf die Sendung,
  sie ersetzt sie nicht.
- Schweizer Rechtschreibung: "ss" statt "ß".

Umfang: Titel (maximal 70 Zeichen), Lead (ein Satz), Text (ein bis zwei kurze
Absaetze, durch eine Leerzeile getrennt).

Antworte ausschliesslich mit JSON:
{"titel": "...", "lead": "...", "text": "..."}`

function faktenZeilen(fakten: SendungsFakten): string[] {
  const info = SENDUNGEN[fakten.sendung]
  return [
    `Gemeinde: ${fakten.gemeinde}`,
    `Sendung: ${info.name} (${info.sender}) vom ${fakten.datum}`,
    `Beitrag: "${fakten.titel}"`,
    `Verwende im Text diese Wendung: "${info.attribution}"`,
    '',
    'Fakten aus dem Beitrag:',
    fakten.zusammenfassung
  ]
}

export function buildSendungPrompt(
  fakten: SendungsFakten,
  regeln: readonly string[] = []
): string {
  return [
    ...faktenZeilen(fakten),
    ...vorgabenZeilen(regeln),
    '',
    'Schreibe die Meldung. Verwende ausschliesslich diese Angaben.'
  ].join('\n')
}

/**
 * How much transcript a revision may carry. A whole show runs 15–30k
 * characters, so the old cap of 30k sat exactly on the edge and cut the LAST
 * minutes — of the one call whose job is answering "was stand dort zu X?".
 * Generous now, and a cut that still happens is marked, never silent.
 */
const MAX_TRANSKRIPT = 120000

/**
 * Same facts, previous text, editor's instruction — system prompt unchanged.
 *
 * The revision ADDITIONALLY sees the show's transcript where the edition
 * carries one — the same rule as the press review: the first write is
 * deliberately summary-only, but an instruction must be answerable from the
 * whole original source. The overlap check against this very transcript keeps
 * the answer in the newsroom's own words.
 */
export function buildSendungRevision(
  fakten: SendungsFakten,
  bisher: { titel: string | null; lead: string | null; text: string | null },
  anweisung: string,
  transkript: string | null = null,
  regeln: readonly string[] = []
): string {
  const mitTranskript = transkript !== null && transkript.trim() !== ''
  return [
    ...faktenZeilen(fakten),
    ...vorgabenZeilen(regeln),
    ...(mitTranskript
      ? [
          '',
          'Transkript der Sendung (zum Nachschlagen — schreibe weiterhin in EIGENEN Worten, uebernimm keine Saetze):',
          gekuerzt(transkript as string, MAX_TRANSKRIPT)
        ]
      : []),
    '',
    'Bisherige Meldung:',
    `Titel: ${bisher.titel ?? ''}`,
    `Lead: ${bisher.lead ?? ''}`,
    bisher.text ?? '',
    '',
    'Anweisung der Redaktion:',
    anweisung,
    '',
    mitTranskript
      ? 'Schreibe die Meldung neu. Setze die Anweisung um, aber verwende weiterhin ausschliesslich die Angaben und das Transkript oben.'
      : 'Schreibe die Meldung neu. Setze die Anweisung um, aber verwende weiterhin ausschliesslich die Angaben oben.'
  ].join('\n')
}

/**
 * The source line, appended by code — never left to the model.
 *
 * The timestamp is part of the address where the player understands one: SRF's
 * podcast MP3 takes a `#t=`, telebasel.ch's episode page takes a `?t=`. That
 * turns "the show said so" into "listen to it yourself at 4:21", which is the
 * whole point of linking at all.
 */
export function quelleZeile(fakten: SendungsFakten): string {
  const info = SENDUNGEN[fakten.sendung]
  const kopf = `Quelle: ${info.name} (${info.sender}) vom ${datumDeutsch(fakten.datum)}`
  if (fakten.quellUrl === null) return kopf

  const marke = fakten.zeitmarkeSekunden
  if (marke === null || marke <= 0) return `${kopf}, ${fakten.quellUrl}`
  const trenner = fakten.sendung === 'punkt6' ? '?t=' : '#t='
  return `${kopf}, ${fakten.quellUrl}${trenner}${Math.round(marke)}`
}

export function mitQuelle(text: string, fakten: SendungsFakten): string {
  return `${text.trim()}\n\n${quelleZeile(fakten)}`
}

// ---------------------------------------------------------------------------
// The checks — a prompt is a request, a check is a rule
// ---------------------------------------------------------------------------

/**
 * The attribution has to survive every revision — reported, then retried once.
 * A piece that does not say it comes from someone else's reporting reads as the
 * newsroom's own, which it is not.
 */
export function attributionsWarnung(
  text: string,
  fakten: Pick<SendungsFakten, 'sendung'>
): string | null {
  const klein = text.normalize('NFC').toLowerCase()
  const info = SENDUNGEN[fakten.sendung]
  if (klein.includes(info.name.normalize('NFC').toLowerCase())) return null
  return `Die Sendung ("${info.name}") wird im Text nicht genannt.`
}

/**
 * Every digit in the text must come from the handed facts. Run BEFORE
 * `mitQuelle` appends the address, whose digits are nobody's claim.
 */
export function zahlWarnungen(text: string, fakten: SendungsFakten): string[] {
  const erlaubt = new Set<string>()
  const sammle = (quelle: string): void => {
    for (const treffer of quelle.matchAll(/\d+/g)) {
      erlaubt.add(treffer[0])
      // "08" in an ISO date is spoken as "8" in prose.
      erlaubt.add(String(Number(treffer[0])))
    }
  }
  sammle(fakten.zusammenfassung)
  sammle(fakten.titel)
  sammle(fakten.datum)

  const gefunden = [...text.matchAll(/\d+/g)].map((t) => t[0])
  return [...new Set(gefunden.filter((z) => !erlaubt.has(z)))].map(
    (z) => `Zahl "${z}" steht nicht in den Angaben.`
  )
}

// ---------------------------------------------------------------------------
// Housekeeping
// ---------------------------------------------------------------------------

/** How long an undecided candidate waits before the desk drops it. */
export const AUFRAEUM_TAGE = 7

export interface AufraeumZeile {
  id: string
  entscheid: string
  date_created: string | null
}

/**
 * Whether an undecided candidate has gone stale.
 *
 * A broadcast is perishable in a way a building permit is not: nobody writes a
 * Meldung about last week's radio piece. Decided rows are never touched — they
 * are the memory the next inventory learns from.
 */
export function darfWeg(
  zeile: AufraeumZeile,
  heute: string,
  tage = AUFRAEUM_TAGE
): boolean {
  if (zeile.entscheid !== 'offen') return false
  if (zeile.date_created === null) return false

  const alter =
    (Date.parse(`${heute}T00:00:00Z`) -
      Date.parse(`${zeile.date_created.slice(0, 10)}T00:00:00Z`)) /
    86_400_000
  return Number.isFinite(alter) && alter >= tage
}
