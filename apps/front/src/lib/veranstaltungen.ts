import type { GemeindeFelder, VeranstaltungFelder, VeranstaltungsquelleFelder } from '@/graphql/redaktion'
import type { GemeindeseitenLaufStatus } from './gemeindeseiten'

// Presentation rules for the events desk. Pure, so they are tested without a
// component — the same shape as `lib/gemeindeseiten.ts` and `lib/amtsblatt.ts`,
// because an editor should not have to learn a fourth desk.
//
// What is different here, and it is the whole feature: a row is an ANLASS, not
// a calendar line. The same thing on three days is one row with three dates.
// And what could make it a Meldung was computed by the run
// (`shared/veranstaltung/anker.ts`), not by this file: the desk SHOWS the
// anchor and never decides it again.

export { datumText } from './amtsblatt'
export { zeitpunktText } from './gemeindeseiten'
export type { GemeindeseitenLaufStatus } from './gemeindeseiten'

/**
 * Die Anker, wie der Tisch sie beschriftet.
 *
 * Kuerzer als im Prompt (`redaktion/veranstaltung.ts`), weil hier ein Chip
 * steht und dort ein Satz — aber dieselbe Menge und dieselbe Bedeutung. Ein
 * unbekannter Wert wird gezeigt, wie er ist: ein neuer Anker im Backend soll
 * sichtbar sein, nicht verschwinden.
 */
export const ANKER_TEXT: Record<string, string> = {
  neu: 'Neu',
  einmalig: 'Einmalig',
  erinnerung: 'Erinnerung',
  abweichung: 'Abweichung',
  beginnt: 'Beginnt',
  endet: 'Letzte Gelegenheit',
  ausfall: 'Fällt aus',
  verschoben: 'Verschoben',
  frist: 'Anmeldefrist',
  gremium: 'Gremium',
  dauerangebot: 'Dauerangebot',
  routine: 'Routine',
  abfuhr: 'Abfuhr',
  platzhalter: 'Platzhalter'
}

export function ankerText(anker: string | null): string {
  if (anker === null) return 'Ohne Anker'
  return ANKER_TEXT[anker] ?? anker
}

type ChipFarbe = 'default' | 'info' | 'success' | 'warning' | 'error'

/**
 * Die Farbe des Anker-Chips.
 *
 * Rot ist reserviert fuer das, was sich GEAENDERT hat — ein Ausfall, eine
 * Verschiebung —, weil das die einzige Sorte ist, die auch dann eine Meldung
 * wert ist, wenn der Anlass selbst es nicht waere. Eine Frist und eine letzte
 * Gelegenheit sind eilig, aber nicht falsch: orange. Alles Wiederkehrende
 * bleibt grau, damit die Routine den Tisch nicht anschreit.
 */
export function ankerFarbe(anker: string | null): ChipFarbe {
  switch (anker) {
    case 'ausfall':
      return 'error'
    case 'verschoben':
    case 'abweichung':
      return 'warning'
    case 'frist':
    case 'endet':
      return 'warning'
    case 'neu':
      return 'success'
    case 'gremium':
    case 'dauerangebot':
    case 'beginnt':
      return 'info'
    default:
      return 'default'
  }
}

/** Dieselben fuenf wie auf den Nachbartischen — „Ort ausserhalb" ist ein Kommentar, kein neues Vokabular. */
export const ABLEHNUNGSGRUENDE: { wert: string; text: string }[] = [
  { wert: 'nicht_relevant', text: 'Nicht relevant' },
  { wert: 'doublette', text: 'Doublette' },
  { wert: 'veraltet', text: 'Veraltet' },
  { wert: 'falsche_gemeinde', text: 'Falsche Gemeinde' },
  { wert: 'andere', text: 'Anderer Grund' }
]

/**
 * Die Einstellung auf einer Routine — zwei Stellungen, die BLEIBEN.
 *
 * „Jetzt vorschlagen" gehoert nicht hierher, obwohl der Endpunkt es als
 * dritten Modus nimmt: es ist ein einmaliger Griff und keine Einstellung, und
 * als dritte Zeile in derselben Liste haette es wie eine ausgesehen.
 */
export const DAUERANGEBOT_OPTIONEN: { wert: string; text: string }[] = [
  { wert: 'intervall', text: 'Alle sechs Monate erinnern' },
  { wert: 'nie', text: 'Nie vorschlagen' }
]

/** Anker, die keine Arbeit sind: sie stehen im gefalteten Teil des Tischs. */
const STILLE_ANKER = new Set(['routine', 'abfuhr', 'platzhalter'])

export function istRuhend(eintrag: Pick<VeranstaltungFelder, 'anker'>): boolean {
  return eintrag.anker === null || STILLE_ANKER.has(eintrag.anker)
}

/**
 * Was auf dem Tisch bleibt: das Offene, und ein uebernommener Anlass, solange
 * seine Meldung redigiert wird — redigiert wird sie hier. Abgelehntes und
 * Weitergereichtes geht sofort; die Zeile selbst bleibt in der Datenbank, sie
 * ist das Gedaechtnis dieses Tischs.
 */
export function bleibtAufDemTisch(
  eintrag: Pick<VeranstaltungFelder, 'entscheid'>,
  meldungStatus: string | null = null
): boolean {
  if (eintrag.entscheid === 'offen') return true
  if (eintrag.entscheid !== 'uebernommen') return false
  if (meldungStatus === null) return false
  return meldungStatus !== 'publiziert' && meldungStatus !== 'verworfen'
}

function tage(von: string, bis: string): number {
  const ms = Date.parse(`${bis.slice(0, 10)}T00:00:00Z`) - Date.parse(`${von.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(ms) ? 0 : Math.round(ms / 86_400_000)
}

/** Der naechste Termin ab heute; gibt es keinen mehr, der letzte bekannte. */
export function naechsterTermin(
  eintrag: Pick<VeranstaltungFelder, 'termine' | 'von' | 'bis'>,
  heute: string
): string {
  const termine = eintrag.termine ?? []
  const kuenftig = termine.find((t) => t >= heute)
  if (kuenftig !== undefined) return kuenftig
  // Eine laufende Spanne ist heute dran, auch wenn ihr erster Tag vorbei ist.
  if (eintrag.bis !== null && eintrag.bis >= heute && eintrag.von <= heute) return heute
  return termine[termine.length - 1] ?? eintrag.von
}

/**
 * Wie dringend eine Zeile ist: der Abstand ihres Ankers zu heute, in Tagen.
 *
 * Der Anker ist das Mass und nicht der Termin, weil die Anmeldefrist vor dem
 * Anlass liegt — ein Bastelnachmittag mit Anmeldeschluss am Montag gehoert am
 * Freitag davor nach oben und nicht am Mittwoch. Ohne Anker zaehlt der
 * naechste Termin.
 */
export function dringlichkeit(eintrag: VeranstaltungFelder, heute: string): number {
  const anker = eintrag.anker_am ?? naechsterTermin(eintrag, heute)
  return tage(heute, anker)
}

function alterInTagen(datum: string | null, heute: string): number | null {
  if (datum === null) return null
  const ms = Date.parse(`${heute}T00:00:00Z`) - Date.parse(`${datum.slice(0, 10)}T00:00:00Z`)
  return Number.isNaN(ms) ? null : Math.floor(ms / 86_400_000)
}

/** Wie lange eine unvorgeschlagene Zeile ohne den Kalender ueberlebt. */
export const RUHEND_TAGE = 21

/**
 * Die Haelfte der Regel, die der 13-Uhr-Lauf durchsetzt (`aufraeumAnlass` in
 * `redaktion/veranstaltung.ts`, dort gehoert sie hin): ohne den Spiegel zeigte
 * der Tisch bis zu einen Tag lang, was der naechste Lauf wegraeumt.
 * Aenderungen auf der einen Seite gehoeren auf die andere.
 */
export function abgelaufen(eintrag: VeranstaltungFelder, heute: string): boolean {
  if (eintrag.entscheid !== 'offen') return false
  if (eintrag.vorschlag === true) return eintrag.anker_am !== null && eintrag.anker_am < heute
  // Der Schalter der Redaktion ist ihre Einstellung — die Zeile bleibt, was
  // der Kalender auch tut.
  if (eintrag.dauerangebot !== null) return false
  const ruhend = alterInTagen(eintrag.zuletzt_gesehen_am, heute)
  return ruhend !== null && ruhend >= RUHEND_TAGE
}

export interface Filter {
  gemeinde: string | null
  suche: string
}

function normalisiere(text: string): string {
  return text.toLocaleLowerCase('de-CH').normalize('NFD').replace(/\p{M}/gu, '')
}

export function passt(eintrag: VeranstaltungFelder, filter: Filter): boolean {
  if (filter.gemeinde !== null && eintrag.gemeinde?.id !== filter.gemeinde) return false
  if (filter.suche.trim() === '') return true
  const suche = normalisiere(filter.suche.trim())
  return [
    eintrag.titel,
    eintrag.lokalitaet ?? '',
    eintrag.ort ?? '',
    eintrag.veranstalter ?? '',
    eintrag.kategorie ?? '',
    eintrag.gemeinde?.name ?? ''
  ]
    .map(normalisiere)
    .some((feld) => feld.includes(suche))
}

/** Was als Naechstes dran ist, zuoberst; bei gleichem Abstand der aeltere Eintrag zuerst. */
export function sortiere(eintraege: readonly VeranstaltungFelder[], heute: string): VeranstaltungFelder[] {
  return [...eintraege].sort((a, b) => {
    const nah = dringlichkeit(a, heute) - dringlichkeit(b, heute)
    if (nah !== 0) return nah
    return a.titel.localeCompare(b.titel, 'de-CH')
  })
}

export interface Tisch {
  /** Was die Sichtung vorgelegt hat — der Kopf des Tischs. */
  vorschlaege: VeranstaltungFelder[]
  /** Verankert, aber nicht vorgeschlagen: ein Klick entfernt, nie versteckt. */
  verankert: VeranstaltungFelder[]
  /** Routine, Abfuhren, Platzhalter — gefaltet, mit dem Dauerangebot-Schalter. */
  routine: VeranstaltungFelder[]
}

export function tisch(
  eintraege: readonly VeranstaltungFelder[],
  filter: Filter,
  meldungStatus: ReadonlyMap<string, string> = new Map(),
  heute: string
): Tisch {
  const offen = sortiere(
    eintraege.filter(
      (e) =>
        bleibtAufDemTisch(e, meldungStatus.get(e.id) ?? null) && passt(e, filter) && !abgelaufen(e, heute)
    ),
    heute
  )
  return {
    vorschlaege: offen.filter((e) => e.vorschlag === true),
    verankert: offen.filter((e) => e.vorschlag !== true && !istRuhend(e)),
    routine: offen.filter((e) => e.vorschlag !== true && istRuhend(e))
  }
}

/** Der Zaehler im Reiter: die Vorschlaege, plus was uebernommen und noch nicht fertig ist. */
export function anzahlOffen(
  eintraege: readonly VeranstaltungFelder[],
  meldungStatus: ReadonlyMap<string, string> = new Map()
): number {
  return eintraege.filter((e) => {
    if (!bleibtAufDemTisch(e, meldungStatus.get(e.id) ?? null)) return false
    return e.vorschlag === true || e.entscheid === 'uebernommen'
  }).length
}

/** Welche Meldung zu welchem Anlass gehoert — am Anlass verschluesselt, nie am Datum. */
export function meldungJeAnlass<T extends { veranstaltung: { id: string } | null }>(
  meldungen: readonly T[]
): Map<string, T> {
  const karte = new Map<string, T>()
  for (const meldung of meldungen) {
    if (meldung.veranstaltung !== null) karte.set(meldung.veranstaltung.id, meldung)
  }
  return karte
}

/** Die Seite, die eine Leserin oeffnet: die kanonische Adresse, sonst der Listen-Link. */
export function seitenLink(eintrag: Pick<VeranstaltungFelder, 'url' | 'url_kanonisch'>): string {
  return eintrag.url_kanonisch ?? eintrag.url
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
]

/**
 * Die Termine einer Serie in einer Zeile: „3., 10. und 17. Oktober 2026
 * (+4 weitere)".
 *
 * Der Monat steht einmal, solange alle im selben liegen — eine Woechentliche
 * mit dreizehn Terminen ist sonst eine Wand. Ein gegriffener Deckel wird
 * GENANNT: dass drei von sieben Terminen dastehen, darf die Redaktion nicht
 * erraten muessen.
 */
export function termineText(termine: readonly string[] | null, hoechstens = 3): string {
  const liste = (termine ?? []).filter((t) => /^\d{4}-\d{2}-\d{2}/.test(t))
  if (liste.length === 0) return ''
  const gezeigt = liste.slice(0, hoechstens)
  const rest = liste.length - gezeigt.length
  const einTag = (iso: string) => String(Number(iso.slice(8, 10)))
  const monatUndJahr = (iso: string) =>
    `${MONATE[Number(iso.slice(5, 7)) - 1] ?? iso.slice(5, 7)} ${iso.slice(0, 4)}`

  const ersterTermin = gezeigt[0] as string
  const gleicherMonat = gezeigt.every((t) => t.slice(0, 7) === ersterTermin.slice(0, 7))
  const text = gleicherMonat
    ? `${gezeigt.map((t) => `${einTag(t)}.`).join(', ')} ${monatUndJahr(ersterTermin)}`
    : gezeigt.map((t) => `${einTag(t)}. ${monatUndJahr(t)}`).join(', ')
  return rest > 0 ? `${text} (+${rest} weitere)` : text
}

/** Aktive Gemeinden ohne einen lesbaren Kalender — benannt, damit eine Leere nie Schweigen ist. */
export function gemeindenOhneKalender(
  gemeinden: readonly GemeindeFelder[],
  quellen: readonly VeranstaltungsquelleFelder[]
): GemeindeFelder[] {
  const mitKalender = new Set(
    quellen.filter((q) => q.aktiv && q.art === 'gemeinde' && q.gemeinde !== null).map((q) => q.gemeinde?.id)
  )
  return gemeinden.filter((g) => g.aktiv && !mitKalender.has(g.id))
}

/** Die Kalender einer Gemeinde, so wie die Karte sie zeigt. */
export function quellenJeGemeinde(
  quellen: readonly VeranstaltungsquelleFelder[]
): Map<string, VeranstaltungsquelleFelder[]> {
  const karte = new Map<string, VeranstaltungsquelleFelder[]>()
  for (const quelle of quellen) {
    const id = quelle.gemeinde?.id
    if (id === undefined) continue
    karte.set(id, [...(karte.get(id) ?? []), quelle])
  }
  return karte
}

/** Kalender, deren letzter Lauf gescheitert ist — je Kalender eine Zeile auf dem Tisch. */
export function quellenMitFehler(
  quellen: readonly VeranstaltungsquelleFelder[]
): VeranstaltungsquelleFelder[] {
  return quellen.filter((q) => q.aktiv && (q.letzter_fehler ?? '').trim() !== '')
}

/**
 * Kalender, die etwas DEKLARIERT haben, ohne zu scheitern — ein gegriffener
 * Deckel etwa. Eigene Liste und eigene Farbe, genau wie bei den
 * Gemeindeseiten: die Seite WURDE gelesen, und morgen geht es weiter.
 */
export function quellenMitHinweis(
  quellen: readonly VeranstaltungsquelleFelder[]
): VeranstaltungsquelleFelder[] {
  return quellen.filter(
    (q) => q.aktiv && (q.letzter_fehler ?? '').trim() === '' && (q.letzter_hinweis ?? '').trim() !== ''
  )
}

/** Erfasste Kalender, fuer die es noch keinen Leser gibt — sichtbar, nicht still. */
export function quellenOhneLeser(
  quellen: readonly VeranstaltungsquelleFelder[]
): VeranstaltungsquelleFelder[] {
  return quellen.filter((q) => q.art !== 'gemeinde')
}

function anzahl(wert: unknown): number {
  return typeof wert === 'number' && Number.isFinite(wert) ? wert : 0
}

/**
 * Was der Tisch ueber den Lauf sagt.
 *
 * Es ist DERSELBE Lauf wie bei den Gemeindeseiten — eine Operation, ein Host,
 * eine Pause —, darum derselbe Status und ein anderer Satz: hier zaehlen die
 * Anlaesse und die wartenden Dauerangebote, dort die Mitteilungen.
 */
export function laufText(status: GemeindeseitenLaufStatus): string | null {
  if (status.laeuft) {
    return 'Der Lauf ist unterwegs — jeder Kalender wird gelesen, das dauert einige Minuten; die Ansicht aktualisiert sich von selbst.'
  }
  if (status.beendet_um === null) return null
  if (status.ergebnis === null) return 'Der letzte Lauf hat nichts zurückgemeldet.'
  const e = status.ergebnis
  const teile = [
    `${anzahl(e['quellen'])} Kalender gelesen`,
    `${anzahl(e['anlaesse'])} Anlässe`,
    `${anzahl(e['anlaesseVorschlaege'])} Vorschläge`
  ]
  const warten = anzahl(e['dauerangeboteWarten'])
  if (warten > 0) teile.push(`${warten} Dauerangebote warten`)
  const fehler = Array.isArray(e['fehler']) ? e['fehler'].length : 0
  if (fehler > 0) teile.push(`${fehler} Fehler`)
  const uhrzeit = new Date(status.beendet_um).toLocaleTimeString('de-CH', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Europe/Zurich'
  })
  return `Letzter Lauf um ${uhrzeit} Uhr — ${teile.join(', ')}.`
}
