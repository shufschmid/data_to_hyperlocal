import { describe, expect, it, vi } from 'vitest'
import {
  abfrageUrl,
  BuschtelefonFehler,
  FORMAT,
  holeAlle,
  holeSeite,
  liesAntwort,
  liesZugang,
  pruefeFund,
  seitFuer,
  type FetchLike,
  type Zugang
} from './client'

// Invented data throughout: no real group, no real post, no real person.

const ZUGANG: Zugang = {
  url: 'https://buschtelefon.example.test',
  cfClientId: 'id-geheim.access',
  cfClientSecret: 'cf-geheim',
  schluessel: 'bearer-geheim'
}

function fund(
  kennung: string,
  erfasst: string,
  ueber: Record<string, unknown> = {}
) {
  return {
    kennung,
    kanal: 'facebook',
    gemeinde_slug: 'aesch',
    kanton: 'BL',
    quelle_name: 'Facebook-Gruppe Musterdorf',
    quelle_art: 'gruppe',
    link: `https://www.facebook.com/groups/1/posts/${kennung.slice(3)}/`,
    veroeffentlicht_am: '2026-11-08T00:00:00+01:00',
    datum_genauigkeit: 'tag',
    erfasst_am: erfasst,
    titel: 'Flohmarkt beim Gemeindehaus',
    text: 'Am Samstag gibt es einen Flohmarkt.',
    zusammenfassung: null,
    artikel_text: null,
    kommentare: [{ text: 'Ich komme gerne.', autor_art: 'unbekannt' }],
    n_kommentare: 1,
    n_reaktionen: null,
    n_geteilt: null,
    doublette_von: null,
    bildtext: null,
    pruefsumme: 'abc',
    ...ueber
  }
}

function antwort(
  funde: unknown[],
  weiter: string | null = null,
  ueber: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    format: FORMAT,
    stand: '2026-11-09T15:00:00+01:00',
    funde,
    weiter,
    ohne_link: 0,
    ...ueber
  })
}

function antwortOb(
  status: number,
  koerper: string,
  inhaltsart = 'application/json'
): ReturnType<FetchLike> {
  return Promise.resolve({
    status,
    headers: {
      get: (n: string) =>
        n.toLowerCase() === 'content-type' ? inhaltsart : null
    },
    text: async () => koerper
  })
}

describe('liesZugang', () => {
  it('meldet fehlende Variablen beim Namen, ohne zu werfen', () => {
    const r = liesZugang({ BUSCHTELEFON_CF_CLIENT_ID: 'x' })
    expect(r).toEqual({
      ok: false,
      fehlend: ['BUSCHTELEFON_CF_CLIENT_SECRET', 'BUSCHTELEFON_SCHLUESSEL']
    })
  })

  it('behandelt leere und blanke Werte wie fehlende', () => {
    const r = liesZugang({
      BUSCHTELEFON_CF_CLIENT_ID: 'x',
      BUSCHTELEFON_CF_CLIENT_SECRET: '  ',
      BUSCHTELEFON_SCHLUESSEL: ''
    })
    expect(r.ok).toBe(false)
  })

  it('hat einen Vorgabewert für die Adresse und schneidet den Schrägstrich ab', () => {
    const basis = {
      BUSCHTELEFON_CF_CLIENT_ID: 'a',
      BUSCHTELEFON_CF_CLIENT_SECRET: 'b',
      BUSCHTELEFON_SCHLUESSEL: 'c'
    }
    const r = liesZugang(basis)
    expect(r.ok && r.zugang.url).toBe(
      'https://buschtelefon.raumschiffenterprise.ch'
    )
    const s = liesZugang({
      ...basis,
      BUSCHTELEFON_URL: 'https://x.example.test/'
    })
    expect(s.ok && s.zugang.url).toBe('https://x.example.test')
  })

  it('verlangt eine https-Adresse ohne Pfad', () => {
    const basis = {
      BUSCHTELEFON_CF_CLIENT_ID: 'a',
      BUSCHTELEFON_CF_CLIENT_SECRET: 'b',
      BUSCHTELEFON_SCHLUESSEL: 'c'
    }
    expect(
      liesZugang({ ...basis, BUSCHTELEFON_URL: 'http://x.example.test' }).ok
    ).toBe(false)
    expect(
      liesZugang({ ...basis, BUSCHTELEFON_URL: 'https://x.example.test/api' })
        .ok
    ).toBe(false)
  })
})

describe('abfrageUrl und seitFuer', () => {
  it('kodiert das Plus der Zeitzone als %2B', () => {
    const url = abfrageUrl(ZUGANG, {
      seit: '2026-11-09T13:40:00+01:00',
      limit: 50
    })
    expect(url).toBe(
      'https://buschtelefon.example.test/api/redaktion/v1/funde?seit=2026-11-09T13%3A40%3A00%2B01%3A00&limit=50'
    )
  })

  it('lässt seit weg und begrenzt das limit auf 1 bis 1000', () => {
    expect(abfrageUrl(ZUGANG, {})).toContain('?limit=200')
    expect(abfrageUrl(ZUGANG, { limit: 99999 })).toContain('limit=1000')
    expect(abfrageUrl(ZUGANG, { limit: 0 })).toContain('limit=1')
  })

  it('zieht seit um zwei Stunden vom letzten Stand zurück', () => {
    expect(seitFuer('2026-11-09T14:00:00+01:00')).toBe(
      '2026-11-09T11:00:00.000Z'
    )
    expect(seitFuer(null)).toBeNull()
    expect(seitFuer('kein Datum')).toBeNull()
  })
})

describe('pruefeFund', () => {
  it('übernimmt einen vollständigen Fund und normalisiert Leeres zu null', () => {
    const f = pruefeFund(
      fund('fb:1', '2026-11-09T12:00:00+01:00', { titel: '  ', kommentare: [] })
    )
    expect(f?.kennung).toBe('fb:1')
    expect(f?.titel).toBeNull()
    expect(f?.kommentare).toBeNull()
  })

  it.each([
    ['ohne Kennung', { kennung: '' }],
    ['mit unbekanntem Kanal', { kanal: 'whatsapp' }],
    ['ohne Link', { link: null }],
    ['mit einem Link ohne Schema', { link: 'facebook.com/x' }],
    ['ohne lesbare Erfassungszeit', { erfasst_am: 'gestern' }],
    ['ohne Text', { text: undefined }]
  ])('verwirft einen Fund %s', (_n, ueber) => {
    expect(
      pruefeFund(fund('fb:1', '2026-11-09T12:00:00+01:00', ueber))
    ).toBeNull()
  })

  it('verwirft Nicht-Objekte', () => {
    expect(pruefeFund(null)).toBeNull()
    expect(pruefeFund('x')).toBeNull()
  })
})

describe('liesAntwort', () => {
  it('erkennt die Anmeldeseite von Cloudflare als HTML unter 200', () => {
    expect(() =>
      liesAntwort(
        200,
        'text/html; charset=utf-8',
        '<!DOCTYPE html><html><title>Sign in</title>'
      )
    ).toThrowError(/Cloudflare Access/)
  })

  it('erkennt HTML auch ohne passenden Inhaltstyp', () => {
    expect(() =>
      liesAntwort(200, 'application/json', '  <html><body>Access</body></html>')
    ).toThrowError(/Cloudflare Access/)
  })

  it('erkennt die Umleitung auf die Anmeldeseite', () => {
    try {
      liesAntwort(302, null, '')
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(BuschtelefonFehler)
      expect((e as BuschtelefonFehler).art).toBe('cloudflare')
    }
  })

  it('unterscheidet 401 der Bridge (Schlüssel) von 403 (Cloudflare)', () => {
    try {
      liesAntwort(401, 'application/json', '{}')
      expect.unreachable()
    } catch (e) {
      expect((e as BuschtelefonFehler).art).toBe('schluessel')
    }
    try {
      liesAntwort(403, 'application/json', '{}')
      expect.unreachable()
    } catch (e) {
      expect((e as BuschtelefonFehler).art).toBe('cloudflare')
    }
  })

  it('nennt den Grund der Gegenseite bei 503 und 400', () => {
    expect(() =>
      liesAntwort(
        503,
        'application/json',
        '{"ok": false, "grund": "nicht eingerichtet"}'
      )
    ).toThrowError(/nicht eingerichtet/)
    expect(() =>
      liesAntwort(400, 'application/json', '{"grund": "seit ungültig"}')
    ).toThrowError(/seit ungültig/)
  })

  it('meldet andere Statuswerte und unlesbare Antworten als Fehler, nie als Syntaxfehler', () => {
    expect(() => liesAntwort(502, 'text/plain', 'bad gateway')).toThrowError(
      /HTTP 502/
    )
    expect(() =>
      liesAntwort(200, 'application/json', 'kein json')
    ).toThrowError(/kein JSON-Objekt/)
    expect(() =>
      liesAntwort(200, 'application/json', '{"format":"anders/9","funde":[]}')
    ).toThrowError(/Unbekanntes Format/)
    expect(() =>
      liesAntwort(200, 'application/json', `{"format":"${FORMAT}"}`)
    ).toThrowError(/keine Liste/)
  })

  it('zählt ungültige Funde, statt an ihnen zu scheitern', () => {
    const seite = liesAntwort(
      200,
      'application/json',
      antwort(
        [fund('fb:1', '2026-11-09T12:00:00+01:00'), { kennung: 'fb:2' }],
        null,
        { ohne_link: 3 }
      )
    )
    expect(seite.funde).toHaveLength(1)
    expect(seite.ungueltig).toBe(1)
    expect(seite.ohneLink).toBe(3)
  })
})

describe('holeSeite', () => {
  it('sendet die drei Kopfzeilen und folgt keiner Umleitung', async () => {
    const holen = vi.fn<FetchLike>(() => antwortOb(200, antwort([])))
    await holeSeite(ZUGANG, { seit: null }, holen)
    const [url, init] = holen.mock.calls[0]!
    expect(url).toContain('/api/redaktion/v1/funde')
    expect(init.headers['CF-Access-Client-Id']).toBe('id-geheim.access')
    expect(init.headers['CF-Access-Client-Secret']).toBe('cf-geheim')
    expect(init.headers['Authorization']).toBe('Bearer bearer-geheim')
    expect(init.redirect).toBe('manual')
  })

  it('macht aus einem Netzfehler einen BuschtelefonFehler, ohne Geheimnis in der Meldung', async () => {
    const holen: FetchLike = () =>
      Promise.reject(new TypeError('fetch failed https://x?k=bearer-geheim'))
    const e = await holeSeite(ZUGANG, {}, holen).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(BuschtelefonFehler)
    expect((e as BuschtelefonFehler).art).toBe('netz')
    expect((e as BuschtelefonFehler).message).not.toContain('bearer-geheim')
  })
})

describe('holeAlle', () => {
  it('folgt «weiter» mit seit=<weiter> und führt die Seiten zusammen', async () => {
    const urls: string[] = []
    const holen: FetchLike = (url) => {
      urls.push(url)
      return urls.length === 1
        ? antwortOb(
            200,
            antwort(
              [
                fund('fb:1', '2026-11-09T10:00:00+01:00'),
                fund('fb:2', '2026-11-09T11:00:00+01:00')
              ],
              '2026-11-09T11:00:00+01:00'
            )
          )
        : antwortOb(
            200,
            antwort([fund('fb:3', '2026-11-09T12:00:00+01:00')], null)
          )
    }
    const r = await holeAlle(
      ZUGANG,
      { seit: '2026-11-09T08:00:00.000Z', limit: 2 },
      holen
    )
    expect(r.seiten).toBe(2)
    expect(r.funde.map((f) => f.kennung)).toEqual(['fb:1', 'fb:2', 'fb:3'])
    expect(urls[0]).toContain('seit=2026-11-09T08%3A00%3A00.000Z')
    expect(urls[1]).toContain('seit=2026-11-09T11%3A00%3A00%2B01%3A00')
    expect(r.abbruch).toBeNull()
  })

  it('wirft einen Fund nur einmal ein, auch wenn zwei Seiten ihn bringen', async () => {
    let n = 0
    const holen: FetchLike = () =>
      antwortOb(
        200,
        n++ === 0
          ? antwort(
              [fund('fb:1', '2026-11-09T10:00:00+01:00')],
              '2026-11-09T10:00:00+01:00'
            )
          : antwort([fund('fb:1', '2026-11-09T10:00:00+01:00')], null)
      )
    const r = await holeAlle(ZUGANG, { seit: null }, holen)
    expect(r.funde).toHaveLength(1)
  })

  it('bricht eine nicht fortschreitende Fortsetzung ab und behält, was gelesen ist', async () => {
    const holen: FetchLike = () =>
      antwortOb(
        200,
        antwort(
          [fund('fb:1', '2026-11-09T10:00:00+01:00')],
          '2026-11-09T10:00:00+01:00'
        )
      )
    const r = await holeAlle(
      ZUGANG,
      { seit: '2026-11-09T10:00:00+01:00' },
      holen
    )
    expect(r.funde).toHaveLength(1)
    expect(r.abbruch?.message).toMatch(/zweimal/)
  })

  it('deckelt eine endlose Abholung und sagt es', async () => {
    let n = 0
    const holen: FetchLike = () => {
      n += 1
      const stempel = `2026-11-09T10:${String(n).padStart(2, '0')}:00+01:00`
      return antwortOb(200, antwort([fund(`fb:${n}`, stempel)], stempel))
    }
    const r = await holeAlle(ZUGANG, { seit: null }, holen, 3)
    expect(r.seiten).toBe(3)
    expect(r.abbruch?.message).toMatch(/Mehr als 3 Seiten/)
  })

  it('behält die Seiten vor einem Fehler auf einer späteren Seite', async () => {
    let n = 0
    const holen: FetchLike = () =>
      n++ === 0
        ? antwortOb(
            200,
            antwort(
              [fund('fb:1', '2026-11-09T10:00:00+01:00')],
              '2026-11-09T10:00:00+01:00'
            )
          )
        : antwortOb(502, 'bad gateway', 'text/plain')
    const r = await holeAlle(ZUGANG, { seit: null }, holen)
    expect(r.funde).toHaveLength(1)
    expect(r.abbruch).toBeInstanceOf(BuschtelefonFehler)
  })

  it('wirft, wenn schon die erste Seite scheitert (Cloudflare-Anmeldeseite)', async () => {
    const holen: FetchLike = () =>
      antwortOb(200, '<html>Sign in</html>', 'text/html')
    await expect(holeAlle(ZUGANG, { seit: null }, holen)).rejects.toMatchObject(
      { art: 'cloudflare' }
    )
  })
})
