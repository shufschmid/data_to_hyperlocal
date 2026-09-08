import { describe, expect, it } from 'vitest'
import { bildMasse, passtDurchsLimit, PLAN_MAX_KANTE } from './bilder'

// Synthetische Header, keine echten Scans: die Funktion liest nur Marker.
// Der Ernstfall ist vermessen — Binningen 0275/2026, Blatt 3: 8433 x 5076 px
// bei 2.6 MB, von der API mit 400 abgewiesen.

function jpeg(breite: number, hoehe: number, sof = 0xc0): Buffer {
  return Buffer.from([
    0xff,
    0xd8, // SOI
    0xff,
    0xe0,
    0x00,
    0x04,
    0x4a,
    0x46, // APP0 mit Laenge 4
    0xff,
    sof,
    0x00,
    0x11,
    0x08, // Frame-Header, Praezision 8
    hoehe >> 8,
    hoehe & 0xff,
    breite >> 8,
    breite & 0xff,
    0x03
  ])
}

function png(breite: number, hoehe: number): Buffer {
  const b = Buffer.alloc(24)
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
  b.writeUInt32BE(13, 8)
  b.write('IHDR', 12, 'latin1')
  b.writeUInt32BE(breite, 16)
  b.writeUInt32BE(hoehe, 20)
  return b
}

describe('bildMasse', () => {
  it('liest die Masse aus dem JPEG-Frame-Header', () => {
    expect(bildMasse(jpeg(8433, 5076))).toEqual({ breite: 8433, hoehe: 5076 })
  })

  // Scans kommen auch progressiv daher (SOF2).
  it('liest auch einen progressiven Frame-Header', () => {
    expect(bildMasse(jpeg(1736, 2455, 0xc2))).toEqual({
      breite: 1736,
      hoehe: 2455
    })
  })

  it('liest die Masse aus dem PNG-IHDR', () => {
    expect(bildMasse(png(4911, 3472))).toEqual({ breite: 4911, hoehe: 3472 })
  })

  it('antwortet null statt zu raten', () => {
    expect(bildMasse(Buffer.from('kein bild'))).toBeNull()
    expect(
      bildMasse(
        Buffer.from([0xff, 0xd8, 0xff, 0xda, 0x00, 0x02, 0, 0, 0, 0, 0, 0])
      )
    ).toBeNull()
  })
})

describe('passtDurchsLimit', () => {
  it('laesst durch, was die API annimmt', () => {
    expect(passtDurchsLimit(jpeg(PLAN_MAX_KANTE, 5076))).toBe(true)
  })

  it('haelt zurueck, was breiter oder hoeher als 8000 Pixel ist', () => {
    expect(passtDurchsLimit(jpeg(8433, 5076))).toBe(false)
    expect(passtDurchsLimit(png(3000, 9000))).toBe(false)
  })

  // Ein unlesbarer Header ist viel eher ein harmloses Format als ein
  // Riesenscan — im Zweifel mitschicken, dann scheitert es genau so laut wie
  // vorher und kostet kein normales Blatt.
  it('laesst durch, was es nicht vermessen kann', () => {
    expect(passtDurchsLimit(Buffer.from('kein bild'))).toBe(true)
  })
})
