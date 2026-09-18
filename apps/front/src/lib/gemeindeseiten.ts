import type { GemeindeFelder, GemeindemitteilungFelder } from '@/graphql/redaktion'

// Presentation rules for the municipal-news desk. Pure, so they are tested
// without a component. The same shape as `lib/amtsblatt.ts` on purpose — the
// two desks work the same way, and an editor should not have to learn two.

export { datumText } from './amtsblatt'

/** Without „zu privat": a municipality names its office-holders by design. */
export const ABLEHNUNGSGRUENDE: { wert: string; text: string }[] = [
  { wert: 'nicht_relevant', text: 'Nicht relevant' },
  { wert: 'doublette', text: 'Doublette' },
  { wert: 'veraltet', text: 'Veraltet' },
  { wert: 'falsche_gemeinde', text: 'Falsche Gemeinde' },
  { wert: 'andere', text: 'Anderer Grund' }
]

/**
 * What stays on the desk: the open rows, and a taken-over row while its
 * Meldung is still being edited — the editing happens here. Rejected and
 * handed-up rows leave at once; so does a Meldung that is published or
 * discarded. The rows themselves stay in the database — this feed's memory.
 */
export function bleibtAufDemTisch(
  eintrag: GemeindemitteilungFelder,
  meldungStatus: string | null = null
): boolean {
  if (eintrag.entscheid === 'offen') return true
  if (eintrag.entscheid !== 'uebernommen') return false
  if (meldungStatus === null) return false
  return meldungStatus !== 'publiziert' && meldungStatus !== 'verworfen'
}

/**
 * Der Termin einer Zeile, oder null.
 *
 * Ueber `?? null`, weil eine Antwort das Feld auch weglassen kann — waehrend
 * eines Rollouts oder aus einer aelteren Abfrage. `undefined !== null` haette
 * jede Nachricht zum Termin ohne Datum gemacht.
 */
export function terminVon(eintrag: Pick<GemeindemitteilungFelder, 'veranstaltung_am'>): string | null {
  return eintrag.veranstaltung_am ?? null
}

function tage(von: string, bis: string): number {
  const ms = Date.parse(`${bis.slice(0, 10)}T00:00:00Z`) - Date.parse(`${von.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(ms) ? 0 : Math.round(ms / 86_400_000)
}

/**
 * Wie dringend eine Zeile ist: ihr Abstand zu heute, in Tagen.
 *
 * Nachrichten und Termine liegen auf verschiedenen Seiten von heute — die eine
 * ist erschienen, der andere steht bevor —, und genau darum ist der Abstand
 * das gemeinsame Mass. Die Meldung von heute und der Anlass von morgen stehen
 * beieinander zuoberst, der Anlass in zehn Wochen und die Meldung von letzter
 * Woche weiter unten. Ein zweiter Tisch waere die andere Antwort gewesen, und
 * die Redaktion will keinen.
 */
export function dringlichkeit(eintrag: GemeindemitteilungFelder, heute: string): number {
  const termin = terminVon(eintrag)
  if (termin !== null) return tage(heute, termin)
  const erschienen = eintrag.publiziert_am ?? eintrag.date_created
  return erschienen === null ? Number.MAX_SAFE_INTEGER : tage(erschienen, heute)
}

/** Ein Termin, der stattgefunden hat — vom Tisch, wie alt die Zeile auch ist. */
export function vorbei(eintrag: GemeindemitteilungFelder, heute: string): boolean {
  const termin = terminVon(eintrag)
  return termin !== null && termin < heute
}

/**
 * Was als Naechstes dran ist, zuoberst. Ohne `heute` bleibt es beim alten
 * Mass: die zuletzt publizierte Mitteilung zuerst.
 */
export function sortiere(
  eintraege: readonly GemeindemitteilungFelder[],
  heute: string | null = null
): GemeindemitteilungFelder[] {
  return [...eintraege].sort((a, b) => {
    if (heute !== null) {
      const nah = dringlichkeit(a, heute) - dringlichkeit(b, heute)
      if (nah !== 0) return nah
    } else {
      const tag = (b.publiziert_am ?? '').localeCompare(a.publiziert_am ?? '')
      if (tag !== 0) return tag
    }
    return (b.date_created ?? '').localeCompare(a.date_created ?? '')
  })
}

export interface Filter {
  gemeinde: string | null
  suche: string
}

function normalisiere(text: string): string {
  return text.toLocaleLowerCase('de-CH').normalize('NFD').replace(/\p{M}/gu, '')
}

export function passt(eintrag: GemeindemitteilungFelder, filter: Filter): boolean {
  if (filter.gemeinde !== null && eintrag.gemeinde?.id !== filter.gemeinde) return false
  if (filter.suche.trim() === '') return true
  const suche = normalisiere(filter.suche.trim())
  return [eintrag.titel, eintrag.teaser ?? '', eintrag.kategorie ?? '', eintrag.gemeinde?.name ?? '']
    .map(normalisiere)
    .some((feld) => feld.includes(suche))
}

/** How long an unproposed item waits before the run drops it. */
export const AUFRAEUM_TAGE = 7
/** How long an undecided proposal waits before the run lets it lapse. */
export const VORSCHLAG_VERFALL_TAGE = 14

function alterInTagen(datum: string | null, heute: string): number | null {
  if (datum === null) return null
  const ms = Date.parse(`${heute}T00:00:00Z`) - Date.parse(`${datum.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(ms) ? null : Math.floor(ms / 86_400_000)
}

/**
 * The view's half of the rule the 13:00 run enforces (`aufraeumAktion` in
 * `redaktion/gemeindeseite.ts`, which owns it): without the mirror the desk
 * would show for up to a day what the next run retires. Changes on one side
 * belong on the other.
 */
export function abgelaufen(eintrag: GemeindemitteilungFelder, heute: string): boolean {
  if (eintrag.entscheid !== 'offen') return false
  // Ein Termin verfaellt an seinem eigenen Tag, nicht mit dem Alter.
  if (terminVon(eintrag) !== null) return vorbei(eintrag, heute)
  const alter = alterInTagen(eintrag.publiziert_am ?? eintrag.date_created, heute)
  if (alter === null) return false
  return eintrag.vorschlag === true ? alter >= VORSCHLAG_VERFALL_TAGE : alter >= AUFRAEUM_TAGE
}

export interface Tisch {
  /** What the Sichtung put forward — the top of the desk. */
  vorschlaege: GemeindemitteilungFelder[]
  /** Everything else, one click away. Never hidden, only folded. */
  uebrige: GemeindemitteilungFelder[]
}

export function tisch(
  eintraege: readonly GemeindemitteilungFelder[],
  filter: Filter,
  meldungStatus: ReadonlyMap<string, string> = new Map(),
  heute: string | null = null
): Tisch {
  const offen = sortiere(
    eintraege.filter(
      (e) =>
        bleibtAufDemTisch(e, meldungStatus.get(e.id) ?? null) &&
        passt(e, filter) &&
        (heute === null || !abgelaufen(e, heute))
    ),
    heute
  )
  return {
    vorschlaege: offen.filter((e) => e.vorschlag === true),
    uebrige: offen.filter((e) => e.vorschlag !== true)
  }
}

/** The badge on the tab: the proposals, plus what is taken over and not finished. */
export function anzahlOffen(
  eintraege: readonly GemeindemitteilungFelder[],
  meldungStatus: ReadonlyMap<string, string> = new Map()
): number {
  return eintraege.filter((e) => {
    if (!bleibtAufDemTisch(e, meldungStatus.get(e.id) ?? null)) return false
    return e.vorschlag === true || e.entscheid === 'uebernommen'
  }).length
}

/** Which article belongs to which item — keyed by the item, so a discarded article cannot hide a later one. */
export function meldungJeMitteilung<T extends { gemeindemitteilung: { id: string } | null }>(
  meldungen: readonly T[]
): Map<string, T> {
  const karte = new Map<string, T>()
  for (const meldung of meldungen) {
    if (meldung.gemeindemitteilung !== null) karte.set(meldung.gemeindemitteilung.id, meldung)
  }
  return karte
}

/** The page a reader opens: the canonical address where the site names one, else the list link. */
export function seitenLink(eintrag: Pick<GemeindemitteilungFelder, 'url' | 'url_kanonisch'>): string {
  return eintrag.url_kanonisch ?? eintrag.url
}

/** Active municipalities without a registered news page — named, so an absence is never silence. */
export function ohneNewsseite(gemeinden: readonly GemeindeFelder[]): GemeindeFelder[] {
  return gemeinden.filter((g) => g.aktiv && (g.news_url ?? '').trim() === '')
}

/** Dieselbe Aussage fuer die zweite Adresse: von hier kommen keine Veranstaltungen. */
export function ohneVeranstaltungsseite(gemeinden: readonly GemeindeFelder[]): GemeindeFelder[] {
  return gemeinden.filter((g) => g.aktiv && (g.veranstaltungen_url ?? '').trim() === '')
}

/** Municipalities whose last read failed — each with its own line on the desk. */
export function lesefehler(gemeinden: readonly GemeindeFelder[]): GemeindeFelder[] {
  return gemeinden.filter((g) => g.aktiv && (g.news_letzter_fehler ?? '').trim() !== '')
}

/**
 * Gemeinden, deren letzter Lauf etwas DEKLARIERT hat, ohne zu scheitern — ein
 * gegriffener Deckel zum Beispiel.
 *
 * Eine eigene Liste, weil es eine eigene Aussage ist: die Seite wurde gelesen,
 * ein Deckel hat gegriffen, morgen geht es weiter. Am 18. September 2026
 * trugen neun von zehn Gemeinden eine orange Zeile, und bei acht von ihnen war
 * nichts schiefgegangen. Wer das lange genug sieht, liest die Statuszeile gar
 * nicht mehr.
 */
export function lesehinweise(gemeinden: readonly GemeindeFelder[]): GemeindeFelder[] {
  return gemeinden.filter((g) => g.aktiv && (g.news_letzter_hinweis ?? '').trim() !== '')
}

const GRUND_TEXT: Record<string, string> = {
  deckel: 'nicht gelesen — mehr Anhänge als der Lauf liest',
  zu_gross: 'nicht gelesen — zu gross',
  kein_pdf: 'kein PDF',
  nicht_erreichbar: 'nicht erreichbar',
  robots: 'nicht gelesen — robots.txt',
  fremde_site: 'nicht gelesen — fremde Website',
  kein_text: 'ohne Textebene'
}

/** What the desk says next to an unread attachment. */
export function anhangHinweis(grund: string | null | undefined): string | null {
  if (grund === null || grund === undefined) return null
  return GRUND_TEXT[grund] ?? grund
}

/** `2026-09-14T13:02:00Z` → `14. September 2026, 13:02` in Swiss time. */
export function zeitpunktText(iso: string | null): string {
  if (iso === null) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('de-CH', {
    timeZone: 'Europe/Zurich',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** The hand-started run, mirrored from the extension's process — the twin of `QuellenLaufStatus`. */
export interface GemeindeseitenLaufStatus {
  laeuft: boolean
  gestartet_um: string | null
  beendet_um: string | null
  ergebnis: Record<string, unknown> | null
  fehler: string | null
}

function anzahl(wert: unknown): number {
  return typeof wert === 'number' && Number.isFinite(wert) ? wert : 0
}

/** What the desk says about the run: under way, or what the last one brought. */
export function laufText(status: GemeindeseitenLaufStatus): string | null {
  if (status.laeuft) {
    return 'Der Lauf ist unterwegs — jede Gemeindeseite wird gelesen, das dauert einige Minuten; die Ansicht aktualisiert sich von selbst.'
  }
  if (status.beendet_um === null) return null
  if (status.ergebnis === null) return 'Der letzte Lauf hat nichts zurückgemeldet.'
  const e = status.ergebnis
  const teile = [
    `${anzahl(e['gemeinden'])} Gemeinden gelesen`,
    `${anzahl(e['neu'])} neue Mitteilungen`,
    `${anzahl(e['vorschlaege'])} Vorschläge`
  ]
  const fehler = Array.isArray(e['fehler']) ? e['fehler'].length : 0
  if (fehler > 0) teile.push(`${fehler} Fehler`)
  const uhrzeit = new Date(status.beendet_um).toLocaleTimeString('de-CH', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Zurich'
  })
  return `Letzter Lauf um ${uhrzeit} Uhr — ${teile.join(', ')}.`
}
