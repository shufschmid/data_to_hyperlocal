import { describe, expect, it, vi } from 'vitest'
import { konfiguration, sucheVorgeschichte, ZettelkastenFehler } from './index'

// The network half, with a stubbed fetch. The shapes are pinned in
// parse.test.ts against a real answer; what is pinned here is the manners: the
// door is asked with a token, never without one, and it is never asked at all
// when nobody configured it.

const KONFIGURIERT = {
  url: 'https://zettelkasten-tuer.example.ch',
  token: 'geheim',
  mandant: 'bajour',
  kontakt: 'redaktion@example.ch'
}

function antwort(
  treffer: unknown[],
  extra: Record<string, unknown> = {}
): Response {
  return new Response(
    JSON.stringify({
      gesamt: treffer.length,
      weitere: false,
      vorbehalt: 'Belegt ist: diese Publikation ist amtlich erschienen.',
      treffer,
      ...extra
    }),
    { status: 200, headers: { 'content-type': 'application/json' } }
  )
}

function zeile(rubrik: string, nummer = '0000000001'): Record<string, unknown> {
  return {
    titel: `Eine Publikation ${nummer}`,
    publikationsnummer: `${rubrik}-${nummer}`,
    rubrik,
    datum: '2026-09-10',
    beleg: `rohablage/amtsblatt_bl/x.json :: ${rubrik}-${nummer}`,
    gemeinde_bfs: 2770,
    adresse: `https://amtsblattportal.ch/api/v1/publications/${nummer}/pdf`
  }
}

describe('konfiguration', () => {
  it('is off while nobody set a token', () => {
    expect(konfiguration({}).token).toBe('')
    expect(konfiguration({ ZETTELKASTEN_TOKEN: '   ' }).token).toBe('')
  })

  it('carries the door and the mandant as defaults', () => {
    const k = konfiguration({ ZETTELKASTEN_TOKEN: 'geheim' })

    expect(k.url).toBe('https://zettelkasten-tuer.raumschiffenterprise.ch')
    expect(k.mandant).toBe('bajour')
  })
})

describe('sucheVorgeschichte', () => {
  it('asks nothing while the Zettelkasten is not configured', async () => {
    const gefragt = vi.fn()
    const ergebnis = await sucheVorgeschichte(
      { suche: 'Hauptstrasse 12' },
      { ...KONFIGURIERT, token: '', fetchImpl: gefragt as never }
    )

    // Not an error: a newsroom that never switched the Zettelkasten on is a
    // newsroom without a Vorgeschichte, not a broken one.
    expect(ergebnis.status).toBe('nicht_konfiguriert')
    expect(gefragt).not.toHaveBeenCalled()
  })

  it('asks the door with the mandant in the path and the token in the header', async () => {
    const gefragt = vi.fn().mockResolvedValue(antwort([zeile('BP-BL05')]))

    await sucheVorgeschichte(
      {
        suche: 'Hauptstrasse 12',
        rubrik: 'BP-BL05',
        von: '2021-09-16',
        gemeindeBfs: 2770
      },
      { ...KONFIGURIERT, fetchImpl: gefragt as never }
    )

    const [url, init] = gefragt.mock.calls[0] as [string, RequestInit]
    const gefragteUrl = new URL(url)
    expect(gefragteUrl.pathname).toBe(
      '/api/v1/mandanten/bajour/publikation_suche'
    )
    expect(gefragteUrl.searchParams.get('suche')).toBe('Hauptstrasse 12')
    expect(gefragteUrl.searchParams.get('rubrik')).toBe('BP-BL05')
    expect(gefragteUrl.searchParams.get('von')).toBe('2021-09-16')
    expect(gefragteUrl.searchParams.get('gemeinde_bfs')).toBe('2770')
    // The door passes format=json itself and refuses parameters it does not
    // know, so sending one would turn every search into a 400.
    expect(gefragteUrl.searchParams.get('format')).toBeNull()

    const headers = new Headers(init.headers)
    expect(headers.get('Authorization')).toBe('Bearer geheim')
    expect(headers.get('User-Agent')).toContain('DieRedaktion')
  })

  it('never hands a private matter to the desk', async () => {
    const gefragt = vi
      .fn()
      .mockResolvedValue(
        antwort([zeile('BP-BL05', '0000000002'), zeile('KK01', '0000000003')])
      )

    const ergebnis = await sucheVorgeschichte(
      { suche: 'Musterbau AG' },
      { ...KONFIGURIERT, fetchImpl: gefragt as never }
    )

    expect(ergebnis.status).toBe('ok')
    if (ergebnis.status !== 'ok') return
    expect(ergebnis.treffer.map((t) => t.rubrik)).toEqual(['BP-BL05'])
    // The count stays the door's own: saying "2 found, 1 shown" is honest,
    // and quietly counting 1 would hide that the filter did something.
    expect(ergebnis.gesamt).toBe(2)
  })

  it('says when the door has more than it returned', async () => {
    const gefragt = vi
      .fn()
      .mockResolvedValue(
        antwort([zeile('BP-BL05')], { weitere: true, gesamt: 41 })
      )

    const ergebnis = await sucheVorgeschichte(
      { suche: 'Hauptstrasse' },
      { ...KONFIGURIERT, fetchImpl: gefragt as never }
    )

    expect(ergebnis.status).toBe('ok')
    if (ergebnis.status !== 'ok') return
    expect(ergebnis.abgeschnitten).toBe(true)
    expect(ergebnis.gesamt).toBe(41)
  })

  it('reads one page and only one', async () => {
    const gefragt = vi.fn().mockResolvedValue(antwort([zeile('BP-BL05')]))

    await sucheVorgeschichte(
      { suche: 'Hauptstrasse' },
      { ...KONFIGURIERT, fetchImpl: gefragt as never }
    )

    // An editor is waiting for this answer. Paging through a five-year history
    // would trade their attention for rows nobody asked for; `abgeschnitten`
    // says so instead.
    expect(gefragt).toHaveBeenCalledTimes(1)
  })

  it('names the token when the door refuses it', async () => {
    const gefragt = vi
      .fn()
      .mockResolvedValue(new Response('{"fehler":{}}', { status: 401 }))

    await expect(
      sucheVorgeschichte(
        { suche: 'Hauptstrasse' },
        { ...KONFIGURIERT, fetchImpl: gefragt as never }
      )
    ).rejects.toThrow(/Token/)
  })

  it('turns an unreachable door into a ZettelkastenFehler', async () => {
    const gefragt = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'))

    await expect(
      sucheVorgeschichte(
        { suche: 'Hauptstrasse' },
        { ...KONFIGURIERT, fetchImpl: gefragt as never }
      )
    ).rejects.toThrow(ZettelkastenFehler)
  })

  it('refuses a search that would ask for everything', async () => {
    const gefragt = vi.fn()

    await expect(
      sucheVorgeschichte(
        { rubrik: 'BP-BL05' },
        { ...KONFIGURIERT, fetchImpl: gefragt as never }
      )
    ).rejects.toThrow(ZettelkastenFehler)
    expect(gefragt).not.toHaveBeenCalled()
  })
})
