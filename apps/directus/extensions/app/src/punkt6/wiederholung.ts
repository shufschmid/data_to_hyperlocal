import type { Paragraph } from '../shared/pdf-text'

// SMD sometimes mails a RERUN under the new day's name. Measured on 27
// September 2026: the mail „punkt6neu vom 27.09.2026" was headed „punkt6 vom
// 27.09.2026" and carried Saturday's show again — 126 of its 139 paragraphs
// word for word, the other 13 differing only in their line breaks — while the
// web episode of that Sunday was a vote special. Its markers could never fit
// that text, so the dossier "waited for markers" that were long published,
// and after three days it would have been accepted as a second Saturday on the
// desk, its stories proposed a second time.
//
// So a transcript is compared with the editions of the days before, as WORDS
// rather than paragraphs (the line breaks moved), in runs of eight: two
// different shows share a greeting and a weather forecast, not whole passages.

/** How many days back a rerun is looked for. */
export const WIEDERHOLUNG_TAGE = 7

/** Share of a transcript's word runs that must stand in an earlier one. */
export const WIEDERHOLUNG_SCHWELLE = 0.8

const LAUF = 8

function woerter(paragraphs: readonly Pick<Paragraph, 'text'>[]): string[] {
  return paragraphs
    .map((p) => p.text)
    .join(' ')
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter((w) => w !== '')
}

function laeufe(w: readonly string[]): Set<string> {
  const aus = new Set<string>()
  for (let i = 0; i + LAUF <= w.length; i++)
    aus.add(w.slice(i, i + LAUF).join(' '))
  return aus
}

export interface FruehereAusgabe {
  broadcast_date: string
  transcript: readonly Pick<Paragraph, 'text'>[] | null
}

/**
 * The earlier edition this transcript repeats, with the share of its word runs
 * found there — or null. A transcript too short to judge (under 60 words) is
 * never called a repeat.
 */
export function wiederholungVon(
  paragraphs: readonly Pick<Paragraph, 'text'>[],
  frueher: readonly FruehereAusgabe[],
  schwelle = WIEDERHOLUNG_SCHWELLE
): { datum: string; anteil: number } | null {
  const neu = laeufe(woerter(paragraphs))
  if (neu.size < 60) return null
  let bester: { datum: string; anteil: number } | null = null
  for (const f of frueher) {
    if (f.transcript === null || f.transcript.length === 0) continue
    const alt = laeufe(woerter(f.transcript))
    let gemeinsam = 0
    for (const l of neu) if (alt.has(l)) gemeinsam += 1
    const anteil = gemeinsam / neu.size
    if (anteil >= schwelle && (bester === null || anteil > bester.anteil))
      bester = { datum: f.broadcast_date, anteil }
  }
  return bester
}

/** „26.09.2026" — for the note on the dossier, which the desk shows as is. */
export function datumKurz(iso: string): string {
  const [j, m, t] = iso.slice(0, 10).split('-')
  return `${t}.${m}.${j}`
}

/** The note a repeated dossier carries; the desk finds it by its first word. */
export function wiederholungsHinweis(von: string, anteil: number): string {
  return `Wiederholung der Sendung vom ${datumKurz(von)} (${Math.round(anteil * 100)} Prozent gleicher Wortlaut) — nicht noch einmal aufbereitet und gesichtet.`
}
