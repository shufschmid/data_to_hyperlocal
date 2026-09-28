import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parsePunkt6Dossier } from './pdf-parser'
import {
  datumKurz,
  wiederholungsHinweis,
  wiederholungVon
} from './wiederholung'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__')

describe('wiederholungVon — dieselbe Sendung unter neuem Datum', async () => {
  const echt = (
    await parsePunkt6Dossier(
      await readFile(join(FIXTURES, 'TEBV_2026-08-25.pdf'))
    )
  ).paragraphs

  it('erkennt denselben Wortlaut mit anderen Zeilenumbruechen', () => {
    const umgebrochen = echt.flatMap((p) =>
      p.text.split(/(?<=\.) /).map((t) => ({ text: t }))
    )
    const treffer = wiederholungVon(umgebrochen, [
      { broadcast_date: '2026-08-25', transcript: echt }
    ])
    expect(treffer?.datum).toBe('2026-08-25')
    expect(treffer!.anteil).toBeGreaterThan(0.95)
  })

  it('haelt eine andere Sendung mit denselben Woertern nicht fuer eine Wiederholung', () => {
    // Dieselben Woerter in anderer Reihenfolge: gemeinsame Begruessung, nicht gemeinsame Passagen.
    const woerter = echt.flatMap((p) => p.text.split(' '))
    const gemischt = woerter
      .map((_, i) => woerter[(i * 7919) % woerter.length]!)
      .join(' ')
    expect(
      wiederholungVon(
        [{ text: gemischt }],
        [{ broadcast_date: '2026-08-25', transcript: echt }]
      )
    ).toBeNull()
  })

  it('nimmt die Sendung mit dem meisten gemeinsamen Wortlaut', () => {
    const halb = echt.slice(0, Math.floor(echt.length / 2))
    const treffer = wiederholungVon(echt, [
      { broadcast_date: '2026-08-24', transcript: halb },
      { broadcast_date: '2026-08-25', transcript: echt }
    ])
    expect(treffer?.datum).toBe('2026-08-25')
  })

  it('urteilt nicht ueber ein zu kurzes Transkript und nicht ohne fruehere', () => {
    expect(
      wiederholungVon(
        [{ text: 'Guten Abend und willkommen bei punkt6.' }],
        [{ broadcast_date: '2026-08-25', transcript: echt }]
      )
    ).toBeNull()
    expect(
      wiederholungVon(echt, [
        { broadcast_date: '2026-08-24', transcript: null }
      ])
    ).toBeNull()
  })

  it('schreibt den Hinweis, den der Tisch zeigt', () => {
    expect(datumKurz('2026-09-26')).toBe('26.09.2026')
    expect(wiederholungsHinweis('2026-09-26', 0.97)).toBe(
      'Wiederholung der Sendung vom 26.09.2026 (97 Prozent gleicher Wortlaut) — nicht noch einmal aufbereitet und gesichtet.'
    )
  })
})
