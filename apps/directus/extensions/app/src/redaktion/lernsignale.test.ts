import { describe, expect, it } from 'vitest'
import {
  bilanz,
  bilanzZeile,
  deklariereKappung,
  ladeAmtsblattSignale,
  ladeSendungSignale,
  ladeWochenblattSignale,
  type ItemsServiceLike
} from './lernsignale'

type Query = Record<string, unknown>

/** A stub service that answers by query shape and remembers what was asked. */
function dienst(
  antwort: (query: Query) => unknown
): ItemsServiceLike & { aufrufe: Query[] } {
  const aufrufe: Query[] = []
  return {
    aufrufe,
    readByQuery: async (query: Query) => {
      aufrufe.push(query)
      return antwort(query)
    }
  }
}

const filterVon = (q: Query): Record<string, unknown> =>
  (q['filter'] ?? {}) as Record<string, unknown>
const felderVon = (q: Query): string[] => (q['fields'] ?? []) as string[]

function kandidat(ueber: Record<string, unknown>): Record<string, unknown> {
  return {
    id: 'k',
    titel: 'Beitrag',
    typ: 'reportage',
    entscheid: 'offen',
    ablehnungsgrund: null,
    ablehnungskommentar: null,
    perle_vorschlag: false,
    perle: null,
    perle_kommentar: null,
    date_updated: '2026-09-01',
    ...ueber
  }
}

describe('bilanz / bilanzZeile', () => {
  it('zaehlt alle vier Ausgaenge und das Offene', () => {
    const b = bilanz([
      { entscheid: 'uebernommen' },
      { entscheid: 'abgelehnt' },
      { entscheid: 'abgelehnt' },
      { entscheid: 'weitergereicht' },
      { entscheid: 'verfallen' },
      { entscheid: 'offen' }
    ])
    expect(b).toEqual({
      gesamt: 6,
      uebernommen: 1,
      weitergereicht: 1,
      abgelehnt: 2,
      verfallen: 1,
      offen: 1
    })
  })

  it('schweigt unter der Mindestzahl — zwei Entscheide sind keine Bilanz', () => {
    expect(
      bilanzZeile(bilanz([{ entscheid: 'abgelehnt' }]), 'dieses Blatts')
    ).toBe('')
  })

  it('nennt die Zahlen als Tatsache, ohne Imperativ', () => {
    const viele = [
      ...Array.from({ length: 9 }, () => ({ entscheid: 'uebernommen' })),
      ...Array.from({ length: 35 }, () => ({ entscheid: 'verfallen' })),
      ...Array.from({ length: 14 }, () => ({ entscheid: 'abgelehnt' })),
      ...Array.from({ length: 3 }, () => ({ entscheid: 'weitergereicht' })),
      { entscheid: 'offen' }
    ]
    const zeile = bilanzZeile(
      bilanz(viele),
      'der letzten 3 Ausgaben dieses Blatts'
    )
    expect(zeile).toBe(
      'Bilanz der letzten 3 Ausgaben dieses Blatts: 62 Vorschlaege — 9 uebernommen, 3 weitergereicht, 14 abgelehnt, 35 liegen gelassen, 1 noch unentschieden.'
    )
    expect(zeile).not.toMatch(/streng/i)
  })
})

describe('deklariereKappung', () => {
  it('sagt, wie viele fehlen — und schweigt, wenn nichts fehlt', () => {
    expect(deklariereKappung(26, 20)).toBe(
      '(6 weitere Entscheide nicht aufgefuehrt)'
    )
    expect(deklariereKappung(20, 20)).toBe('')
  })
})

describe('ladeWochenblattSignale', () => {
  // Drei Ausgaben, darin: eine uebernommene (mit verworfener Meldung), eine
  // abgelehnte mit Kommentar, eine weitergereichte (von der Chefin abgelegt),
  // zwei liegen gelassene, eine offene.
  const zeilen = dienst((q) => {
    const f = filterVon(q)
    if ('perle' in f) {
      return [
        {
          titel: 'Esel',
          perle: false,
          perle_kommentar: 'rein lokal',
          ausgabe: { wochenblatt: { name: 'Binninger Wochenblatt' } }
        }
      ]
    }
    if ('gemeinde_korrigiert' in f) return []
    return [
      kandidat({
        id: 'u1',
        titel: 'Interview',
        typ: 'interview',
        entscheid: 'uebernommen',
        date_updated: '2026-09-01'
      }),
      kandidat({
        id: 'a1',
        titel: 'Jubilaeum',
        typ: 'portraet',
        entscheid: 'abgelehnt',
        ablehnungsgrund: 'nicht_relevant',
        ablehnungskommentar: 'ohne Zutaten',
        date_updated: '2026-09-02'
      }),
      kandidat({
        id: 'w1',
        titel: 'Daemme',
        typ: 'hintergrund',
        entscheid: 'weitergereicht',
        date_updated: '2026-09-03'
      }),
      kandidat({
        id: 'v1',
        titel: 'Kirchenzettel',
        typ: 'service',
        entscheid: 'verfallen',
        date_updated: '2026-08-20'
      }),
      kandidat({
        id: 'v2',
        titel: 'Agenda',
        typ: 'service',
        entscheid: 'verfallen',
        date_updated: '2026-08-21'
      }),
      kandidat({ id: 'o1', titel: 'Neu', date_updated: '2026-09-04' })
    ]
  })
  const hinweise = dienst((q) => {
    const f = filterVon(q)
    const kand = f['kandidat'] as Record<string, unknown> | undefined
    if (kand !== undefined && '_in' in kand) {
      return [
        {
          kandidat: 'w1',
          status: 'kein_hinweis',
          kommentar: 'nichts dran',
          automatisch: false
        }
      ]
    }
    return [{ titel: 'Leserbrief Laub', status: 'brauchbar', kommentar: null }]
  })
  const meldungen = dienst(() => [
    { kandidat: 'u1', verwerfungsgrund: 'zu duenn' }
  ])
  const ausgaben = dienst(() => [
    { id: 'aus-1' },
    { id: 'aus-2' },
    { id: 'aus-3' }
  ])

  it('bindet das Fenster an die letzten Ausgaben und liest Kommentar, Verwurf und Urteil', async () => {
    const signale = await ladeWochenblattSignale(
      { zeilen, hinweise, meldungen, ausgaben },
      'blatt-1'
    )

    // Das Fenster sind die Ausgaben, nicht "die letzten 20 Zeilen".
    const kandidatenAbfrage = zeilen.aufrufe[0]
    expect(filterVon(kandidatenAbfrage ?? {})).toEqual({
      ausgabe: { _in: ['aus-1', 'aus-2', 'aus-3'] }
    })
    expect(felderVon(kandidatenAbfrage ?? {})).toContain('ablehnungskommentar')

    expect(signale.entscheide.map((e) => e.entscheid)).toEqual([
      'weitergereicht',
      'abgelehnt',
      'uebernommen'
    ])
    expect(signale.entscheide[2]?.meldungVerworfen).toEqual({
      grund: 'zu duenn'
    })
    expect(signale.entscheide[0]?.faehrte?.status).toBe('kein_hinweis')
    expect(signale.entscheide[1]?.ablehnungskommentar).toBe('ohne Zutaten')
  })

  it('zaehlt das Liegengelassene und holt die Perlen aller Blaetter', async () => {
    const signale = await ladeWochenblattSignale(
      { zeilen, hinweise, meldungen, ausgaben },
      'blatt-1'
    )

    expect(signale.rahmen.verfallene).toEqual(['Agenda', 'Kirchenzettel'])
    // Sechs Zeilen sind keine Bilanz — sie schweigt unter der Mindestzahl.
    expect(signale.rahmen.bilanz).toBe('')
    expect(signale.rahmen.kappung).toBe('')
    expect(signale.perlen).toEqual([
      {
        titel: 'Esel',
        blatt: 'Binninger Wochenblatt',
        bestaetigt: false,
        kommentar: 'rein lokal'
      }
    ])
    // Die Perlen-Abfrage ist NICHT auf das Blatt eingeschraenkt.
    const perlenAbfrage = zeilen.aufrufe.find((q) => 'perle' in filterVon(q))
    expect(filterVon(perlenAbfrage ?? {})).toEqual({ perle: { _nnull: true } })
  })

  it('haelt die eigenen Faehrten des Inventars von den weitergereichten Kandidaten getrennt', async () => {
    const signale = await ladeWochenblattSignale(
      { zeilen, hinweise, meldungen, ausgaben },
      'blatt-1'
    )
    const faehrtenAbfrage = hinweise.aufrufe.find(
      (q) => 'status' in filterVon(q)
    )
    expect(filterVon(faehrtenAbfrage ?? {})['kandidat']).toEqual({
      _null: true
    })
    expect(signale.faehrten).toEqual([
      { titel: 'Leserbrief Laub', brauchbar: true, kommentar: null }
    ])
  })
})

describe('ladeAmtsblattSignale', () => {
  const zeilen = dienst((q) => {
    const felder = felderVon(q)
    if (felder.includes('rubrik_name')) {
      return [
        {
          id: 'p1',
          titel: 'Whirlpool',
          rubrik_name: 'Baugesuch',
          entscheid: 'abgelehnt',
          ablehnungsgrund: 'zu_privat',
          ablehnungskommentar: 'Privatgarten'
        },
        {
          id: 'p2',
          titel: 'Schulhaus',
          rubrik_name: 'Beschluss',
          entscheid: 'uebernommen',
          ablehnungsgrund: null,
          ablehnungskommentar: null
        }
      ]
    }
    if (felder.length === 1 && felder[0] === 'id') {
      return Array.from({ length: 40 }, (_, i) => ({ id: `p${i}` }))
    }
    if (felder[0] === 'entscheid') {
      return [
        ...Array.from({ length: 6 }, () => ({ entscheid: 'verfallen' })),
        ...Array.from({ length: 3 }, () => ({ entscheid: 'abgelehnt' })),
        { entscheid: 'uebernommen' }
      ]
    }
    return [{ titel: 'Dachfenster' }]
  })
  const leer = dienst(() => [])

  it('liest den Kommentar, zaehlt das Fenster und deklariert die Kappung', async () => {
    const signale = await ladeAmtsblattSignale(
      { zeilen, hinweise: leer, meldungen: leer },
      'gem-1',
      '2026-09-13'
    )

    const beispiele = zeilen.aufrufe[0]
    expect(filterVon(beispiele ?? {})).toEqual({
      gemeinde: { _eq: 'gem-1' },
      entscheid: { _in: ['uebernommen', 'abgelehnt', 'weitergereicht'] }
    })
    expect(signale.entscheide[0]?.kommentar).toBe('Privatgarten')
    expect(signale.rahmen.bilanz).toContain('10 Vorschlaege')
    expect(signale.rahmen.bilanz).toContain('6 liegen gelassen')
    expect(signale.rahmen.verfallene).toEqual(['Dachfenster'])
    expect(signale.rahmen.kappung).toBe(
      '(38 weitere Entscheide nicht aufgefuehrt)'
    )
    // Das Fenster ist ein Datum, kein relatives Wort.
    const fenster = zeilen.aufrufe.find((q) => 'date_created' in filterVon(q))
    expect(filterVon(fenster ?? {})['date_created']).toEqual({
      _gte: '2026-08-14'
    })
  })
})

describe('ladeSendungSignale', () => {
  it('filtert je Sendung und reicht die Gemeinde als Namen weiter', async () => {
    const zeilen = dienst((q) => {
      const felder = felderVon(q)
      if (felder.includes('gemeinde.name')) {
        return [
          {
            id: 's1',
            titel: 'Tempo 30',
            gemeinde: { name: 'Muenchenstein' },
            entscheid: 'abgelehnt',
            ablehnungsgrund: 'nur_erwaehnt',
            ablehnungskommentar: null
          }
        ]
      }
      return []
    })
    const leer = dienst(() => [])
    const signale = await ladeSendungSignale(
      { zeilen, hinweise: leer, meldungen: leer },
      'punkt6',
      '2026-09-13'
    )
    expect(filterVon(zeilen.aufrufe[0] ?? {})['quelle']).toEqual({
      _eq: 'punkt6'
    })
    expect(signale.entscheide).toEqual([
      {
        titel: 'Tempo 30',
        gemeinde: 'Muenchenstein',
        entscheid: 'abgelehnt',
        grund: 'nur_erwaehnt',
        kommentar: null,
        meldungVerworfen: null,
        faehrte: null
      }
    ])
  })
})
