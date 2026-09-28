import { normalisiereUrl } from './url'

// The list names the item; the detail page has to PROVE it is that item.
//
// Measured on Binningen (Backslash, 28 September 2026): its news list links
// eight of 33 entries not to the notice but to a topic page — a construction
// notice to the page of ALL construction sites, the vote results to the
// results page with every voting document. Those pages ignore the
// `…/news/<id>` at the end of the address, so read as the item they handed
// over 6'265 characters about fifteen construction sites and 26 PDFs, and the
// notice itself — the closure of the Fuchshagweg exit — was nowhere in them.
// The same notice under the list's own address (`news.html/106/news/6819`)
// is 289 characters and exactly the notice.
//
// So the teaser the list printed is the proof: a detail page that does not
// carry it is not this item's page. Checked on every saved pair of list and
// detail page (Riehen, Reinach, Binningen): on a correct page the teaser is
// always there; where a list prints none (Bottmingen, Aesch) there is nothing
// to check and nothing changes.

/** How many words of the teaser must stand, in order, in the detail page. */
const BELEG_WOERTER = 8

/** A teaser shorter than this proves nothing — „Mehr erfahren" is on every page. */
const MIN_WOERTER = 4

function woerter(text: string): string[] {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter((w) => w !== '')
}

/**
 * Whether the page carries the list's teaser: its first eight words, in
 * order, somewhere in title, lead or text. null when there is nothing to
 * check — no teaser, or one too short to mean anything.
 */
export function traegtAnriss(
  detail: { titel: string | null; lead: string | null; text: string },
  teaser: string | null
): boolean | null {
  const kern = woerter(teaser ?? '').slice(0, BELEG_WOERTER)
  if (kern.length < MIN_WOERTER) return null
  const seite = ` ${woerter([detail.titel, detail.lead, detail.text].filter((t) => t !== null).join(' ')).join(' ')} `
  return seite.includes(` ${kern.join(' ')} `)
}

/**
 * Backslash shows every entry of a news list under the list's OWN address —
 * `<list>.html/<page>/news/<id>` — whatever page the editors linked it to.
 * Returns that address for an entry that links elsewhere, or null when the
 * entry already lives under the list or carries no news id (a plain page
 * link, like a council's session page).
 */
export function modulAdresse(
  listeUrl: string,
  eintragUrl: string
): string | null {
  const liste = normalisiereUrl(listeUrl, listeUrl)
  const id = /\/news\/(\d+)\/?$/.exec(eintragUrl)?.[1]
  if (liste === null || id === undefined) return null
  if (!/\.html\/\d+$/.test(liste)) return null
  const eigen = `${liste}/news/${id}`
  return normalisiereUrl(eintragUrl, eintragUrl) === eigen ? null : eigen
}

/** How a Mitteilung's text was found — said on the row whenever it is not the plain case. */
export type Beleg = 'ungeprueft' | 'eigen' | 'modul' | 'nur_anriss'

export const HINWEIS_MODUL =
  'Die Liste verlinkt eine andere Seite — gelesen über die eigene Adresse der Mitteilung'

export const HINWEIS_NUR_ANRISS =
  'Die verlinkte Seite zeigt nicht diese Mitteilung — nur der Anriss aus der Liste'

/**
 * A row read before this check, recognised by its stored text: it carries a
 * teaser, and its text does not. Read again by the next run.
 */
export function falschGelesen(zeile: {
  titel: string | null
  teaser: string | null
  text: string | null
  hinweise: string[] | null
}): boolean {
  if ((zeile.hinweise ?? []).includes(HINWEIS_NUR_ANRISS)) return false
  return (
    traegtAnriss(
      { titel: zeile.titel, lead: null, text: zeile.text ?? '' },
      zeile.teaser
    ) === false
  )
}
