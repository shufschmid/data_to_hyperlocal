import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { Line } from '../shared/pdf-text'
import { buildPunkt6Segment, parsePunkt6Dossier } from './pdf-parser'

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '__fixtures__')

async function loadFixture(name: string): Promise<Buffer> {
  return readFile(join(FIXTURES, name))
}

function line(text: string): Line {
  return { y: 0, x0: 0, fontSize: 10, text }
}

describe('buildPunkt6Segment', () => {
  it('extracts the headline, ISO broadcast date and timestamped paragraphs', () => {
    const segment = buildPunkt6Segment([
      line('punkt6'),
      line('punkt6 vom 25.08.2026'),
      line(
        'Die umfassende live moderierte News-Sendung mit den topaktuellen Themen.'
      ),
      line('00:00:14 Das ist Punkt6, das Nachrichtenmagazin von Telebasel.'),
      line('00:00:49 Diesen Samstag soll in Basel eine Demo stattfinden.')
    ])

    expect(segment.broadcastDate).toBe('2026-08-25')
    expect(segment.headline).toBe('punkt6 vom 25.08.2026')
    expect(segment.paragraphs).toEqual([
      {
        timestamp: '00:00:14',
        seconds: 14,
        text: 'Das ist Punkt6, das Nachrichtenmagazin von Telebasel.'
      },
      {
        timestamp: '00:00:49',
        seconds: 49,
        text: 'Diesen Samstag soll in Basel eine Demo stattfinden.'
      }
    ])
  })

  it('appends a continuation line to the previous paragraph without an extra space', () => {
    const segment = buildPunkt6Segment([
      line('punkt6 vom 25.08.2026'),
      line('00:00:14 Ein Satz, der über zwei'),
      line('Zeilen geht und erst hier endet.')
    ])

    expect(segment.paragraphs).toHaveLength(1)
    expect(segment.paragraphs[0]!.text).toBe(
      'Ein Satz, der über zwei Zeilen geht und erst hier endet.'
    )
  })

  it('reinserts a space lost between a lowercase and an uppercase run', () => {
    const segment = buildPunkt6Segment([
      line('punkt6 vom 25.08.2026'),
      line('00:11:45 InhaberinGerdaMaise. Es handelt sich um einen Off-Space.')
    ])

    expect(segment.paragraphs[0]!.text).toBe(
      'Inhaberin Gerda Maise. Es handelt sich um einen Off-Space.'
    )
  })

  it('throws when the PDF has no timestamped transcript at all', () => {
    expect(() =>
      buildPunkt6Segment([
        line('punkt6 vom 25.08.2026'),
        line('kein Transkript hier')
      ])
    ).toThrow(/no timestamped transcript/)
  })

  it('throws when the PDF has no "punkt6 vom DD.MM.YYYY" headline', () => {
    expect(() =>
      buildPunkt6Segment([line('punkt6'), line('00:00:14 Los geht es.')])
    ).toThrow(/no "punkt6 vom/)
  })
})

// Real Punkt6 dossier PDF (a full episode, provided by the editor). Unlike a
// Regionaljournal dossier, this exercises pdfjs-dist itself, not just the pure
// buildPunkt6Segment orchestration above.
describe('parsePunkt6Dossier', () => {
  it('parses the real TEBV_2026-08-25.pdf end to end', async () => {
    const segment = await parsePunkt6Dossier(
      await loadFixture('TEBV_2026-08-25.pdf')
    )

    expect(segment.broadcastDate).toBe('2026-08-25')
    expect(segment.headline).toBe('punkt6 vom 25.08.2026')
    // One paragraph per PDF line, not per spoken sentence - this PDF's own SMD
    // transcription puts a fresh HH:MM:SS on nearly every line (unlike a
    // Regionaljournal dossier's longer, less frequently timestamped paragraphs).
    expect(segment.paragraphs.length).toBeGreaterThan(200)
  })

  it('extracts real, correctly spaced German text - pdfjs-dist does not garble this PDF', async () => {
    const segment = await parsePunkt6Dossier(
      await loadFixture('TEBV_2026-08-25.pdf')
    )
    const demo = segment.paragraphs.find((p) => p.timestamp === '00:00:49')
    expect(demo?.text).toBe(
      'Diesen Samstag soll in Basel eine nationale Pro-Palästina-Demo unter'
    )

    const offSpace = segment.paragraphs.find((p) => p.timestamp === '00:11:45')
    expect(offSpace?.text).toBe(
      'Inhaberin Gerda Maise. Es handelt sich um einen sogenannten Off-Space.'
    )
  })

  it('does not leak a bare trailing timestamp into the last paragraph', async () => {
    const segment = await parsePunkt6Dossier(
      await loadFixture('TEBV_2026-08-25.pdf')
    )
    const last = segment.paragraphs.at(-1)!
    expect(last.text).not.toMatch(/\d{2}:\d{2}:\d{2}\s*$/)
  })

  it('does not leak the page-footer text or page number into transcript paragraphs', async () => {
    const segment = await parsePunkt6Dossier(
      await loadFixture('TEBV_2026-08-25.pdf')
    )
    for (const paragraph of segment.paragraphs) {
      expect(paragraph.text).not.toContain('Dossier - Bello Bajour')
      expect(paragraph.text).not.toMatch(/\s\d$/) // a trailing lone page number
    }
  })
})
