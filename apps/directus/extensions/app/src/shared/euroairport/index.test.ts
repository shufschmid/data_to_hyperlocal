import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  EuroairportFehler,
  ILS33_UEBERSICHT,
  liesMonatsblatt,
  liesUebersicht
} from './index'

const fixture = (name: string): Buffer =>
  readFileSync(join(__dirname, 'fixtures', name))

const KONTAKT = 'it@bajour.ch'

function antwortet(
  koerper: Buffer | string,
  status = 200
): {
  fetchImpl: typeof fetch
  rufe: Array<{ url: string; init?: RequestInit }>
} {
  const rufe: Array<{ url: string; init?: RequestInit }> = []
  const fetchImpl = (async (eingabe: unknown, init?: RequestInit) => {
    rufe.push({ url: String(eingabe), ...(init === undefined ? {} : { init }) })
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () =>
        typeof koerper === 'string' ? koerper : koerper.toString('utf8'),
      arrayBuffer: async () =>
        typeof koerper === 'string'
          ? new TextEncoder().encode(koerper).buffer
          : koerper.buffer.slice(
              koerper.byteOffset,
              koerper.byteOffset + koerper.byteLength
            )
    } as unknown as Response
  }) as unknown as typeof fetch
  return { fetchImpl, rufe }
}

describe('liesUebersicht', () => {
  it('liest die Uebersichtsseite und nennt uns dabei beim Namen', async () => {
    const { fetchImpl, rufe } = antwortet(fixture('uebersicht.html'))

    const ausgaben = await liesUebersicht(ILS33_UEBERSICHT, {
      kontakt: KONTAKT,
      fetchImpl
    })

    expect(ausgaben.length).toBe(51)
    expect(rufe.length).toBe(1)
    expect(rufe[0]?.url).toBe(ILS33_UEBERSICHT)

    const kopf = rufe[0]?.init?.headers as Record<string, string>
    expect(kopf['User-Agent']).toContain('DieRedaktion')
    expect(kopf['User-Agent']).toContain(KONTAKT)
    // Never a browser's User-Agent — a refusal here would be an answer, not a
    // problem to route around.
    expect(kopf['User-Agent']).not.toContain('Mozilla')
    expect(kopf['Accept']).toContain('text/html')
  })

  it('meldet eine Absage der Quelle mit Adresse und Status', async () => {
    const { fetchImpl } = antwortet('', 503)

    await expect(
      liesUebersicht(ILS33_UEBERSICHT, { kontakt: KONTAKT, fetchImpl })
    ).rejects.toThrow(/503/)
  })

  it('liest nur euroairport.com, welche Adresse auch immer in der Zeile steht', async () => {
    const { fetchImpl, rufe } = antwortet(fixture('uebersicht.html'))

    await expect(
      liesUebersicht('https://example.com/ils-33', {
        kontakt: KONTAKT,
        fetchImpl
      })
    ).rejects.toBeInstanceOf(EuroairportFehler)
    expect(rufe.length).toBe(0)
  })
})

describe('liesMonatsblatt', () => {
  const URL_AUGUST =
    'https://www.euroairport.com/sites/default/files/medias/file/2026/09/Utilisation_ILS33_pour_2026_WEBv0_08.pdf'

  it('liest die Textschicht des echten August-Blatts', async () => {
    const { fetchImpl } = antwortet(fixture('2026-08.pdf'))

    const { blatt, text } = await liesMonatsblatt(URL_AUGUST, {
      kontakt: KONTAKT,
      fetchImpl,
      erwartet: { jahr: 2026, monat: 8 }
    })

    // The whole PDF path, without a network and without a Docker build: the
    // text layer this module reads is byte-identical to the saved fixture.
    expect(text).toBe(fixture('2026-08.txt').toString('utf8'))
    expect(blatt.jahr).toBe(2026)
    expect(blatt.monat).toBe(8)
    expect(blatt.anfluege).toBe(3675)
    expect(blatt.suedlandungen).toBe(973)
    expect(blatt.quote).toBe(26.5)
    expect(blatt.aktualisiert_am).toBe('2026-09-03')
    expect(blatt.tage.length).toBe(31)
    // The one day the source contradicts itself on.
    expect(blatt.befunde.length).toBe(1)
  })

  it('bildet eine stabile Pruefsumme ueber die Textschicht', async () => {
    const erst = await liesMonatsblatt(URL_AUGUST, {
      kontakt: KONTAKT,
      fetchImpl: antwortet(fixture('2026-08.pdf')).fetchImpl
    })
    const zweit = await liesMonatsblatt(URL_AUGUST, {
      kontakt: KONTAKT,
      fetchImpl: antwortet(fixture('2026-08.pdf')).fetchImpl
    })

    expect(erst.pruefsumme).toMatch(/^[0-9a-f]{64}$/)
    expect(erst.pruefsumme).toBe(zweit.pruefsumme)
  })

  it('holt kein PDF von einem fremden Host', async () => {
    const { fetchImpl, rufe } = antwortet(fixture('2026-08.pdf'))

    await expect(
      liesMonatsblatt('https://example.com/blatt.pdf', {
        kontakt: KONTAKT,
        fetchImpl
      })
    ).rejects.toBeInstanceOf(EuroairportFehler)
    expect(rufe.length).toBe(0)
  })
})
