import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  begrenzeLimit,
  BuschtelefonFehler,
  fundeUrl,
  holeFunde,
  holeFundeSeite,
  holeQuellen,
  istTueradresse,
  klassifiziere,
  liesZugang,
  quellenUrl,
  type FehlerArt,
  type FetchLike,
  type Tuerzugang
} from './client'
import { FORMAT } from './typen'

// Invented data throughout: no real group, no real post, no real person.

const ZUGANG: Tuerzugang = {
  url: 'https://buschtelefon.example.test',
  cfClientId: 'id-geheim.access',
  cfClientSecret: 'cf-geheim',
  schluessel: 'bearer-geheim'
}
const GEHEIMNISSE = [
  ZUGANG.cfClientId,
  ZUGANG.cfClientSecret,
  ZUGANG.schluessel
]

function fixture(name: string): Record<string, unknown> {
  return JSON.parse(readFileSync(join(__dirname, 'fixtures', name), 'utf8'))
}

const FREIGABE = fixture('funde.json')['freigabe']
const VORLAGE = (
  fixture('funde.json')['funde'] as Record<string, unknown>[]
)[1]!

function fund(
  nr: number,
  folge: number,
  ueber: Record<string, unknown> = {}
): Record<string, unknown> {
  return { ...VORLAGE, kennung: `fb:1_${nr}`, folge, ...ueber }
}

function seite(
  funde: unknown[],
  weiter: number | null = null,
  ueber: Record<string, unknown> = {}
): string {
  return JSON.stringify({
    format: FORMAT,
    freigabe: FREIGABE,
    funde,
    ausgelassen: [],
    weiter,
    ...ueber
  })
}

function antwort(
  status: number,
  koerper: string,
  kopf: Record<string, string> = { 'content-type': 'application/json' }
): ReturnType<FetchLike> {
  return Promise.resolve({
    status,
    headers: { get: (name: string) => kopf[name.toLowerCase()] ?? null },
    text: async () => koerper
  })
}

/** A door that answers the pages in order and records what was asked. */
function tuer(...antworten: (() => ReturnType<FetchLike>)[]) {
  const aufrufe: { url: string; init: Parameters<FetchLike>[1] }[] = []
  const holen: FetchLike = (url, init) => {
    aufrufe.push({ url, init })
    const naechste = antworten[aufrufe.length - 1]
    if (naechste === undefined) throw new Error('unerwarteter Abruf')
    return naechste()
  }
  return { holen, aufrufe }
}

async function fehlerVon(
  versuch: () => Promise<unknown> | unknown
): Promise<BuschtelefonFehler> {
  try {
    await versuch()
  } catch (fehler) {
    if (fehler instanceof BuschtelefonFehler) return fehler
    throw fehler
  }
  throw new Error('kein Fehler geworfen')
}

describe('liesZugang', () => {
  const basis = {
    BUSCHTELEFON_CF_CLIENT_ID: 'a',
    BUSCHTELEFON_CF_CLIENT_SECRET: 'b',
    BUSCHTELEFON_SCHLUESSEL: 'c'
  }

  it('meldet fehlende Variablen beim Namen, ohne zu werfen', () => {
    expect(liesZugang({ BUSCHTELEFON_CF_CLIENT_ID: 'x' })).toEqual({
      ok: false,
      fehlend: ['BUSCHTELEFON_CF_CLIENT_SECRET', 'BUSCHTELEFON_SCHLUESSEL']
    })
    expect(liesZugang({})).toEqual({
      ok: false,
      fehlend: [
        'BUSCHTELEFON_CF_CLIENT_ID',
        'BUSCHTELEFON_CF_CLIENT_SECRET',
        'BUSCHTELEFON_SCHLUESSEL'
      ]
    })
  })

  it('behandelt leere und blanke Werte wie fehlende', () => {
    expect(
      liesZugang({
        ...basis,
        BUSCHTELEFON_CF_CLIENT_SECRET: '  ',
        BUSCHTELEFON_SCHLUESSEL: ''
      })
    ).toEqual({
      ok: false,
      fehlend: ['BUSCHTELEFON_CF_CLIENT_SECRET', 'BUSCHTELEFON_SCHLUESSEL']
    })
  })

  it('hat einen Vorgabewert für die Adresse und schneidet den Schrägstrich ab', () => {
    expect(liesZugang(basis)).toEqual({
      ok: true,
      zugang: {
        url: 'https://buschtelefon.raumschiffenterprise.ch',
        cfClientId: 'a',
        cfClientSecret: 'b',
        schluessel: 'c'
      }
    })
    const mit = liesZugang({
      ...basis,
      BUSCHTELEFON_URL: ' https://x.example.test/ '
    })
    expect(mit.ok && mit.zugang.url).toBe('https://x.example.test')
  })

  it('verweigert jede Adresse, die nicht https://host ohne Pfad ist', () => {
    for (const url of [
      'http://x.example.test',
      'https://x.example.test/api',
      'https://x.example.test?a=1',
      'https://nutzer:pw@x.example.test',
      'x.example.test',
      'https://'
    ])
      expect(liesZugang({ ...basis, BUSCHTELEFON_URL: url })).toEqual({
        ok: false,
        fehlend: ['BUSCHTELEFON_URL (https-Adresse ohne Pfad)']
      })
    expect(istTueradresse('https://x.example.test:8443')).toBe(true)
  })
})

describe('die Adressen', () => {
  it('baut die Abfrage mit Lesezeichen und begrenztem Limit', () => {
    expect(fundeUrl(ZUGANG)).toBe(
      'https://buschtelefon.example.test/api/redaktion/v2/funde?limit=200'
    )
    expect(fundeUrl(ZUGANG, { nach: null })).toBe(
      'https://buschtelefon.example.test/api/redaktion/v2/funde?limit=200'
    )
    expect(fundeUrl(ZUGANG, { nach: 0, limit: 50 })).toBe(
      'https://buschtelefon.example.test/api/redaktion/v2/funde?nach=0&limit=50'
    )
    expect(fundeUrl(ZUGANG, { nach: 17650, limit: 9999 })).toBe(
      'https://buschtelefon.example.test/api/redaktion/v2/funde?nach=17650&limit=500'
    )
    expect(quellenUrl(ZUGANG)).toBe(
      'https://buschtelefon.example.test/api/redaktion/v2/quellen'
    )
  })

  it('begrenzt das Limit auf 1 bis 500', () => {
    expect(begrenzeLimit(undefined)).toBe(200)
    expect(begrenzeLimit(0)).toBe(1)
    expect(begrenzeLimit(12.9)).toBe(12)
    expect(begrenzeLimit(501)).toBe(500)
    expect(begrenzeLimit(Number.NaN)).toBe(200)
  })

  it('verweigert ein Lesezeichen, das keine ganze Zahl ist', async () => {
    expect((await fehlerVon(() => fundeUrl(ZUGANG, { nach: -1 }))).art).toBe(
      'anfrage'
    )
    expect((await fehlerVon(() => fundeUrl(ZUGANG, { nach: 1.5 }))).art).toBe(
      'anfrage'
    )
  })
})

describe('klassifiziere', () => {
  const art = async (
    status: number,
    koerper: string,
    inhaltsart: string | null = 'application/json'
  ): Promise<FehlerArt> =>
    (await fehlerVon(() => klassifiziere(status, inhaltsart, koerper))).art

  it('gibt das JSON einer 200 zurück', () => {
    expect(klassifiziere(200, 'application/json', '{"format":"x"}')).toEqual({
      format: 'x'
    })
  })

  it('erkennt Cloudflare an Umleitung und HTML – vor jedem JSON.parse', async () => {
    expect(await art(302, '')).toBe('cloudflare')
    expect(
      await art(
        200,
        '<!DOCTYPE html><html><title>Sign in</title></html>',
        'text/html; charset=utf-8'
      )
    ).toBe('cloudflare')
    expect(
      await art(200, '\n <html><body>Cloudflare Access</body></html>', null)
    ).toBe('cloudflare')
    expect(await art(401, '<html></html>', 'text/html')).toBe('cloudflare')
    expect(await art(403, '{"fehler":"x"}')).toBe('cloudflare')
  })

  it('liest HTML unter 5xx als Fehlerseite des Servers, nicht als Anmeldeseite', async () => {
    const seite = '<!DOCTYPE html><html><title>Bad gateway</title></html>'
    for (const status of [500, 502, 521, 522, 530]) {
      const fehler = await fehlerVon(() =>
        klassifiziere(status, 'text/html; charset=UTF-8', seite)
      )
      expect(fehler.art, String(status)).toBe('server')
      expect(fehler.message).toBe(
        `Das Buschtelefon ist nicht erreichbar (HTTP ${status}, Fehlerseite statt JSON).`
      )
      expect(fehler.message).not.toContain('Service-Token')
    }
    // During a deploy: the same quiet «not ready» as the door's own 503.
    expect(await art(503, seite, 'text/html')).toBe('nicht_bereit')
    expect(await art(502, seite, null)).toBe('server')
  })

  it('unterscheidet die Fehler der Tür', async () => {
    expect(
      await art(401, `{"format":"${FORMAT}","fehler":"nicht_berechtigt"}`)
    ).toBe('schluessel')
    expect(
      await art(
        400,
        `{"format":"${FORMAT}","fehler":"ungueltige_eingabe","grund":"limit"}`
      )
    ).toBe('anfrage')
    expect(
      await art(
        503,
        `{"format":"${FORMAT}","fehler":"nicht_bereit","grund":"nicht_eingerichtet"}`
      )
    ).toBe('nicht_bereit')
    expect(
      await art(
        503,
        `{"format":"${FORMAT}","fehler":"nicht_bereit","grund":"freigabe_laeuft"}`
      )
    ).toBe('freigabe_laeuft')
    expect(await art(503, 'Service Unavailable', 'text/plain')).toBe(
      'nicht_bereit'
    )
    expect(await art(500, '{}')).toBe('server')
    expect(await art(502, 'Bad Gateway', 'text/plain')).toBe('server')
    expect(await art(200, 'kein json', 'text/plain')).toBe('format')
  })

  it('trägt bei 410 das verworfen_bis und bei laufender Freigabe das Retry-After', async () => {
    const zuAlt = await fehlerVon(() =>
      klassifiziere(
        410,
        'application/json',
        `{"format":"${FORMAT}","fehler":"stand_zu_alt","verworfen_bis":16000}`
      )
    )
    expect(zuAlt.art).toBe('stand_zu_alt')
    expect(zuAlt.verworfenBis).toBe(16000)
    expect(zuAlt.message).toContain('16000')
    expect(
      (await fehlerVon(() => klassifiziere(410, 'application/json', '{}')))
        .verworfenBis
    ).toBeNull()

    const laeuft = await fehlerVon(() =>
      klassifiziere(
        503,
        'application/json',
        '{"fehler":"nicht_bereit","grund":"freigabe_laeuft"}',
        '120'
      )
    )
    expect(laeuft.wiederholenNach).toBe(120)
    expect(
      (
        await fehlerVon(() =>
          klassifiziere(
            503,
            'application/json',
            '{"grund":"freigabe_laeuft"}',
            'bald'
          )
        )
      ).wiederholenNach
    ).toBeNull()
  })

  it('zitiert nie den Körper einer Fehlerantwort', async () => {
    const fehler = await fehlerVon(() =>
      klassifiziere(
        400,
        'application/json',
        '{"fehler":"Sandra Beispielmann schrieb etwas","grund":"Text eines Beitrags mit 079 000 00 00"}'
      )
    )
    expect(fehler.message).toBe('Das Buschtelefon weist die Anfrage ab (400).')
    const server = await fehlerVon(() =>
      klassifiziere(500, 'text/plain', 'Beitragstext im Fehler')
    )
    expect(server.message).not.toContain('Beitragstext')
  })
})

describe('holeFundeSeite', () => {
  it('schickt alle drei Zugangsangaben, folgt keiner Umleitung und setzt eine Zeitgrenze', async () => {
    const { holen, aufrufe } = tuer(() => antwort(200, seite([fund(1, 10)])))
    const ergebnis = await holeFundeSeite(ZUGANG, { nach: 5, limit: 50 }, holen)
    expect(ergebnis.funde.map((f) => f.kennung)).toEqual(['fb:1_1'])
    expect(aufrufe).toHaveLength(1)
    expect(aufrufe[0]!.url).toBe(
      'https://buschtelefon.example.test/api/redaktion/v2/funde?nach=5&limit=50'
    )
    expect(aufrufe[0]!.init.method).toBe('GET')
    expect(aufrufe[0]!.init.redirect).toBe('manual')
    expect(aufrufe[0]!.init.signal).toBeInstanceOf(AbortSignal)
    expect(aufrufe[0]!.init.headers).toEqual({
      Accept: 'application/json',
      'CF-Access-Client-Id': 'id-geheim.access',
      'CF-Access-Client-Secret': 'cf-geheim',
      Authorization: 'Bearer bearer-geheim'
    })
  })

  it('macht aus einem Netzfehler «netz» – ohne ein Geheimnis in der Meldung', async () => {
    const boese = new Error(
      `connect failed for Bearer ${ZUGANG.schluessel} / ${ZUGANG.cfClientSecret}`
    )
    const fehler = await fehlerVon(() =>
      holeFundeSeite(ZUGANG, {}, () => Promise.reject(boese))
    )
    expect(fehler.art).toBe('netz')
    expect(fehler.message).toBe(
      'Das Buschtelefon ist nicht erreichbar (Error).'
    )
    for (const geheim of GEHEIMNISSE)
      expect(fehler.message).not.toContain(geheim)
  })

  it('nennt eine Zeitüberschreitung beim Namen', async () => {
    const abbruch = Object.assign(new Error('x'), { name: 'TimeoutError' })
    const fehler = await fehlerVon(() =>
      holeFundeSeite(ZUGANG, {}, () => Promise.reject(abbruch))
    )
    expect(fehler.art).toBe('netz')
    expect(fehler.message).toBe(
      'Das Buschtelefon hat nicht innert 30 Sekunden geantwortet.'
    )
  })

  it('macht aus einem fremden Umschlag «format»', async () => {
    const { holen } = tuer(() =>
      antwort(
        200,
        JSON.stringify({ format: 'buschtelefon-redaktion/1', funde: [] })
      )
    )
    const fehler = await fehlerVon(() => holeFundeSeite(ZUGANG, {}, holen))
    expect(fehler.art).toBe('format')
    expect(fehler.message).toContain('buschtelefon-redaktion/2')
  })

  it('nennt in keiner Fehlermeldung ein Geheimnis', async () => {
    const antworten: (() => ReturnType<FetchLike>)[] = [
      () =>
        antwort(302, '', { location: 'https://x.cloudflareaccess.com/login' }),
      () => antwort(401, '{"fehler":"nicht_berechtigt"}'),
      () => antwort(403, ''),
      () => antwort(410, '{"fehler":"stand_zu_alt","verworfen_bis":3}'),
      () => antwort(503, '{"grund":"nicht_eingerichtet"}'),
      () =>
        antwort(500, `echo ${GEHEIMNISSE.join(' ')}`, {
          'content-type': 'text/plain'
        }),
      () =>
        antwort(200, `<html>${GEHEIMNISSE.join(' ')}</html>`, {
          'content-type': 'text/html'
        })
    ]
    for (const eine of antworten) {
      const fehler = await fehlerVon(() =>
        holeFundeSeite(ZUGANG, {}, () => eine())
      )
      for (const geheim of GEHEIMNISSE)
        expect(fehler.message).not.toContain(geheim)
    }
  })
})

describe('holeFunde', () => {
  it('folgt «weiter» Seite um Seite und liefert alles aufsteigend', async () => {
    const { holen, aufrufe } = tuer(
      () => antwort(200, seite([fund(1, 10), fund(2, 11)], 11)),
      () => antwort(200, seite([fund(3, 12)], 12)),
      () => antwort(200, seite([]))
    )
    const abholung = await holeFunde(ZUGANG, { nach: 9, limit: 2 }, holen)
    expect(aufrufe.map((a) => a.url.split('?')[1])).toEqual([
      'nach=9&limit=2',
      'nach=11&limit=2',
      'nach=12&limit=2'
    ])
    expect(abholung.funde.map((f) => f.folge)).toEqual([10, 11, 12])
    expect(abholung).toMatchObject({ seiten: 3, folge: 12, abbruch: null })
    expect(abholung.freigabe.tag).toBe('2026-11-11')
  })

  it('holt ohne Lesezeichen von vorn', async () => {
    const { holen, aufrufe } = tuer(() => antwort(200, seite([fund(1, 10)])))
    const abholung = await holeFunde(ZUGANG, {}, holen)
    expect(aufrufe[0]!.url).toBe(
      'https://buschtelefon.example.test/api/redaktion/v2/funde?limit=200'
    )
    expect(abholung.folge).toBe(10)
  })

  it('lässt das Lesezeichen stehen, wenn nichts kam', async () => {
    const { holen } = tuer(() => antwort(200, seite([])))
    const abholung = await holeFunde(ZUGANG, { nach: 18422 }, holen)
    expect(abholung).toMatchObject({
      funde: [],
      ausgelassen: [],
      ungueltig: [],
      seiten: 1,
      folge: null
    })
  })

  it('zählt Ausgelassene und Ungültige für das Lesezeichen mit – ein ungültiger Fund hält nichts auf', async () => {
    const { holen } = tuer(() =>
      antwort(
        200,
        seite([fund(1, 10), fund(2, 11, { kanal: 'fax' })], null, {
          ausgelassen: [
            {
              kennung: null,
              folge: 13,
              grund: 'keine_stabile_kennung',
              gemeinden_bfs: []
            }
          ]
        })
      )
    )
    const abholung = await holeFunde(ZUGANG, { nach: 9 }, holen)
    expect(abholung.funde.map((f) => f.folge)).toEqual([10])
    expect(abholung.ungueltig).toEqual([
      { kennung: 'fb:1_2', folge: 11, grund: 'kanal: unbekannter Wert «fax»' }
    ])
    expect(
      abholung.ausgelassen.map((a) => [a.folge, a.grund, a.kennung])
    ).toEqual([[13, 'keine_stabile_kennung', null]])
    expect(abholung.folge).toBe(13)
  })

  it('führt einen Fund, der über Seiten zweimal kommt, unter der höheren folge', async () => {
    const { holen } = tuer(
      () =>
        antwort(200, seite([fund(1, 10, { text: 'alt' }), fund(2, 11)], 11)),
      () => antwort(200, seite([fund(1, 14, { text: 'neu' })]))
    )
    const abholung = await holeFunde(ZUGANG, {}, holen)
    expect(abholung.funde.map((f) => [f.kennung, f.folge])).toEqual([
      ['fb:1_2', 11],
      ['fb:1_1', 14]
    ])
    expect(abholung.funde[1]).toMatchObject({ text: 'neu' })
  })

  it('wirft, wenn schon die erste Seite scheitert', async () => {
    const { holen } = tuer(() =>
      antwort(410, '{"fehler":"stand_zu_alt","verworfen_bis":16000}')
    )
    const fehler = await fehlerVon(() => holeFunde(ZUGANG, { nach: 5 }, holen))
    expect(fehler.art).toBe('stand_zu_alt')
    expect(fehler.verworfenBis).toBe(16000)
  })

  it('behält, was gelesen ist, wenn eine spätere Seite scheitert', async () => {
    const { holen } = tuer(
      () => antwort(200, seite([fund(1, 10)], 10)),
      () => antwort(503, '{"fehler":"nicht_bereit","grund":"freigabe_laeuft"}')
    )
    const abholung = await holeFunde(ZUGANG, {}, holen)
    expect(abholung.funde.map((f) => f.folge)).toEqual([10])
    expect(abholung.folge).toBe(10)
    expect(abholung.abbruch?.art).toBe('freigabe_laeuft')
  })

  it('bricht ab, wenn «weiter» nicht vorwärts führt', async () => {
    const { holen, aufrufe } = tuer(
      () => antwort(200, seite([fund(1, 10)], 10)),
      () => antwort(200, seite([fund(1, 10)], 10))
    )
    const abholung = await holeFunde(ZUGANG, {}, holen)
    expect(aufrufe).toHaveLength(2)
    expect(abholung.abbruch?.art).toBe('format')
    expect(abholung.abbruch?.message).toContain('nicht vorwärts')
  })

  it('deklariert den Seitendeckel, statt endlos zu lesen', async () => {
    let n = 0
    const holen: FetchLike = () => {
      n += 1
      return antwort(200, seite([fund(n, n)], n))
    }
    const abholung = await holeFunde(ZUGANG, {}, holen, { maxSeiten: 3 })
    expect(n).toBe(3)
    expect(abholung.seiten).toBe(3)
    expect(abholung.folge).toBe(3)
    expect(abholung.abbruch?.message).toBe(
      'Mehr als 3 Seiten in einer Abholung: abgebrochen, der nächste Lauf macht beim Lesezeichen weiter.'
    )
  })

  it('ruft jeSeite nach jeder Seite, bevor die nächste geholt wird', async () => {
    const { holen, aufrufe } = tuer(
      () => antwort(200, seite([fund(1, 10)], 10)),
      () => antwort(200, seite([fund(2, 11)]))
    )
    const jeSeite = vi.fn(
      async (s: { funde: { folge: number }[] }, nummer: number) => {
        expect(aufrufe).toHaveLength(nummer)
        expect(s.funde).toHaveLength(1)
      }
    )
    await holeFunde(ZUGANG, {}, holen, { jeSeite })
    expect(jeSeite).toHaveBeenCalledTimes(2)
    expect(jeSeite.mock.calls.map((c) => [c[0].funde[0]!.folge, c[1]])).toEqual(
      [
        [10, 1],
        [11, 2]
      ]
    )
  })

  it('liest die Fixture als eine Seite', async () => {
    const { holen } = tuer(() =>
      antwort(200, JSON.stringify(fixture('funde.json')))
    )
    const abholung = await holeFunde(ZUGANG, { nach: 17600 }, holen)
    expect(abholung.funde).toHaveLength(5)
    expect(abholung.ausgelassen).toHaveLength(1)
    expect(abholung.ungueltig).toHaveLength(1)
    expect(abholung.folge).toBe(17690)
  })
})

describe('holeQuellen', () => {
  it('liest die Quellenliste mit denselben Zugangsangaben', async () => {
    const { holen, aufrufe } = tuer(() =>
      antwort(200, JSON.stringify(fixture('quellen.json')))
    )
    const ergebnis = await holeQuellen(ZUGANG, holen)
    expect(aufrufe[0]!.url).toBe(
      'https://buschtelefon.example.test/api/redaktion/v2/quellen'
    )
    expect(aufrufe[0]!.init.headers['Authorization']).toBe(
      'Bearer bearer-geheim'
    )
    expect(aufrufe[0]!.init.redirect).toBe('manual')
    expect(ergebnis.quellen).toHaveLength(3)
    expect(ergebnis.ungueltig).toHaveLength(1)
  })

  it('klassifiziert die Anmeldeseite von Cloudflare und einen fremden Umschlag', async () => {
    const cloudflare = await fehlerVon(() =>
      holeQuellen(ZUGANG, () =>
        antwort(200, '<html></html>', { 'content-type': 'text/html' })
      )
    )
    expect(cloudflare.art).toBe('cloudflare')
    const format = await fehlerVon(() =>
      holeQuellen(ZUGANG, () => antwort(200, `{"format":"${FORMAT}"}`))
    )
    expect(format.art).toBe('format')
  })
})
