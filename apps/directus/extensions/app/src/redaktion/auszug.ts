// The excerpt a Sichtung reads when its question is «does this item concern
// THIS municipality» — the beginning of the text plus every passage that
// names the municipality.
//
// Measured on the Regierungsbulletin of 13 October 2026 (4'857 characters):
// the Sichtung saw the first 400 — the naturalisations — and answered
// «Allschwil wird im Bulletin nicht genannt», while the 100th birthday of
// an Allschwil resident stood at character 3'000 and the writer, handed the
// whole text, made the right Meldung of it. A Kanton or SMD item is on the
// desk BECAUSE the pre-filter found the name, so the passage around that
// find is the one the Sichtung must see.

import { gekuerzt } from './presseschau'

/** How many characters to each side of a find travel with it. */
export const FUNDSTELLE_FENSTER = 160
/** How many finds an excerpt carries at most; the rest is counted. */
export const FUNDSTELLEN_MAX = 3

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** `[von, bis)` character windows around every whole-word occurrence of the name. */
function fenster(
  text: string,
  name: string,
  weite: number
): Array<[number, number]> {
  const muster = new RegExp(`\\b${escapeRegExp(name.trim())}\\b`, 'giu')
  const treffer: Array<[number, number]> = []
  for (const m of text.matchAll(muster)) {
    const von = Math.max(0, m.index - weite)
    const bis = Math.min(text.length, m.index + m[0].length + weite)
    const letzter = treffer[treffer.length - 1]
    if (letzter !== undefined && von <= letzter[1]) letzter[1] = bis
    else treffer.push([von, bis])
  }
  return treffer
}

/**
 * The beginning of the item as `auszugVon` builds it — teaser where there is
 * one, else the first `max` characters of the text — followed by the
 * passages of the TEXT that name the municipality and lie beyond what the
 * beginning already shows. Seams are visible («[…]»), at most
 * `FUNDSTELLEN_MAX` passages travel, and the rest is counted so a cap that
 * bites is said in the prompt rather than silently taken.
 */
export function auszugMitFundstellen(
  zeile: { anriss: string | null; text: string | null },
  gemeinde: string,
  max: number
): string {
  const anriss = (zeile.anriss ?? '').replace(/\s+/g, ' ').trim()
  const text = (zeile.text ?? '').replace(/\s+/g, ' ').trim()
  const anfangAusText = anriss === ''
  const anfang = gekuerzt(anfangAusText ? text : anriss, max)
  if (text === '' || gemeinde.trim() === '') return anfang

  // What the beginning already shows of the text — nothing when the
  // beginning is the teaser; a find inside that span is not repeated.
  const gezeigtBis = anfangAusText ? Math.min(max, text.length) : 0
  const stellen = fenster(text, gemeinde, FUNDSTELLE_FENSTER).filter(
    ([, bis]) => bis > gezeigtBis
  )
  if (stellen.length === 0) return anfang

  const gezeigt = stellen.slice(0, FUNDSTELLEN_MAX).map(([von, bis]) => {
    const start = Math.max(von, gezeigtBis)
    const vorn = start > 0 ? '…' : ''
    const hinten = bis < text.length ? '…' : ''
    return `${vorn}${text.slice(start, bis).trim()}${hinten}`
  })
  const weitere = stellen.length - gezeigt.length
  const teile = [
    anfang,
    ...gezeigt.map((s) => `[Fundstelle «${gemeinde}»] ${s}`)
  ]
  if (weitere > 0)
    teile.push(
      `(${weitere} weitere Stelle${weitere === 1 ? '' : 'n'} nennt ${gemeinde} ebenfalls.)`
    )
  return teile.join('\n   ')
}
