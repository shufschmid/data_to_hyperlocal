// The rules of the events door (`/veranstaltungen/v1/…`), pure so every one of
// them is a unit test. `index.ts` only reads the rows and calls `baueAntwort`.
//
// What this door is: the collected Anlässe of every covered municipality,
// handed to an outside events site AS SOON AS a run has read them — unreviewed,
// without a Meldung, without the counter-check. That is exactly why it is not a
// route of `/api/v1`: that API promises that everything it serves is published.
//
// Three decisions of the newsroom (17 November 2026) shape it:
// - the WHOLE STATE every time (today to today+60), with a stable `kennung`
//   per entry — what is missing is gone, there is no bookmark to lose;
// - everything but placeholders, each entry with its kind and status, so the
//   site filters, not this house;
// - a duplicate — the same Anlass in the municipal calendar and in a weekly
//   paper's preview — is merged HERE into one entry, the other source riding
//   along in `weitere_quellen`. Deterministic and without a model: what the
//   rule does not recognise arrives twice, each with its own source.

import { gemeindeSlug } from '../api/projektion'
import { tagInZuerich } from '../../shared/buschtelefon/parse'
import { pruefeZugang, type Zugang } from '../../shared/schluessel'
import { seitenLink } from '../../shared/wochenblatt/parse'
import { datumDeutsch } from '../../redaktion/amtsblatt'
import {
  anlassAnTag,
  gleicherTitel,
  titelWoerter
} from '../../redaktion/gemeindeseite'

export { pruefeZugang, type Zugang }

export const FORMAT = 'redaktion-veranstaltungen/1'
export const KOPF = 'X-Veranstaltungen-Key'
/** The same forward window the calendars are read with (`VERANSTALTUNGS_FENSTER_TAGE`). */
export const FENSTER_TAGE = 60
/** Rows not seen for longer are not even read — the calendar run deletes undecided ones after 21. */
export const LESEFENSTER_TAGE = 30

/** A rejection that says the ROW is wrong, not that the Anlass is not worth a Meldung. */
const ZEILE_FALSCH = new Set(['doublette', 'veraltet', 'falsche_gemeinde'])

// ---------------------------------------------------------------------------
// Input rows — what `index.ts` reads, field for field
// ---------------------------------------------------------------------------

export interface GemeindeZeile {
  id: string
  name: string
  bfs_nummer: number
}

export interface KalenderQuelle {
  id: string
  name: string
  art: 'gemeinde' | 'plattform' | 'ort' | 'organisation'
  aktiv: boolean
  letzte_pruefung: string | null
  letzter_fehler: string | null
  /** What the last read declared although it succeeded — e.g. a day the page answered 500. */
  letzter_hinweis: string | null
}

export interface KalenderZeile {
  id: string
  gemeinde: string
  quelle: KalenderQuelle | null
  titel: string
  termine: string[] | null
  von: string
  bis: string | null
  zeit: string | null
  lokalitaet: string | null
  adresse: string | null
  ort: string | null
  ort_ausserhalb: boolean
  veranstalter: string | null
  rhythmus: string
  anker: string | null
  anker_am: string | null
  anker_grund: string | null
  entscheid: string
  ablehnungsgrund: string | null
  url: string
  zuletzt_gesehen_am: string
}

export interface VorschauZeile {
  id: string
  titel: string
  seite: number | null
  zusammenfassung: string | null
  zeitbezug: string | null
  /** The inventory's kind of piece — only some of them are Anlässe (`ANLASS_TYPEN`). */
  typ: string
  anlass_am: string | null
  entscheid: string
  ablehnungsgrund: string | null
  /** The piece's own municipality; null on papers covering one anyway. */
  gemeinde: string | null
  ausgabe: {
    nummer: string | null
    pdf_url: string | null
    seite_url: string | null
    wochenblatt: { name: string; gemeinde: string } | null
  } | null
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export type Status = 'findet_statt' | 'abgesagt' | 'verschoben'
export type Herkunft = 'kalender' | 'wochenblatt'
export type QuellenArt = KalenderQuelle['art'] | 'wochenblatt'

export interface Quelle {
  art: QuellenArt
  name: string
  url: string | null
}

export interface WeitereQuelle extends Quelle {
  kennung: string
  titel: string
}

export interface Anlass {
  kennung: string
  herkunft: Herkunft
  gemeinde: { name: string; slug: string; bfs: number }
  titel: string
  termine: string[]
  von: string
  bis: string | null
  zeit: string | null
  lokalitaet: string | null
  adresse: string | null
  ort: string | null
  ort_ausserhalb: boolean
  veranstalter: string | null
  art: string
  status: Status
  status_hinweis: string | null
  text: string | null
  text_herkunft: 'eckdaten' | 'zusammenfassung_ki' | null
  quelle: Quelle
  weitere_quellen: WeitereQuelle[]
}

export interface Antwort {
  format: typeof FORMAT
  stand: string
  fenster: { von: string; bis: string }
  anzahl: number
  zusammengefuehrt: number
  hinweise: string[]
  anlaesse: Anlass[]
}

// ---------------------------------------------------------------------------
// Days
// ---------------------------------------------------------------------------

const WOCHENTAGE = [
  'Sonntag',
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag'
]

/** `YYYY-MM-DD` plus n days, computed in UTC so no timezone can move it. */
export function plusTage(tag: string, n: number): string {
  const [j, m, t] = tag.split('-').map(Number)
  const d = new Date(Date.UTC(j ?? 1970, (m ?? 1) - 1, (t ?? 1) + n))
  return d.toISOString().slice(0, 10)
}

function wochentag(tag: string): string {
  const [j, m, t] = tag.split('-').map(Number)
  return (
    WOCHENTAGE[
      new Date(Date.UTC(j ?? 1970, (m ?? 1) - 1, t ?? 1)).getUTCDay()
    ] ?? ''
  )
}

/** „Sonntag, 29. November 2026". */
export function tagLang(tag: string): string {
  return `${wochentag(tag)}, ${datumDeutsch(tag)}`
}

// ---------------------------------------------------------------------------
// Calendar rows
// ---------------------------------------------------------------------------

/** Whether a source's last read SUCCEEDED, and on which day — null when it did not or never ran. */
function gelesenAm(q: KalenderQuelle): string | null {
  if (q.letzter_fehler !== null) return null
  return tagInZuerich(q.letzte_pruefung)
}

/**
 * Why a calendar row is NOT delivered — null when it is. Each reason is
 * counted by the caller, so nothing leaves silently.
 */
export function ausschlussKalender(
  z: KalenderZeile,
  heute: string,
  fensterBis: string
):
  | 'platzhalter'
  | 'abgelehnt'
  | 'quelle_aus'
  | 'verschwunden'
  | 'ausserhalb'
  | null {
  if (z.anker === 'platzhalter' || z.anker === 'abfuhr') return 'platzhalter'
  if (z.entscheid === 'abgelehnt' && ZEILE_FALSCH.has(z.ablehnungsgrund ?? ''))
    return 'abgelehnt'
  // Past first: a calendar stops listing what has taken place, and that is
  // not a disappearance (measured on production rows: the other way round,
  // 205 past Anlässe were counted as "gone").
  if (
    tageImFenster(z, heute, fensterBis).length === 0 &&
    !laufendeSpanne(z, heute, fensterBis)
  )
    return 'ausserhalb'
  if (z.quelle !== null && !z.quelle.aktiv) return 'quelle_aus'
  // Gone from the calendar: the source was read successfully on a later day
  // than the row was last seen there. A source that failed keeps its last
  // known state — the answer's `hinweise` says so.
  const gelesen = z.quelle === null ? null : gelesenAm(z.quelle)
  if (
    gelesen !== null &&
    z.zuletzt_gesehen_am < gelesen &&
    !ungeleseneTage(z.quelle).some((tag) =>
      (z.termine ?? [z.von]).includes(tag)
    )
  )
    return 'verschwunden'
  return null
}

/**
 * The days a successful read still could not get. Riehen's calendar is asked
 * day by day, and one day answering 500 is a hint, not a failure (measured
 * 17.11.2026: „2026-12-12: Seite antwortete mit 500."). An Anlass on such a
 * day was not seen because nobody could look — not because it is gone.
 */
function ungeleseneTage(q: KalenderQuelle | null): string[] {
  return q?.letzter_hinweis?.match(/\d{4}-\d{2}-\d{2}/g) ?? []
}

function tageImFenster(
  z: Pick<KalenderZeile, 'termine' | 'von'>,
  heute: string,
  fensterBis: string
): string[] {
  const tage = z.termine !== null && z.termine.length > 0 ? z.termine : [z.von]
  return [...new Set(tage)].filter((t) => t >= heute && t <= fensterBis).sort()
}

/** A span that has begun or begins inside the window and has not ended — an exhibition shows its last day. */
function laufendeSpanne(
  z: Pick<KalenderZeile, 'von' | 'bis'>,
  heute: string,
  fensterBis: string
): boolean {
  return z.bis !== null && z.von <= fensterBis && z.bis >= heute
}

/**
 * The status the outside site shows. `ausfall` means two things in the
 * anchor vocabulary: the calendar SAYS the Anlass is cancelled (then
 * `anker_am` is one of its days), or a rhythm's expected date is missing
 * (`anker.ts`: then `anker_am` is the missing day, not one of the row's).
 * Only the first is a cancellation.
 */
export function statusVon(
  z: Pick<
    KalenderZeile,
    'anker' | 'anker_am' | 'anker_grund' | 'termine' | 'von'
  >
): { status: Status; status_hinweis: string | null } {
  if (z.anker === 'verschoben')
    return { status: 'verschoben', status_hinweis: z.anker_grund }
  if (z.anker === 'ausfall') {
    const tage = z.termine ?? [z.von]
    if (
      z.anker_am !== null &&
      (tage.includes(z.anker_am) || z.anker_am === z.von)
    )
      return { status: 'abgesagt', status_hinweis: z.anker_grund }
    return { status: 'findet_statt', status_hinweis: z.anker_grund }
  }
  return { status: 'findet_statt', status_hinweis: null }
}

/**
 * How a series without a known date in the window is introduced. Some
 * calendars print only the first and last day of a series (measured:
 * Münchenstein's monthly „Suppentopf", 3 November to 6 April) — that is not a
 * span open every day, and the text must not read like one.
 */
const SERIE: Record<string, string> = {
  woechentlich: 'Wöchentlich',
  monatlich: 'Monatlich',
  seltener: 'Mehrmals'
}

/** The minimal text: day, time, place — built by code, so nothing in it is invented. */
export function eckdatenText(
  z: Pick<
    KalenderZeile,
    'von' | 'bis' | 'zeit' | 'lokalitaet' | 'ort' | 'rhythmus'
  >,
  tage: readonly string[],
  heute: string
): string {
  const teile: string[] = []
  if (tage.length === 0 && z.bis !== null) {
    const serie = SERIE[z.rhythmus]
    if (serie !== undefined) teile.push(`${serie} bis ${tagLang(z.bis)}`)
    else
      teile.push(
        z.von < heute
          ? `Bis ${tagLang(z.bis)}`
          : `${tagLang(z.von)} bis ${tagLang(z.bis)}`
      )
  } else {
    const erster = tage[0] ?? z.von
    teile.push(tagLang(erster))
  }
  if (z.zeit !== null && z.zeit.trim() !== '') teile.push(z.zeit.trim())
  if (z.lokalitaet !== null && z.lokalitaet.trim() !== '')
    teile.push(z.lokalitaet.trim())
  if (
    z.ort !== null &&
    z.ort.trim() !== '' &&
    z.ort.trim() !== z.lokalitaet?.trim()
  )
    teile.push(z.ort.trim())
  let text = teile.join(', ')
  const weitere = tage.slice(1)
  if (weitere.length > 0) {
    const genannt = weitere.slice(0, 3).map(datumDeutsch).join(', ')
    const rest = weitere.length - 3
    text += `. Weitere Termine: ${genannt}${rest > 0 ? ` und ${rest} weitere` : ''}`
  }
  return `${text}.`
}

export function anlassAusKalender(
  z: KalenderZeile,
  gemeinde: GemeindeZeile,
  heute: string,
  fensterBis: string
): Anlass {
  const tage = tageImFenster(z, heute, fensterBis)
  return {
    kennung: `kalender:${z.id}`,
    herkunft: 'kalender',
    gemeinde: {
      name: gemeinde.name,
      slug: gemeindeSlug(gemeinde.name),
      bfs: gemeinde.bfs_nummer
    },
    titel: z.titel,
    termine: tage,
    von: z.von,
    bis: z.bis,
    zeit: z.zeit,
    lokalitaet: z.lokalitaet,
    adresse: z.adresse,
    ort: z.ort,
    ort_ausserhalb: z.ort_ausserhalb,
    veranstalter: z.veranstalter,
    art: z.rhythmus,
    ...statusVon(z),
    text: eckdatenText(z, tage, heute),
    text_herkunft: 'eckdaten',
    quelle: {
      art: z.quelle?.art ?? 'gemeinde',
      name: z.quelle?.name ?? 'Veranstaltungskalender',
      url: z.url
    },
    weitere_quellen: []
  }
}

// ---------------------------------------------------------------------------
// Weekly-paper previews
// ---------------------------------------------------------------------------

/** The piece's page in the issue: `#page=N` on a PDF, a path segment on issuu. */
export function vorschauLink(
  a: NonNullable<VorschauZeile['ausgabe']>,
  seite: number | null
): string | null {
  const basis = a.pdf_url ?? a.seite_url
  if (basis === null) return null
  return seite === null || a.pdf_url === null
    ? basis
    : seitenLink(a.pdf_url, seite)
}

/** Which municipality a preview belongs to: the piece's own, else the paper's. */
export function vorschauGemeinde(v: VorschauZeile): string | null {
  return v.gemeinde ?? v.ausgabe?.wochenblatt?.gemeinde ?? null
}

/**
 * The kinds of piece whose preview IS an Anlass. Measured on 17 November
 * 2026 over 82 previews: interviews, portraits, reportages and background
 * pieces announce a day too — a vote, a council debate — but nobody goes
 * there; `veranstaltung`, `service` (a talk, a Spielabend) and
 * `vereinsleben` are what an events site lists.
 */
const ANLASS_TYPEN = new Set(['veranstaltung', 'service', 'vereinsleben'])

export function ausschlussVorschau(
  v: VorschauZeile,
  heute: string,
  fensterBis: string
): 'keine_vorschau' | 'kein_anlass' | 'abgelehnt' | 'ausserhalb' | null {
  if (v.zeitbezug !== 'vorschau' || v.anlass_am === null)
    return 'keine_vorschau'
  if (!ANLASS_TYPEN.has(v.typ)) return 'kein_anlass'
  if (v.entscheid === 'abgelehnt' && ZEILE_FALSCH.has(v.ablehnungsgrund ?? ''))
    return 'abgelehnt'
  if (v.anlass_am < heute || v.anlass_am > fensterBis) return 'ausserhalb'
  return null
}

export function anlassAusVorschau(
  v: VorschauZeile,
  gemeinde: GemeindeZeile
): Anlass {
  const tag = v.anlass_am ?? ''
  const blatt = v.ausgabe?.wochenblatt?.name ?? 'Wochenblatt'
  const nummer = v.ausgabe?.nummer
  const text =
    v.zusammenfassung !== null && v.zusammenfassung.trim() !== ''
      ? v.zusammenfassung.trim()
      : null
  return {
    kennung: `wochenblatt:${v.id}`,
    herkunft: 'wochenblatt',
    gemeinde: {
      name: gemeinde.name,
      slug: gemeindeSlug(gemeinde.name),
      bfs: gemeinde.bfs_nummer
    },
    titel: v.titel,
    termine: [tag],
    von: tag,
    bis: null,
    // The paper gives no structured time or place — they stand in the text, if anywhere.
    zeit: null,
    lokalitaet: null,
    adresse: null,
    ort: null,
    ort_ausserhalb: false,
    veranstalter: null,
    art: 'unbekannt',
    status: 'findet_statt',
    status_hinweis: null,
    text,
    text_herkunft: text === null ? null : 'zusammenfassung_ki',
    quelle: {
      art: 'wochenblatt',
      name:
        nummer === null || nummer === undefined
          ? blatt
          : `${blatt} Nr. ${nummer}`,
      url: v.ausgabe === null ? null : vorschauLink(v.ausgabe, v.seite)
    },
    weitere_quellen: []
  }
}

// ---------------------------------------------------------------------------
// Duplicates
// ---------------------------------------------------------------------------

const RANG: Record<QuellenArt, number> = {
  gemeinde: 0,
  organisation: 1,
  plattform: 2,
  ort: 2,
  wochenblatt: 3
}

/** Which source an entry came from — two entries of one source are never merged. */
function quellenSchluessel(a: Anlass): string {
  return a.herkunft === 'wochenblatt'
    ? `wochenblatt:${a.quelle.name}`
    : `kalender:${a.quelle.name}`
}

function tageVon(a: Anlass): string[] {
  return a.termine.length > 0 ? a.termine : [a.von]
}

/** At least two meaningful words of `titel` appear in `text` — for a paper's own headline. */
function woerterImText(titel: string, text: string): boolean {
  const imText = titelWoerter(text)
  let treffer = 0
  for (const w of titelWoerter(titel)) if (imText.has(w)) treffer += 1
  return treffer >= 2
}

/**
 * Whether `neu` is the same Anlass as `bleibt`: same municipality, a common
 * day, and a similar title. A newspaper headline is rarely the calendar's
 * title, so a preview also matches when two meaningful words of the
 * calendar's title stand in its headline plus its summary.
 */
export function gleicherAnlass(bleibt: Anlass, neu: Anlass): boolean {
  if (bleibt.gemeinde.slug !== neu.gemeinde.slug) return false
  if (quellenSchluessel(bleibt) === quellenSchluessel(neu)) return false
  const alsKalender = {
    titel: bleibt.titel,
    lokalitaet: bleibt.lokalitaet,
    von: bleibt.von,
    bis: bleibt.bis,
    termine: bleibt.termine,
    rhythmus: bleibt.art
  }
  if (!tageVon(neu).some((tag) => anlassAnTag(alsKalender, tag))) return false
  if (gleicherTitel(bleibt.titel, neu.titel)) return true
  return (
    neu.herkunft === 'wochenblatt' &&
    woerterImText(bleibt.titel, `${neu.titel} ${neu.text ?? ''}`)
  )
}

/**
 * One entry per Anlass. The higher-ranking source stays (municipal calendar,
 * organisation, platform or venue, weekly paper); the other becomes a
 * `weitere_quelle` carrying its own `kennung`, so the outside site can
 * recognise an entry it showed before the merge.
 */
export function fuehreZusammen(anlaesse: readonly Anlass[]): {
  anlaesse: Anlass[]
  zusammengefuehrt: number
} {
  const geordnet = [...anlaesse].sort(
    (a, b) => RANG[a.quelle.art] - RANG[b.quelle.art]
  )
  const bleiben: Anlass[] = []
  let zusammengefuehrt = 0
  for (const a of geordnet) {
    const ziel = bleiben.find((b) => gleicherAnlass(b, a))
    if (ziel === undefined) {
      bleiben.push({ ...a, weitere_quellen: [...a.weitere_quellen] })
      continue
    }
    ziel.weitere_quellen.push({
      ...a.quelle,
      kennung: a.kennung,
      titel: a.titel
    })
    zusammengefuehrt += 1
  }
  return { anlaesse: bleiben, zusammengefuehrt }
}

function sortiere(a: Anlass, b: Anlass): number {
  const ta = a.termine[0] ?? a.von
  const tb = b.termine[0] ?? b.von
  return (
    ta.localeCompare(tb) ||
    a.gemeinde.name.localeCompare(b.gemeinde.name, 'de-CH') ||
    a.titel.localeCompare(b.titel, 'de-CH')
  )
}

// ---------------------------------------------------------------------------
// Query and answer
// ---------------------------------------------------------------------------

export type Abfrage = { gemeinde: string | null } | { fehler: string }

/** `?gemeinde=<slug>` — the slug the Dorfkönig API uses too. Unknown → refused, never ignored. */
export function parseAbfrage(
  query: Record<string, unknown>,
  gemeinden: readonly GemeindeZeile[]
): Abfrage {
  const roh = query['gemeinde']
  if (roh === undefined || roh === '') return { gemeinde: null }
  if (typeof roh !== 'string')
    return { fehler: 'Der Parameter gemeinde darf nur einmal vorkommen.' }
  const slugs = gemeinden.map((g) => gemeindeSlug(g.name))
  if (!slugs.includes(roh))
    return {
      fehler: `Unbekannte Gemeinde "${roh}". Bekannt sind: ${slugs.sort().join(', ')}.`
    }
  return { gemeinde: roh }
}

export interface Eingabe {
  jetzt: Date
  gemeinden: readonly GemeindeZeile[]
  kalender: readonly KalenderZeile[]
  vorschauen: readonly VorschauZeile[]
  gemeinde: string | null
}

export function baueAntwort(e: Eingabe): Antwort {
  const heute = tagInZuerich(e.jetzt) ?? e.jetzt.toISOString().slice(0, 10)
  const fensterBis = plusTage(heute, FENSTER_TAGE)
  const gemeinden = new Map(e.gemeinden.map((g) => [g.id, g]))
  const hinweise: string[] = []

  const roh: Anlass[] = []
  let verschwunden = 0
  const ausgeschaltet = new Map<string, number>()
  for (const z of e.kalender) {
    const gemeinde = gemeinden.get(z.gemeinde)
    if (gemeinde === undefined) continue
    const grund = ausschlussKalender(z, heute, fensterBis)
    if (grund === 'verschwunden') verschwunden += 1
    if (grund === 'quelle_aus' && z.quelle !== null)
      ausgeschaltet.set(
        z.quelle.name,
        (ausgeschaltet.get(z.quelle.name) ?? 0) + 1
      )
    if (grund !== null) continue
    roh.push(anlassAusKalender(z, gemeinde, heute, fensterBis))
  }

  // A calendar that could not be read keeps its last known state — said, never silent.
  // So does one read only in part (a day the page refused).
  const quellen = new Map<string, KalenderQuelle>()
  for (const z of e.kalender)
    if (z.quelle !== null && z.quelle.aktiv && gemeinden.has(z.gemeinde))
      quellen.set(z.quelle.id, z.quelle)
  for (const q of quellen.values()) {
    const tag = tagInZuerich(q.letzte_pruefung)
    if (q.letzter_fehler !== null)
      hinweise.push(
        `Kalender «${q.name}» zuletzt nicht lesbar${tag === null ? '' : ` (Versuch vom ${datumDeutsch(tag)})`} — geliefert ist sein zuletzt gelesener Stand.`
      )
    else if (ungeleseneTage(q).length > 0)
      hinweise.push(
        `Kalender «${q.name}» nur teilweise gelesen: ${q.letzter_hinweis ?? ''} Anlässe dieser Tage bleiben im zuletzt gelesenen Stand.`
      )
  }
  for (const [name, n] of ausgeschaltet)
    hinweise.push(
      `Kalender «${name}» ist abgeschaltet — ${n} Anlässe daraus nicht geliefert.`
    )
  if (verschwunden > 0)
    hinweise.push(
      `${verschwunden} Anlässe stehen nicht mehr in ihrem Kalender und sind nicht geliefert.`
    )

  for (const v of e.vorschauen) {
    if (ausschlussVorschau(v, heute, fensterBis) !== null) continue
    const id = vorschauGemeinde(v)
    const gemeinde = id === null ? undefined : gemeinden.get(id)
    if (gemeinde === undefined) continue
    roh.push(anlassAusVorschau(v, gemeinde))
  }

  // Merged over the whole state first, filtered after: a filter must not
  // change which of two sources an entry keeps.
  const { anlaesse } = fuehreZusammen(roh)
  const gefiltert =
    e.gemeinde === null
      ? anlaesse
      : anlaesse.filter((a) => a.gemeinde.slug === e.gemeinde)
  gefiltert.sort(sortiere)
  return {
    format: FORMAT,
    stand: e.jetzt.toISOString(),
    fenster: { von: heute, bis: fensterBis },
    anzahl: gefiltert.length,
    zusammengefuehrt: gefiltert.reduce(
      (n, a) => n + a.weitere_quellen.length,
      0
    ),
    hinweise,
    anlaesse: gefiltert
  }
}
