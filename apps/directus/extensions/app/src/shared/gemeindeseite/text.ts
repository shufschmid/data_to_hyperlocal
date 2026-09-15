// HTML fragments to readable text — without a DOM library.
//
// Same decision as the agenda reader: the markup is flat and stable, a parser
// dependency would be the third-largest thing in the bundle. What a regex
// cannot do is find the END of an element whose children are elements of the
// same kind, so `schneideElement` counts opening and closing tags — that one
// helper stands in for the DOM everywhere here.

import { decodeEntities } from '../agenda/parse'

/** Longest article body kept — the cap is marked in the text, never silent. */
export const TEXT_MAX_ZEICHEN = 20_000
/** Longest text layer kept per attached PDF — same cap, same marker. */
export const ANHANG_TEXT_MAX_ZEICHEN = 20_000

const UNSICHTBAR =
  /<(script|style|noscript|svg|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi
const KOMMENTAR = /<!--[\s\S]*?-->/g

/**
 * The inner HTML of the element whose opening tag starts at `start`, found by
 * balancing tags of the same name. `start` must point at the `<`.
 */
export function schneideElement(html: string, start: number): string {
  const kopf = /^<([a-zA-Z][\w:-]*)\b[^>]*>/.exec(html.slice(start))
  if (kopf === null) return ''
  const tag = kopf[1] ?? ''
  const innenStart = start + kopf[0].length
  if (kopf[0].endsWith('/>')) return ''

  const muster = new RegExp(`<(/?)${tag}(?=[\\s>/])[^>]*>`, 'gi')
  muster.lastIndex = innenStart
  let tiefe = 1
  let treffer: RegExpExecArray | null
  while ((treffer = muster.exec(html)) !== null) {
    if (treffer[0].endsWith('/>')) continue
    if (treffer[1] === '/') {
      tiefe -= 1
      if (tiefe === 0) return html.slice(innenStart, treffer.index)
    } else {
      tiefe += 1
    }
  }
  return html.slice(innenStart)
}

/**
 * Removes every element whose class list contains `klasse`, children included.
 * Used to drop navigation boxes ("Zurück", previous/next) that sit inside the
 * content block of some templates.
 */
export function entferneElemente(html: string, klasse: string): string {
  const muster = new RegExp(
    `<[a-zA-Z][\\w:-]*\\b[^>]*\\bclass="[^"]*\\b${klasse}\\b[^"]*"[^>]*>`,
    'i'
  )
  let rest = html
  for (let runde = 0; runde < 50; runde += 1) {
    const treffer = muster.exec(rest)
    if (treffer === null) break
    const innen = schneideElement(rest, treffer.index)
    const ende =
      rest.indexOf(innen, treffer.index + treffer[0].length) + innen.length
    const schliesst = /^<\/[a-zA-Z][\w:-]*\s*>/.exec(rest.slice(ende))
    rest =
      rest.slice(0, treffer.index) +
      rest.slice(ende + (schliesst?.[0].length ?? 0))
  }
  return rest
}

/** Scripts, styles and comments gone — run this BEFORE cutting elements by class, or a class name inside a script string is taken for an element. */
export function ohneUnsichtbares(html: string): string {
  return html.replace(UNSICHTBAR, ' ').replace(KOMMENTAR, ' ')
}

/**
 * A fragment as plain text with paragraph breaks: list items become dashes,
 * figure captions become "Bild: …" lines, everything else is stripped. Line
 * breaks in the SOURCE are whitespace, as in HTML; only `<br>` and block ends
 * break lines here.
 */
export function blockZuText(fragment: string): string {
  const roh = ohneUnsichtbares(fragment)
    .replace(/\s+/g, ' ')
    .replace(
      /<figcaption\b[^>]*>([\s\S]*?)<\/figcaption\s*>/gi,
      '\n\nBild: $1\n\n'
    )
    .replace(/<li\b[^>]*>/gi, '\n– ')
    .replace(/<\/li\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(
      /<\/(?:p|div|h[1-6]|tr|ul|ol|table|section|article|blockquote|figure|dd|dt)\s*>/gi,
      '\n\n'
    )
    .replace(
      /<(?:p|div|h[1-6]|tr|ul|ol|table|section|article|blockquote|figure)\b[^>]*>/gi,
      '\n'
    )
    .replace(/<\/t[dh]\s*>/gi, ' ')
    .replace(/<[^>]+>/g, '')

  const zeilen = decodeEntities(roh)
    .replace(/ /g, ' ')
    .split('\n')
    .map((zeile) => zeile.replace(/[ \t]+/g, ' ').trim())

  return zeilen
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/(^|\n)– *\n/g, '$1')
    .trim()
}

/** One line: tags gone, entities resolved, whitespace collapsed. */
export function reinerText(fragment: string): string {
  return decodeEntities(
    fragment.replace(UNSICHTBAR, ' ').replace(/<[^>]+>/g, ' ')
  )
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Cuts at the last paragraph break before `max` and says so in the text — the
 * reader of this string may be a prompt, and a text that just stops reads as
 * complete.
 */
export function kappe(
  text: string,
  max: number
): { text: string; abgeschnitten: boolean } {
  if (text.length <= max) return { text, abgeschnitten: false }
  let schnitt = text.lastIndexOf('\n\n', max)
  if (schnitt < max / 2) schnitt = max
  return {
    text: `${text.slice(0, schnitt).trimEnd()} … [Text gekürzt]`,
    abgeschnitten: true
  }
}
