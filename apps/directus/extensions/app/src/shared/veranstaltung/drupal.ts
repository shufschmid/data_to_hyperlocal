// Ein Veranstaltungskalender, der nur durch eine JSON-Tuer spricht.
//
// Riehens offizieller Kalender liegt auf einer eigenen Domain und auf einem
// anderen CMS als die Gemeindeseite: Drupal mit dem Modul `riehen_event`, und
// die Agenda-Seite baut ihre Liste erst im Browser. Ihr rohes HTML traegt
// NULL Eintraege — der Leser der anderen Familien haette dort fuer immer
// „keine Eintraege gefunden" gemeldet. Die Tuer ist die, die die Seite selbst
// benutzt: `/de/api/event` mit `limit`, `offset` und `dateFrom`, genau wie in
// `event_calendar.js`. Nichts ist nachgebaut, nichts erraten.
//
// **Die Tuer muss TAG FUER TAG befragt werden, und das ist gemessen.** Am
// 20. September 2026 gegen den echten Kalender geprueft:
//
//   - Eine Woche am Stueck (`dateFrom=20.9.`, `dateTo=27.9.`) liefert 8
//     Eintraege. Dieselbe Woche Tag fuer Tag gelesen liefert 14 — die sechs
//     fehlenden sind eine Teilmenge, kein Zufall.
//   - `offset` zaehlt VORKOMMEN, die Antwort aber liefert Serien: Seiten
//     ueberlappen einander und lassen zugleich Luecken. Mit `limit=100` in
//     zwei Abrufen kamen 58 Serien zurueck, mit `limit=20` in neun Abrufen
//     ueber denselben Bereich 116 — die 58 waren eine echte Teilmenge.
//   - `total` zaehlt ebenfalls Vorkommen und ist darum groesser als die Zahl
//     der Eintraege; das ist kein Verlust, sondern die Entfaltung einer Serie.
//
// Eine Seite zu blaettern hiesse also, eine stille Stichprobe zu nehmen. Ein
// Tag ist klein genug, dass die Antwort ihn ganz traegt — und wo sie doch
// einmal am Deckel anschlaegt, sagt es der Lauf.

import type { ListenEintrag } from '../gemeindeseite/liste'
import type { Heute } from '../gemeindeseite/datum'

/** Der Pfad, den die Seite selbst ruft (`event_calendar.js`). */
export const API_PFAD = '/de/api/event'

/**
 * Wie viele Eintraege ein Tag hoechstens bringen darf.
 *
 * Grosszuegig, weil ein Tag in Riehen ein knappes Dutzend traegt. Schlaegt er
 * an, ist das ein DEKLARIERTER Deckel und keine stille Kuerzung.
 */
export const TAGES_DECKEL = 100

export interface DrupalItem {
  id?: unknown
  title?: unknown
  url?: unknown
  category?: unknown
  organiser?: unknown
  dateRange?: unknown
}

/** Was ein Tagesabruf zurueckgibt. */
export interface DrupalAntwort {
  items?: unknown
  count?: unknown
  total?: unknown
}

/** Die Adresse der JSON-Tuer zur Uebersichtsseite, die eine Redaktorin erfasst hat. */
export function apiAdresse(
  uebersicht: string,
  tag: string,
  bis: string
): string {
  const basis = new URL(uebersicht)
  const url = new URL(API_PFAD, basis.origin)
  url.searchParams.set('limit', String(TAGES_DECKEL))
  url.searchParams.set('offset', '0')
  url.searchParams.set('dateFrom', tag)
  url.searchParams.set('dateTo', bis)
  return url.toString()
}

/**
 * Die Serie hinter einem Vorkommen.
 *
 * `id` ist `<Serie>_<Vorkommen>` — „9838_486" ist der 486. Tag derselben
 * Ausstellung. Ohne diese Zerlegung waere jeder Tag eine eigene Serie, und
 * die Ausstellung stuende 52 Mal auf dem Tisch.
 */
export function serienIdVon(id: string): string | null {
  const treffer = /^([^_\s]+)_/.exec(id.trim())
  return treffer?.[1] ?? (id.trim() === '' ? null : id.trim())
}

/** `<span>22. Mai. 2025 – 04. Jan. 2027</span>` → der Text darin, ohne Marken. */
export function nurText(wert: unknown): string | null {
  if (typeof wert !== 'string') return null
  const text = wert
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
  return text === '' ? null : text
}

/** Die Seite des Anlasses ohne `?date=` — der Link, den eine Leserin oeffnet. */
export function anlassAdresse(url: string): string | null {
  try {
    const u = new URL(url)
    u.search = ''
    u.hash = ''
    return u.toString()
  } catch {
    return null
  }
}

/**
 * Ein Vorkommen der Tuer wird ein Listeneintrag des Tages, nach dem gefragt
 * wurde.
 *
 * Das Datum kommt aus der FRAGE und nicht aus der Antwort: `day` traegt
 * „So. 20. September" ohne Jahr, und ein Jahr zu raten ist genau der Fehler,
 * den die Fuenf-Jahres-Regel verbietet. Wonach gefragt wurde, ist bekannt.
 */
export function eintragAusItem(
  item: DrupalItem,
  tag: string
): ListenEintrag | null {
  const id = typeof item.id === 'string' ? item.id : ''
  const titel = nurText(item.title)
  const roh = typeof item.url === 'string' ? item.url : ''
  const url = anlassAdresse(roh)
  if (titel === null || url === null || id === '') return null
  const serie = serienIdVon(id)
  return {
    url,
    titel,
    teaser: null,
    datum: null,
    datumQuelle: null,
    kategorie: nurText(item.category),
    veranstaltungAm: tag,
    veranstaltungBis: null,
    zeit: null,
    lokalitaet: null,
    ort: null,
    veranstalter: nurText(item.organiser),
    direktPdf: false,
    serie,
    serieSeit: null,
    abgesagt: false
  }
}

/** Die Eintraege einer Tagesantwort, plus ob der Deckel gegriffen hat. */
export function eintraegeAusAntwort(
  antwort: DrupalAntwort,
  tag: string
): { eintraege: ListenEintrag[]; abgeschnitten: boolean } {
  const items = Array.isArray(antwort.items)
    ? (antwort.items as DrupalItem[])
    : []
  const eintraege: ListenEintrag[] = []
  for (const item of items) {
    const eintrag = eintragAusItem(item, tag)
    if (eintrag !== null) eintraege.push(eintrag)
  }
  return { eintraege, abgeschnitten: items.length >= TAGES_DECKEL }
}

/** Ein ISO-Tag, `versatz` Tage nach `heute`. */
export function tagNach(heute: Heute, versatz: number): string {
  const ms =
    Date.UTC(heute.jahr, heute.monat - 1, heute.tag) + versatz * 86_400_000
  return new Date(ms).toISOString().slice(0, 10)
}

/** Was der Leser fuer diese Familie koennen muss: eine JSON-Tuer, hoeflich bedient. */
export interface JsonLeser {
  liesJson(url: string, siteVon: string): Promise<unknown>
}

export interface DrupalErgebnis {
  eintraege: ListenEintrag[]
  /** Tage, deren Antwort am Deckel anschlug — deklariert, nie still. */
  abgeschnitten: string[]
  /** Tage, deren Abruf scheiterte; der Lauf nennt sie. */
  fehler: string[]
}

/**
 * Das Fenster Tag fuer Tag, ueber die Tuer, die die Seite selbst benutzt.
 *
 * Ein einzelner gescheiterter Tag kostet diesen Tag und nicht den ganzen
 * Kalender — aber er wird genannt, damit ein Loch nie wie ein leerer Tag
 * aussieht.
 */
export async function drupalEintraege(
  leser: JsonLeser,
  uebersicht: string,
  heute: Heute,
  fensterTage: number
): Promise<DrupalErgebnis> {
  const site = new URL(uebersicht).hostname
  const eintraege: ListenEintrag[] = []
  const abgeschnitten: string[] = []
  const fehler: string[] = []
  for (let versatz = 0; versatz <= fensterTage; versatz += 1) {
    const tag = tagNach(heute, versatz)
    const adresse = apiAdresse(uebersicht, tag, tagNach(heute, versatz + 1))
    try {
      const antwort = (await leser.liesJson(adresse, site)) as DrupalAntwort
      const gelesen = eintraegeAusAntwort(antwort, tag)
      eintraege.push(...gelesen.eintraege)
      if (gelesen.abgeschnitten) abgeschnitten.push(tag)
    } catch (error) {
      fehler.push(
        `${tag}: ${error instanceof Error ? error.message : 'Abruf gescheitert'}`
      )
    }
  }
  return { eintraege, abgeschnitten, fehler }
}
