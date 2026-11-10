import { describe, expect, it, vi } from 'vitest'
import {
  FORMAT,
  type FetchLike,
  type ZugangsErgebnis
} from '../shared/buschtelefon/client'
import type { FundRohzeile } from './buschtelefon'
import {
  FundOhneGemeinde,
  holeFunde,
  ladeStand,
  raeumeFundeAuf,
  schreibeFundMeldung
} from './buschtelefonlauf'

// `vi.mock` is hoisted — what its factory needs must be hoisted too.
const { completeJson, antworten, FormatFehler } = vi.hoisted(() => {
  class FormatFehler extends Error {
    constructor(readonly raw: string) {
      super('Claude did not return parseable JSON.')
      this.name = 'ClaudeFormatError'
    }
  }
  const antworten: Array<Record<string, unknown>> = []
  const standard = {
    titel: 'Münchenstein: Hauptstrasse gesperrt',
    lead: 'Wie in sozialen Netzwerken berichtet wird, ist die Hauptstrasse beim Dorfplatz noch zu; die Sperrung soll am 13. November 2026 enden.',
    text: 'Busse werden umgeleitet. Die Angaben sind nicht bestätigt.',
    bedenken: null
  }
  return {
    completeJson: vi.fn(
      async (_args: { prompt: string; system?: string }) =>
        antworten.shift() ?? standard
    ),
    antworten,
    FormatFehler
  }
})

vi.mock('../shared/claude', () => ({
  completeJson,
  ClaudeFormatError: FormatFehler
}))

const STILL = { info: () => undefined, warn: () => undefined }
const ZUGANG: ZugangsErgebnis = {
  ok: true,
  zugang: {
    url: 'https://buschtelefon.example.test',
    cfClientId: 'a',
    cfClientSecret: 'b',
    schluessel: 'c'
  }
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
    titel: null,
    text: `Beitrag ${kennung}`,
    zusammenfassung: null,
    artikel_text: null,
    kommentare: null,
    n_kommentare: 0,
    n_reaktionen: null,
    n_geteilt: null,
    doublette_von: null,
    bildtext: null,
    pruefsumme: 'abc',
    ...ueber
  }
}

function antwortMit(
  funde: unknown[],
  weiter: string | null = null
): ReturnType<FetchLike> {
  return Promise.resolve({
    status: 200,
    headers: { get: () => 'application/json' },
    text: async () =>
      JSON.stringify({
        format: FORMAT,
        stand: 'jetzt',
        funde,
        weiter,
        ohne_link: 0
      })
  })
}

type Zeile = Record<string, unknown> & { id: string; kennung: string }

/** An in-memory stand-in for the collection, honouring the three queries the pick-up makes. */
function sammlung(start: Zeile[] = []) {
  const zeilen = [...start]
  const geschrieben = {
    create: [] as Record<string, unknown>[],
    update: [] as Array<{ id: string; payload: Record<string, unknown> }>
  }
  let naechste = 1
  return {
    zeilen,
    geschrieben,
    dienst: {
      readByQuery: async (q: Record<string, unknown>) => {
        const filter = (q['filter'] ?? {}) as Record<
          string,
          { _in?: string[] } | unknown
        >
        const sort = q['sort'] as string[] | undefined
        if (sort?.[0] === '-erfasst_am') {
          const sortiert = [...zeilen].sort((a, b) =>
            String(b['erfasst_am']).localeCompare(String(a['erfasst_am']))
          )
          return sortiert.slice(0, 1)
        }
        const kennungen = (filter['kennung'] as { _in?: string[] } | undefined)
          ?._in
        if (kennungen !== undefined)
          return zeilen.filter((z) => kennungen.includes(z.kennung))
        return zeilen
      },
      createOne: async (payload: Record<string, unknown>) => {
        geschrieben.create.push(payload)
        const id = `neu-${naechste++}`
        zeilen.push({ id, ...payload } as Zeile)
        return id
      },
      updateOne: async (id: string, payload: Record<string, unknown>) => {
        geschrieben.update.push({ id, payload })
        return id
      },
      updateMany: async () => [],
      deleteMany: async () => []
    }
  }
}

const GEMEINDEN = {
  readByQuery: async () => [
    { id: 'g-aesch', name: 'Aesch' },
    { id: 'g-riehen', name: 'Riehen' }
  ]
}

describe('holeFunde — ohne Zugangsdaten', () => {
  it('läuft nicht, nennt die fehlenden Variablen und holt nichts', async () => {
    const holen = vi.fn<FetchLike>()
    const s = sammlung()
    const r = await holeFunde({
      funde: s.dienst,
      gemeinden: GEMEINDEN,
      zugang: { ok: false, fehlend: ['BUSCHTELEFON_SCHLUESSEL'] },
      holen,
      logger: STILL
    })
    expect(r.status).toBe('nicht_eingerichtet')
    expect(r.fehlend).toEqual(['BUSCHTELEFON_SCHLUESSEL'])
    expect(holen).not.toHaveBeenCalled()
    expect(s.geschrieben.create).toEqual([])
  })

  it('schreibt nichts ins Log', async () => {
    const warn = vi.fn()
    const info = vi.fn()
    await holeFunde({
      funde: sammlung().dienst,
      gemeinden: GEMEINDEN,
      zugang: {
        ok: false,
        fehlend: ['BUSCHTELEFON_URL (https-Adresse ohne Pfad)']
      },
      holen: vi.fn<FetchLike>(),
      logger: { info, warn }
    })
    expect(warn).not.toHaveBeenCalled()
    expect(info).not.toHaveBeenCalled()
  })
})

describe('holeFunde — Abholstand', () => {
  it('liest beim ersten Mal ohne seit', async () => {
    const holen = vi.fn<FetchLike>(() => antwortMit([]))
    const r = await holeFunde({
      funde: sammlung().dienst,
      gemeinden: GEMEINDEN,
      zugang: ZUGANG,
      holen,
      logger: STILL
    })
    expect(r.seit).toBeNull()
    expect(holen.mock.calls[0]![0]).not.toContain('seit=')
  })

  it('liest danach ab dem höchsten erfasst_am minus zwei Stunden', async () => {
    const s = sammlung([
      { id: '1', kennung: 'fb:1', erfasst_am: '2026-11-09T10:00:00.000Z' },
      { id: '2', kennung: 'fb:2', erfasst_am: '2026-11-09T14:00:00.000Z' }
    ])
    expect(await ladeStand(s.dienst)).toBe('2026-11-09T14:00:00.000Z')
    const holen = vi.fn<FetchLike>(() => antwortMit([]))
    const r = await holeFunde({
      funde: s.dienst,
      gemeinden: GEMEINDEN,
      zugang: ZUGANG,
      holen,
      logger: STILL
    })
    expect(r.seit).toBe('2026-11-09T12:00:00.000Z')
    expect(holen.mock.calls[0]![0]).toContain(
      'seit=2026-11-09T12%3A00%3A00.000Z'
    )
  })
})

describe('holeFunde — Upsert über die Kennung', () => {
  it('legt Neues offen an, mit zugeordneter Gemeinde, und zählt ohne Gemeinde', async () => {
    const s = sammlung()
    const holen: FetchLike = () =>
      antwortMit([
        fund('fb:1', '2026-11-09T10:00:00+01:00'),
        fund('fb:2', '2026-11-09T10:00:00+01:00', {
          gemeinde_slug: 'unbekanntdorf'
        })
      ])
    const r = await holeFunde({
      funde: s.dienst,
      gemeinden: GEMEINDEN,
      zugang: ZUGANG,
      holen,
      logger: STILL
    })
    expect(r.neu).toBe(2)
    expect(r.ohneGemeinde).toBe(1)
    expect(s.geschrieben.create[0]).toMatchObject({
      kennung: 'fb:1',
      gemeinde: 'g-aesch',
      entscheid: 'offen'
    })
    expect(s.geschrieben.create[1]).toMatchObject({
      kennung: 'fb:2',
      gemeinde: null
    })
  })

  it('macht aus einem zweiten Lauf mit denselben Funden kein Duplikat und keinen Schreibzugriff', async () => {
    const s = sammlung()
    const holen: FetchLike = () =>
      antwortMit([fund('fb:1', '2026-11-09T10:00:00+01:00')])
    await holeFunde({
      funde: s.dienst,
      gemeinden: GEMEINDEN,
      zugang: ZUGANG,
      holen,
      logger: STILL
    })
    // The stored row as the database hands it back.
    s.zeilen[0] = { ...s.zeilen[0]!, id: 'x1' }
    const r = await holeFunde({
      funde: s.dienst,
      gemeinden: GEMEINDEN,
      zugang: ZUGANG,
      holen,
      logger: STILL
    })
    expect(r.neu).toBe(0)
    expect(r.unveraendert).toBe(1)
    expect(s.geschrieben.create).toHaveLength(1)
    expect(s.geschrieben.update).toEqual([])
  })

  it('aktualisiert einen bekannten Fund, dessen Zahlen sich geändert haben, und lässt den Entscheid in Ruhe', async () => {
    const s = sammlung()
    await holeFunde({
      funde: s.dienst,
      gemeinden: GEMEINDEN,
      zugang: ZUGANG,
      holen: () => antwortMit([fund('fb:1', '2026-11-09T10:00:00+01:00')]),
      logger: STILL
    })
    s.zeilen[0] = { ...s.zeilen[0]!, id: 'x1', entscheid: 'abgelehnt' }
    const r = await holeFunde({
      funde: s.dienst,
      gemeinden: GEMEINDEN,
      zugang: ZUGANG,
      holen: () =>
        antwortMit([
          fund('fb:1', '2026-11-09T10:00:00+01:00', { n_kommentare: 7 })
        ]),
      logger: STILL
    })
    expect(r.aktualisiert).toBe(1)
    expect(s.geschrieben.update).toEqual([
      { id: 'x1', payload: { n_kommentare: 7 } }
    ])
  })

  it('folgt «weiter» über mehrere Seiten', async () => {
    const urls: string[] = []
    const holen: FetchLike = (url) => {
      urls.push(url)
      return urls.length === 1
        ? antwortMit(
            [fund('fb:1', '2026-11-09T10:00:00+01:00')],
            '2026-11-09T10:00:00+01:00'
          )
        : antwortMit([fund('fb:2', '2026-11-09T11:00:00+01:00')])
    }
    const s = sammlung()
    const r = await holeFunde({
      funde: s.dienst,
      gemeinden: GEMEINDEN,
      zugang: ZUGANG,
      holen,
      logger: STILL,
      limit: 1
    })
    expect(r.seiten).toBe(2)
    expect(r.neu).toBe(2)
    expect(urls[1]).toContain('seit=2026-11-09T10%3A00%3A00%2B01%3A00')
  })

  it('hält eine Zeile, die ein anderer Lauf gerade gespeichert hat, nicht für einen Fehler', async () => {
    const s = sammlung()
    s.dienst.createOne = async () => {
      throw new Error(
        'duplicate key value violates unique constraint "buschtelefon_funde_kennung_uniq"'
      )
    }
    const r = await holeFunde({
      funde: s.dienst,
      gemeinden: GEMEINDEN,
      zugang: ZUGANG,
      holen: () => antwortMit([fund('fb:1', '2026-11-09T10:00:00+01:00')]),
      logger: STILL
    })
    expect(r.status).toBe('ok')
    expect(r.fehler).toEqual([])
  })

  it('hört bei einem Schreibfehler auf, damit der Stand nicht über eine Lücke wandert', async () => {
    const s = sammlung()
    let n = 0
    const echt = s.dienst.createOne
    s.dienst.createOne = async (p) => {
      if (++n === 2) throw new Error('Datenbank weg')
      return echt(p)
    }
    const r = await holeFunde({
      funde: s.dienst,
      gemeinden: GEMEINDEN,
      zugang: ZUGANG,
      holen: () =>
        antwortMit([
          fund('fb:1', '2026-11-09T10:00:00+01:00'),
          fund('fb:2', '2026-11-09T11:00:00+01:00'),
          fund('fb:3', '2026-11-09T12:00:00+01:00')
        ]),
      logger: STILL
    })
    expect(r.status).toBe('fehler')
    expect(r.neu).toBe(1)
    expect(r.fehler[0]).toMatch(/fb:2 nicht gespeichert/)
    expect(s.zeilen.map((z) => z.kennung)).toEqual(['fb:1'])
  })
})

describe('holeFunde — Fehler der Gegenseite', () => {
  it('meldet die Anmeldeseite von Cloudflare als Ergebnis und stürzt nicht ab', async () => {
    const s = sammlung()
    const holen: FetchLike = () =>
      Promise.resolve({
        status: 200,
        headers: { get: () => 'text/html; charset=utf-8' },
        text: async () =>
          '<!DOCTYPE html><html><title>Cloudflare Access</title></html>'
      })
    const r = await holeFunde({
      funde: s.dienst,
      gemeinden: GEMEINDEN,
      zugang: ZUGANG,
      holen,
      logger: STILL
    })
    expect(r.status).toBe('fehler')
    expect(r.fehler[0]).toMatch(/Anmeldeseite/)
    expect(r.fehler[0]).not.toMatch(/Unexpected token|SyntaxError/)
    expect(s.geschrieben.create).toEqual([])
  })

  it('meldet 401 der Bridge als Schlüsselproblem', async () => {
    const holen: FetchLike = () =>
      Promise.resolve({
        status: 401,
        headers: { get: () => 'application/json' },
        text: async () => '{}'
      })
    const r = await holeFunde({
      funde: sammlung().dienst,
      gemeinden: GEMEINDEN,
      zugang: ZUGANG,
      holen,
      logger: STILL
    })
    expect(r.status).toBe('fehler')
    expect(r.fehler[0]).toMatch(/Bearer-Schlüssel/)
  })

  it('trägt keinen Zugangswert in das Ergebnis', async () => {
    const holen: FetchLike = () => Promise.reject(new Error('boom'))
    const r = await holeFunde({
      funde: sammlung().dienst,
      gemeinden: GEMEINDEN,
      zugang: ZUGANG,
      holen,
      logger: STILL
    })
    const text = JSON.stringify(r)
    expect(text).not.toContain('"c"')
    expect(r.status).toBe('fehler')
  })
})

describe('raeumeFundeAuf', () => {
  it('lässt Offenes verfallen und löscht Altes, mit Abschluss im Log', async () => {
    const jetzt = new Date('2026-11-10T12:00:00Z')
    const vor = (t: number): string =>
      new Date(jetzt.getTime() - t * 86_400_000).toISOString()
    const verfallen: string[][] = []
    const geloescht: string[][] = []
    const info = vi.fn()
    const r = await raeumeFundeAuf(
      {
        readByQuery: async () => [
          { id: 'a', entscheid: 'offen', erfasst_am: vor(15) },
          { id: 'b', entscheid: 'offen', erfasst_am: vor(1) },
          { id: 'c', entscheid: 'abgelehnt', erfasst_am: vor(31) }
        ],
        createOne: async () => '',
        updateOne: async () => '',
        updateMany: async (ids) => {
          verfallen.push(ids)
        },
        deleteMany: async (ids) => {
          geloescht.push(ids)
        }
      },
      jetzt,
      { info, warn: () => undefined }
    )
    expect(r).toEqual({ verfallen: 1, geloescht: 1 })
    expect(verfallen).toEqual([['a']])
    expect(geloescht).toEqual([['c']])
  })
})

describe('schreibeFundMeldung', () => {
  const zeile: FundRohzeile = {
    id: 'f1',
    kennung: 'fb:9990000000000201',
    kanal: 'facebook',
    gemeinde: { id: 'g-m', name: 'Münchenstein' },
    gemeinde_slug: 'muenchenstein',
    quelle_name: 'Facebook-Gruppe Musterdorf',
    quelle_art: 'gruppe',
    link: 'https://www.facebook.com/groups/1/posts/9990000000000201/',
    veroeffentlicht_am: '2026-11-08T00:00:00+01:00',
    datum_genauigkeit: 'tag',
    titel: 'Sperrung der Hauptstrasse',
    text: 'Die Hauptstrasse beim Dorfplatz bleibt bis 13. November 2026 gesperrt. Der Bus fährt über die Umleitung.',
    zusammenfassung: null,
    artikel_text: null,
    kommentare: null,
    n_kommentare: 0,
    n_reaktionen: null,
    n_geteilt: null,
    doublette_von: null,
    entscheid: 'offen'
  }

  function dienste() {
    const erstellt: Record<string, unknown>[] = []
    const fundUpdates: Array<{ id: string; payload: Record<string, unknown> }> =
      []
    return {
      erstellt,
      fundUpdates,
      kontext: {
        funde: {
          updateOne: async (id: string, payload: Record<string, unknown>) => {
            fundUpdates.push({ id, payload })
            return id
          }
        },
        meldungen: {
          readByQuery: async () => [],
          createOne: async (payload: Record<string, unknown>) => {
            erstellt.push(payload)
            return 'm1'
          }
        }
      }
    }
  }

  it('schreibt einen Entwurf, der durch die normale Statusmaschine läuft, und übernimmt den Fund', async () => {
    antworten.length = 0
    const d = dienste()
    const r = await schreibeFundMeldung(d.kontext, zeile)
    expect(r.meldung).toBe('m1')
    expect(d.erstellt[0]).toMatchObject({
      buschtelefon_fund: 'f1',
      gemeinde: 'g-m',
      status: 'entwurf',
      verarbeitung: 'idle'
    })
    expect(d.fundUpdates).toEqual([
      { id: 'f1', payload: { entscheid: 'uebernommen' } }
    ])
  })

  it('hängt die Quellenzeile ohne Gruppe und Adresse an und legt nur die allgemeine Quelle in die Datengrundlage', async () => {
    antworten.length = 0
    const d = dienste()
    await schreibeFundMeldung(d.kontext, zeile)
    const m = d.erstellt[0]!
    expect(String(m['text'])).toMatch(
      /Quelle: Beitrag in sozialen Netzwerken vom 8\. November 2026, nicht unabhängig bestätigt$/
    )
    expect(String(m['text'])).not.toMatch(/facebook\.com|Musterdorf/)
    expect(m['datengrundlage']).toEqual({
      quelle: 'buschtelefon',
      quelle_name: 'Hinweis aus der Gemeinde (Buschtelefon)',
      url: null
    })
  })

  it('fasst nach, wenn der Text die Herkunft nicht nennt, und warnt, wenn es auch dann fehlt', async () => {
    antworten.length = 0
    const ohne = {
      titel: 'Münchenstein: Strasse gesperrt',
      lead: 'Die Hauptstrasse ist bis zum 13. November 2026 zu.',
      text: 'Busse fahren um.',
      bedenken: null
    }
    antworten.push(ohne, ohne)
    const d = dienste()
    const r = await schreibeFundMeldung(d.kontext, zeile)
    expect(completeJson).toHaveBeenCalled()
    expect(r.warnungen.join(' ')).toMatch(/sozialen Netzwerken/)
    expect(d.erstellt[0]!['zeit_warnungen']).toEqual(r.warnungen)
  })

  it('lehnt einen Fund ohne Gemeinde ab, bevor ein Modell gefragt wird', async () => {
    completeJson.mockClear()
    const d = dienste()
    await expect(
      schreibeFundMeldung(d.kontext, { ...zeile, gemeinde: null })
    ).rejects.toBeInstanceOf(FundOhneGemeinde)
    expect(completeJson).not.toHaveBeenCalled()
    expect(d.erstellt).toEqual([])
  })
})
