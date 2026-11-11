import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import type { MessageSender } from '../shared/claude'
import { liesFundeAntwort } from '../shared/buschtelefon/parse'
import { istEntfernt, type Fund } from '../shared/buschtelefon/typen'
import {
  datengrundlageVon,
  fundFelder,
  HINWEIS_KOMMENTARE_ENTFERNT,
  HINWEIS_NICHT_AUFFINDBAR,
  HINWEIS_NICHT_ERREICHBAR,
  leereMaterial,
  mitQuelle
} from './buschtelefon'
import {
  abholungLaeuft,
  ausgelasseneImLauf,
  brauchtSichtung,
  ENTWURF_VERALTET,
  freigabeHinweis,
  fuehreAusgelasseneNach,
  gleicheSchwelleAb,
  HINWEIS_ENTWURF_AELTER,
  HINWEIS_QUELLE_NEU,
  HINWEIS_WIEDER_DA,
  holeAb,
  holeAbEinzeln,
  LAUF_LAEUFT_HINWEIS,
  LEAD_OHNE_WORTLAUT,
  liesAusgelassene,
  meldungStand,
  quelleFelder,
  raeumeAuf,
  type AbholDienste
} from './buschtelefonlauf'
import {
  fixture,
  modell,
  sammlung,
  STILL,
  tuer,
  ZUGANG_ENV,
  type Modell,
  type Sammlung,
  type Tuer
} from './buschtelefon.testhilfe'
import { regelnBlock, SICHTUNGSREGELN_UEBERSCHRIFT } from './lernen'
import { liesQuellenAntwort } from '../shared/buschtelefon/parse'

type Zeile = Record<string, unknown>

const FUNDE = fixture('funde.json')
const gelesen = liesFundeAntwort(FUNDE)

function fund(kennung: string): Fund {
  const f = gelesen.funde.find((x) => x.kennung === kennung)
  if (f === undefined || istEntfernt(f)) throw new Error(`kein Fund ${kennung}`)
  return f
}

const FLYER = 'fb:1000000001_2000000001'
const SPERRUNG = 'fb:1000000001_2000000002'
const POLIZEI = 'fb:1000000001_2000000003'
const GESCHLOSSEN = 'fb:1000000002_2000000004'
const GRABSTEIN = 'fb:1000000001_2000000005'

const GEMEINDEN = [
  { id: 'g-1', name: 'Musterdorf', bfs_nummer: 2761, aktiv: true },
  { id: 'g-2', name: 'Nachbardorf', bfs_nummer: 2763, aktiv: true }
]

/** 11 November 2026, 12:00 in Zurich — the day of the fixture's release. */
const MITTAG = new Date('2026-11-11T12:00:00+01:00')

const LEER = (freigabe: unknown = FUNDE['freigabe']) => ({
  format: 'buschtelefon-redaktion/2',
  freigabe,
  funde: [],
  ausgelassen: [],
  weiter: null
})

/** A stored row, as an earlier run would have left it. */
function bestand(kennung: string, mehr: Zeile = {}): Zeile {
  return {
    id: `alt-${kennung.slice(-1)}`,
    entscheid: 'offen',
    entschieden_am: null,
    material_geloescht_am: null,
    aktualisiert_am: null,
    neue_kommentare: 0,
    vorschlag: null,
    vorschlag_wert: null,
    vorschlag_begruendung: null,
    gesichtet_folge: null,
    entwurf_bedenken: null,
    ...fundFelder(
      fund(kennung),
      'https://www.facebook.com/groups/1000000001',
      'g-1'
    ),
    ...mehr
  }
}

interface Aufbau {
  dienste: AbholDienste
  funde: Sammlung
  quellen: Sammlung
  meldungen: Sammlung
  hinweise: Sammlung
  stand: { zeile: Zeile; schreibungen: Zeile[] }
  m: Modell
  t: Tuer
}

function aufbau(
  optionen: {
    funde?: Zeile[]
    meldungen?: Zeile[]
    hinweise?: Zeile[]
    stand?: Zeile
    m?: Modell
    t?: Tuer
    env?: NodeJS.ProcessEnv
    jetzt?: Date
    schwelle?: number
    stoerung?: (payload: Zeile) => void
  } = {}
): Aufbau {
  const funde = sammlung(
    'funde',
    optionen.funde ?? [],
    { gemeinde: GEMEINDEN },
    optionen.stoerung
  )
  const quellen = sammlung('quellen')
  const meldungen = sammlung('meldungen', optionen.meldungen ?? [])
  const hinweise = sammlung('hinweise', optionen.hinweise ?? [])
  const stand = {
    zeile: { ...(optionen.stand ?? {}) } as Zeile,
    schreibungen: [] as Zeile[]
  }
  const m = optionen.m ?? modell()
  const t = optionen.t ?? tuer((nach) => (nach === null ? FUNDE : LEER()))
  const regelzeilen = [
    {
      id: 'r-1',
      regel: 'Vermisste Tiere nie vorschlagen.',
      bereich: 'buschtelefon' as const,
      stufe: 'sichtung' as const,
      wirkung: 'hinweis' as const
    }
  ]
  return {
    funde,
    quellen,
    meldungen,
    hinweise,
    stand,
    m,
    t,
    dienste: {
      funde,
      quellen,
      meldungen,
      hinweise,
      gemeinden: sammlung('gemeinden', GEMEINDEN),
      stand: {
        lies: async () => stand.zeile,
        schreibe: async (payload) => {
          stand.schreibungen.push(payload)
          Object.assign(stand.zeile, payload)
        }
      },
      schwelle: optionen.schwelle ?? 3,
      regelzeilen,
      sichtungsregeln: regelnBlock(regelzeilen, SICHTUNGSREGELN_UEBERSCHRIFT),
      textregeln: [],
      logger: STILL,
      env: optionen.env ?? ZUGANG_ENV,
      fetchImpl: t.fetchImpl,
      send: m.send,
      jetzt: () => optionen.jetzt ?? MITTAG
    }
  }
}

describe('holeAb — nicht eingerichtet', () => {
  it('fragt nichts und nennt die fehlenden Variablen', async () => {
    const a = aufbau({ env: {} as NodeJS.ProcessEnv })
    const ergebnis = await holeAb(a.dienste)
    expect(ergebnis.status).toBe('nicht_eingerichtet')
    expect(ergebnis.fehlend).toEqual([
      'BUSCHTELEFON_CF_CLIENT_ID',
      'BUSCHTELEFON_CF_CLIENT_SECRET',
      'BUSCHTELEFON_SCHLUESSEL'
    ])
    expect(ergebnis.fehler).toEqual([])
    expect(a.t.urls).toEqual([])
    expect(a.m.aufrufe).toEqual([])
  })

  it('raeumt trotzdem auf und laesst das Lesezeichen stehen', async () => {
    const alt = bestand(SPERRUNG, {
      erstmals_freigegeben_am: '2026-10-20T11:52:00+02:00'
    })
    const a = aufbau({
      env: {} as NodeJS.ProcessEnv,
      funde: [alt],
      stand: { folge: 17000, freigabe: { tag: '2026-11-10' } },
      meldungen: [
        {
          id: 'm-1',
          buschtelefon_fund: 'alt-2',
          status: 'entwurf',
          date_updated: null
        }
      ]
    })
    const ergebnis = await holeAb(a.dienste)
    // A feed switched off still forgets on schedule (decision 8).
    expect(ergebnis.aufgeraeumt.verfallen).toBe(1)
    expect(a.funde.finde('alt-2')).toMatchObject({
      entscheid: 'verfallen',
      text: null,
      kommentare: [],
      kennung: SPERRUNG
    })
    expect(a.meldungen.finde('m-1')['status']).toBe('verworfen')
    // No door, no model.
    expect(a.t.urls).toEqual([])
    expect(a.m.aufrufe).toEqual([])
    // The row says so — and keeps the bookmark and the release.
    expect(a.stand.schreibungen).toHaveLength(1)
    const geschrieben = a.stand.schreibungen[0] ?? {}
    for (const feld of ['folge', 'freigabe', 'letzter_abruf'])
      expect(geschrieben).not.toHaveProperty(feld)
    expect(a.stand.zeile).toMatchObject({
      folge: 17000,
      freigabe: { tag: '2026-11-10' },
      letzter_fehler: null
    })
    // The desk names the missing setup from `fehlend`; no second copy.
    expect(a.stand.zeile['letzter_hinweis']).toBeNull()
    expect(
      ergebnis.hinweise.some((h) => h.includes('nicht eingerichtet'))
    ).toBe(true)
    expect(a.stand.zeile['ergebnis']).toBe(ergebnis)
  })
})

describe('holeAbEinzeln — ein Lauf zur Zeit', () => {
  it('laesst einen zweiten Aufruf nichts tun, solange der erste laeuft', async () => {
    let oeffne: () => void = () => undefined
    const tor = new Promise<void>((r) => {
      oeffne = r
    })
    const innen = tuer((nach) => (nach === null ? FUNDE : LEER()))
    const t: Tuer = {
      urls: innen.urls,
      fetchImpl: async (url, init) => {
        await tor
        return innen.fetchImpl(url, init)
      }
    }
    const a = aufbau({ t })
    const erster = holeAbEinzeln(a.dienste)
    expect(abholungLaeuft()).toBe(true)

    const b = aufbau()
    const zweiter = await holeAbEinzeln(b.dienste)
    expect(zweiter.status).toBe('laeuft')
    expect(zweiter.hinweise).toEqual([LAUF_LAEUFT_HINWEIS])
    expect(b.t.urls).toEqual([])
    expect(b.m.aufrufe).toEqual([])
    expect(b.stand.schreibungen).toEqual([])

    oeffne()
    expect((await erster).status).toBe('ok')
    expect(abholungLaeuft()).toBe(false)
    // Free again: the next call runs.
    expect((await holeAbEinzeln(aufbau().dienste)).status).toBe('ok')
  })

  it('gibt den Lauf auch frei, wenn er wirft', async () => {
    const a = aufbau()
    a.dienste.stand.lies = async () => {
      throw new Error('Stand nicht lesbar')
    }
    await expect(holeAbEinzeln(a.dienste)).rejects.toThrow('Stand nicht lesbar')
    expect(abholungLaeuft()).toBe(false)
  })
})

describe('holeAb — der erste Lauf', () => {
  it('speichert die Funde, zaehlt, was es nicht speichern kann, und rueckt das Lesezeichen vor', async () => {
    const a = aufbau()
    const ergebnis = await holeAb(a.dienste)

    expect(ergebnis.status).toBe('ok')
    expect(ergebnis.neu).toBe(4)
    expect(ergebnis.ignoriert).toBe(1) // the tombstone for a kennung never held
    expect(ergebnis.ausgelassen).toBe(1)
    expect(ergebnis.ungueltig).toHaveLength(1)
    expect(ergebnis.ungueltig[0]).toContain('Folge 17680')
    expect(ergebnis.gelesen).toBe(7)
    // The bookmark passes the invalid and the omitted entry.
    expect(ergebnis.folge).toBe(17690)
    expect(a.stand.zeile['folge']).toBe(17690)
    expect(a.t.urls.some((u) => u.includes('/api/redaktion/v2/funde'))).toBe(
      true
    )
    expect(a.t.urls.find((u) => u.includes('/funde'))).not.toContain('nach=')

    const zeilen = new Map(a.funde.zeilen.map((z) => [z['kennung'], z]))
    expect([...zeilen.keys()].sort()).toEqual(
      [FLYER, SPERRUNG, POLIZEI, GESCHLOSSEN].sort()
    )
    expect(zeilen.get(SPERRUNG)).toMatchObject({
      gemeinde: 'g-1',
      entscheid: 'offen',
      veroeffentlicht_tag: '2026-11-08',
      quelle_url: 'https://www.facebook.com/groups/1000000001',
      neue_kommentare: 0
    })
    // Two covered municipalities and none named: on the desk without one.
    expect(zeilen.get(GESCHLOSSEN)).toMatchObject({
      gemeinde: null,
      quelle_url: 'https://www.facebook.com/groups/1000000002',
      quelle_sichtbarkeit: 'geschlossen'
    })
    expect(ergebnis.ohneGemeinde).toBe(1)
  })

  it('fuehrt die Quellen nach und nennt die unlesbare', async () => {
    const a = aufbau()
    const ergebnis = await holeAb(a.dienste)
    expect(a.quellen.zeilen.map((q) => q['kennung']).sort()).toEqual([
      'fb-gruppe:1000000001',
      'fb-gruppe:1000000002',
      'fb-gruppe:99'
    ])
    expect(
      a.quellen.zeilen.find((q) => q['kennung'] === 'fb-gruppe:1000000001')
    ).toMatchObject({ n_ausgelassen: 1, stand: 'gelesen' })
    expect(
      ergebnis.fehler.some((f) =>
        f.startsWith('Quelle profil:12345 nicht lesbar')
      )
    ).toBe(true)
    expect(ergebnis.hinweise).toContain(
      'Quelle fb-gruppe:99 fehlt in der Freigabe (Fehler beim Sammeln).'
    )
  })

  it('benotet je Gemeinde, schreibt Entwuerfe nur mit Gemeinde und laesst die Entscheide offen', async () => {
    const a = aufbau()
    const ergebnis = await holeAb(a.dienste)

    const sichtungen = a.m.aufrufe.filter((x) => x.art === 'sichtung')
    expect(sichtungen).toHaveLength(2)
    expect(sichtungen.map((s) => s.prompt.split('\n')[0]).sort()).toEqual([
      'Gemeinde: Musterdorf',
      'Gemeinde: keine zugeordnet (die Quelle passt zu keiner oder zu mehreren bespielten Gemeinden)'
    ])
    expect(sichtungen[0]?.prompt).toContain(
      'R1: Vermisste Tiere nie vorschlagen.'
    )
    expect(ergebnis.gesichtet).toBe(4)
    expect(ergebnis.vorschlaege).toBe(4)
    for (const z of a.funde.zeilen)
      expect(z).toMatchObject({
        vorschlag: true,
        vorschlag_wert: 3,
        vorschlag_begruendung: 'Betrifft viele im Dorf.',
        gesichtet_folge: z['folge'],
        entscheid: 'offen'
      })

    expect(ergebnis.entwuerfe).toBe(3)
    expect(a.meldungen.zeilen).toHaveLength(3)
    expect(a.meldungen.zeilen.every((m) => m['status'] === 'entwurf')).toBe(
      true
    )
    expect(a.meldungen.zeilen.every((m) => m['gemeinde'] === 'g-1')).toBe(true)
    expect(
      ergebnis.hinweise.some((h) => h.startsWith('1 Vorschlag ohne Gemeinde'))
    ).toBe(true)
  })

  it('schreibt den Stand mit Freigabe, Abruf und Ergebnis — ohne Hinweis am Tag der Freigabe', async () => {
    const a = aufbau()
    const ergebnis = await holeAb(a.dienste)
    expect(a.stand.zeile).toMatchObject({
      folge: 17690,
      letzter_abruf: MITTAG.toISOString(),
      letzter_hinweis: null,
      freigabe: { tag: '2026-11-11', folge: 18422 }
    })
    expect(a.stand.zeile['ergebnis']).toBe(ergebnis)
    expect(String(a.stand.zeile['letzter_fehler'])).toContain('profil:12345')
    // No wording of a private person in the stored result.
    const gespeichert = JSON.stringify(a.stand.zeile['ergebnis'])
    for (const verboten of ['Sandra', 'Marc', 'Wasserleitungsbruch', 'Kreisel'])
      expect(gespeichert).not.toContain(verboten)
  })

  it('sagt es, wenn die Freigabe nicht von heute ist', async () => {
    const a = aufbau({ jetzt: new Date('2026-11-12T12:00:00+01:00') })
    const ergebnis = await holeAb(a.dienste)
    const satz =
      'Heute noch keine Freigabe des Buschtelefons (letzte: 11. November 2026).'
    expect(ergebnis.hinweise).toContain(satz)
    expect(a.stand.zeile['letzter_hinweis']).toBe(satz)
    expect(freigabeHinweis({ tag: '2026-11-11' }, '2026-11-11')).toBeNull()
  })

  it('rechnet «heute» in Zuerich: 23:30 UTC ist schon der naechste Tag', async () => {
    const a = aufbau({ jetzt: new Date('2026-11-10T23:30:00Z') })
    const ergebnis = await holeAb(a.dienste)
    expect(
      ergebnis.hinweise.some((h) => h.startsWith('Heute noch keine Freigabe'))
    ).toBe(false)
  })
})

describe('holeAb — der zweite Lauf', () => {
  it('fragt ab dem Lesezeichen und aendert nichts', async () => {
    const a = aufbau({ stand: { folge: '17690' } })
    const ergebnis = await holeAb(a.dienste)
    expect(a.t.urls.find((u) => u.includes('/funde'))).toContain('nach=17690')
    expect(ergebnis).toMatchObject({
      gelesen: 0,
      neu: 0,
      ersetzt: 0,
      folge: 17690
    })
    expect(a.funde.zeilen).toHaveLength(0)
    expect(a.m.aufrufe).toHaveLength(0)
  })

  it('kostet nichts, wenn dieselbe Seite noch einmal kommt', async () => {
    const a = aufbau()
    await holeAb(a.dienste)
    const aufrufeDavor = a.m.aufrufe.length
    const zweite = aufbau({
      funde: a.funde.zeilen,
      meldungen: a.meldungen.zeilen,
      t: tuer(() => FUNDE)
    })
    const ergebnis = await holeAb(zweite.dienste)
    expect(ergebnis).toMatchObject({ neu: 0, ersetzt: 0, unveraendert: 4 })
    expect(zweite.m.aufrufe).toHaveLength(0)
    expect(aufrufeDavor).toBeGreaterThan(0)
    expect(zweite.meldungen.zeilen).toHaveLength(3)
  })
})

describe('holeAb — ein unentschiedener Fund wird ersetzt, ein entschiedener bleibt', () => {
  it('ersetzt, setzt die Sichtung zurueck, zaehlt neue Kommentare und verwirft den unberuehrten Entwurf', async () => {
    const alt = bestand(SPERRUNG, {
      folge: '17500',
      text: 'Alter Stand',
      kommentare: [fund(SPERRUNG).kommentare[0]],
      vorschlag: true,
      vorschlag_wert: 4,
      vorschlag_begruendung: 'alt',
      gesichtet_folge: '17500',
      entwurf_bedenken: 'alte Bedenken'
    })
    const a = aufbau({
      funde: [alt],
      meldungen: [
        {
          id: 'm-1',
          buschtelefon_fund: 'alt-2',
          status: 'entwurf',
          date_updated: null,
          date_created: '2026-11-10T11:00:00Z'
        }
      ],
      m: modell({ stufe: () => 2 })
    })
    const ergebnis = await holeAb(a.dienste)

    expect(ergebnis.ersetzt).toBe(1)
    expect(ergebnis.neu).toBe(3)
    const zeile = a.funde.finde('alt-2')
    expect(zeile).toMatchObject({
      folge: 17650,
      text: fund(SPERRUNG).text,
      neue_kommentare: 2,
      aktualisiert_am: MITTAG.toISOString(),
      // Re-sighted in the same run, with the new grade.
      vorschlag_wert: 2,
      vorschlag: false,
      gesichtet_folge: 17650,
      entwurf_bedenken: null,
      gemeinde: 'g-1'
    })
    expect(a.meldungen.finde('m-1')).toMatchObject({
      status: 'verworfen',
      fehler: ENTWURF_VERALTET
    })
  })

  it('laesst einen von der Redaktion bearbeiteten Entwurf stehen und sagt es auf der Zeile', async () => {
    const a = aufbau({
      funde: [bestand(SPERRUNG, { folge: 17500 })],
      meldungen: [
        {
          id: 'm-1',
          buschtelefon_fund: 'alt-2',
          status: 'entwurf',
          date_updated: '2026-11-10T15:00:00Z',
          date_created: '2026-11-10T11:00:00Z'
        }
      ]
    })
    await holeAb(a.dienste)
    expect(a.meldungen.finde('m-1')['status']).toBe('entwurf')
    expect(a.funde.finde('alt-2')['hinweise']).toContain(HINWEIS_ENTWURF_AELTER)
    // No second article beside the one she is working on.
    expect(
      a.meldungen.zeilen.filter((m) => m['buschtelefon_fund'] === 'alt-2')
    ).toHaveLength(1)
  })

  it('behaelt eine von Hand gesetzte Gemeinde', async () => {
    const a = aufbau({
      funde: [bestand(SPERRUNG, { folge: 17500, gemeinde: 'g-2' })]
    })
    await holeAb(a.dienste)
    expect(a.funde.finde('alt-2')['gemeinde']).toBe('g-2')
  })

  it('laesst einen entschiedenen Fund, wie er beim Entscheid war', async () => {
    const alt = bestand(SPERRUNG, {
      folge: 17500,
      text: 'Stand beim Entscheid',
      entscheid: 'uebernommen',
      entschieden_am: '2026-11-10T14:00:00+01:00'
    })
    const a = aufbau({
      funde: [alt],
      meldungen: [
        {
          id: 'm-1',
          buschtelefon_fund: 'alt-2',
          status: 'entwurf',
          date_updated: null
        }
      ]
    })
    const ergebnis = await holeAb(a.dienste)
    expect(ergebnis.entschieden).toBe(1)
    expect(a.funde.finde('alt-2')).toMatchObject({
      text: 'Stand beim Entscheid',
      folge: 17500
    })
    expect(a.meldungen.finde('m-1')['status']).toBe('entwurf')
  })

  it('ignoriert die Wiederlieferung eines Funds mit geleertem Material', async () => {
    const alt = bestand(SPERRUNG, {
      folge: 17500,
      entscheid: 'verfallen',
      ...leereMaterial('2026-11-01T12:00:00Z')
    })
    const a = aufbau({ funde: [alt] })
    const ergebnis = await holeAb(a.dienste)
    expect(ergebnis.ignoriert).toBe(2)
    expect(a.funde.finde('alt-2')).toMatchObject({
      text: null,
      entscheid: 'verfallen',
      folge: 17500
    })
  })
})

describe('holeAb — entfernt', () => {
  it('leert das Material, verwirft die unpublizierte Meldung, leert den Hinweis und laesst die publizierte stehen', async () => {
    const alt = bestand(SPERRUNG, {
      id: 'alt-5',
      kennung: GRABSTEIN,
      folge: 17400,
      entscheid: 'uebernommen',
      entschieden_am: '2026-11-10T14:00:00+01:00',
      entwurf_bedenken: 'x'
    })
    const a = aufbau({
      funde: [alt],
      meldungen: [
        {
          id: 'm-entwurf',
          buschtelefon_fund: 'alt-5',
          status: 'entwurf',
          date_updated: '2026-11-10T15:00:00Z'
        },
        {
          id: 'm-pruefung',
          buschtelefon_fund: 'alt-5',
          status: 'in_pruefung',
          date_updated: null
        },
        {
          id: 'm-publiziert',
          buschtelefon_fund: 'alt-5',
          status: 'publiziert',
          text: 'Publizierter Text',
          date_updated: null
        },
        {
          id: 'm-fremd',
          buschtelefon_fund: 'anderer',
          status: 'entwurf',
          date_updated: null
        }
      ],
      hinweise: [
        {
          id: 'h-1',
          buschtelefon_fund: 'alt-5',
          status: 'offen',
          quelltext: 'Wortlaut'
        }
      ]
    })
    const ergebnis = await holeAb(a.dienste)

    expect(ergebnis.entfernt).toBe(1)
    const zeile = a.funde.finde('alt-5')
    expect(zeile).toMatchObject({
      status: 'entfernt',
      folge: 17670,
      text: null,
      kommentare: [],
      bilder: [],
      autor_vorname: null,
      material_geloescht_am: MITTAG.toISOString(),
      entwurf_bedenken: null,
      // The decision stays: it is the memory.
      entscheid: 'uebernommen',
      kennung: GRABSTEIN
    })
    expect((zeile['hinweise'] as string[])[0]).toContain(
      HINWEIS_NICHT_AUFFINDBAR
    )
    expect(a.meldungen.finde('m-entwurf')['status']).toBe('verworfen')
    expect(a.meldungen.finde('m-pruefung')['status']).toBe('verworfen')
    expect(String(a.meldungen.finde('m-entwurf')['fehler'])).toContain(
      'nicht mehr auffindbar'
    )
    // A deletion counts only while the article is unpublished.
    expect(a.meldungen.finde('m-publiziert')).toMatchObject({
      status: 'publiziert',
      text: 'Publizierter Text'
    })
    expect(a.meldungen.finde('m-fremd')['status']).toBe('entwurf')
    expect(a.hinweise.finde('h-1')['quelltext']).toBeNull()
  })

  it('beendet einen unentschiedenen Fund', async () => {
    const a = aufbau({
      funde: [
        bestand(SPERRUNG, { id: 'alt-5', kennung: GRABSTEIN, folge: 17400 })
      ]
    })
    await holeAb(a.dienste)
    expect(a.funde.finde('alt-5')).toMatchObject({
      status: 'entfernt',
      entscheid: 'verfallen'
    })
    // No Sichtung and no draft for a removed find.
    expect(a.m.aufrufe.every((x) => !x.prompt.includes('alt-5'))).toBe(true)
    expect(
      a.meldungen.zeilen.every((m) => m['buschtelefon_fund'] !== 'alt-5')
    ).toBe(true)
  })
})

describe('holeAb — was schiefgeht, wird genannt und haelt nichts auf', () => {
  it('ueberspringt einen Fund, der sich nicht speichern laesst, und rueckt das Lesezeichen trotzdem vor', async () => {
    const a = aufbau({
      stoerung: (payload) => {
        if (payload['kennung'] === FLYER)
          throw new Error('value too long for type character varying(20)')
      }
    })
    const ergebnis = await holeAb(a.dienste)
    expect(ergebnis.neu).toBe(3)
    expect(
      ergebnis.fehler.some(
        (f) =>
          f.includes(FLYER) &&
          f.includes('Folge 17601') &&
          f.includes('übersprungen')
      )
    ).toBe(true)
    expect(ergebnis.folge).toBe(17690)
    expect(a.stand.zeile['folge']).toBe(17690)
    expect(ergebnis.status).toBe('ok')
  })

  it('schreibt das Lesezeichen nach jeder Seite', async () => {
    const alle = (FUNDE['funde'] as Zeile[]).filter(
      (f) => f['status'] === 'aktiv' && f['kanal'] === 'facebook'
    )
    const seite = (funde: Zeile[], weiter: number | null) => ({
      ...LEER(),
      funde,
      weiter
    })
    const t = tuer((nach) => {
      if (nach === null) return seite(alle.slice(0, 2), 17650)
      if (nach === 17650)
        return [500, { format: 'buschtelefon-redaktion/2', fehler: 'kaputt' }]
      return LEER()
    })
    const a = aufbau({ t })
    const ergebnis = await holeAb(a.dienste)
    expect(ergebnis.neu).toBe(2)
    expect(a.stand.schreibungen[0]).toEqual({ folge: 17650 })
    expect(ergebnis.folge).toBe(17650)
    expect(
      ergebnis.fehler.some((f) =>
        f.startsWith('Abholung nach 1 Seiten abgebrochen')
      )
    ).toBe(true)
  })

  it('holt nach «stand_zu_alt» einmal alles und laesst verfallen, was die Tuer nicht mehr haelt', async () => {
    const verschwunden = bestand(SPERRUNG, {
      id: 'alt-9',
      kennung: 'fb:1_9',
      folge: 100
    })
    const t = tuer((nach) =>
      nach === null
        ? FUNDE
        : [
            410,
            {
              format: 'buschtelefon-redaktion/2',
              fehler: 'stand_zu_alt',
              verworfen_bis: 500
            }
          ]
    )
    const a = aufbau({
      t,
      stand: { folge: 120 },
      funde: [verschwunden],
      meldungen: [
        {
          id: 'm-9',
          buschtelefon_fund: 'alt-9',
          status: 'entwurf',
          date_updated: null
        }
      ]
    })
    const ergebnis = await holeAb(a.dienste)
    const abrufe = a.t.urls.filter((u) => u.includes('/funde'))
    expect(abrufe).toHaveLength(2)
    expect(abrufe[0]).toContain('nach=120')
    expect(abrufe[1]).not.toContain('nach=')
    expect(ergebnis.neu).toBe(4)
    expect(ergebnis.folge).toBe(17690)
    expect(a.funde.finde('alt-9')).toMatchObject({
      entscheid: 'verfallen',
      text: null,
      kennung: 'fb:1_9'
    })
    expect(a.meldungen.finde('m-9')['status']).toBe('verworfen')
    expect(ergebnis.aufgeraeumt.verfallen).toBe(1)
    expect(ergebnis.hinweise.some((h) => h.includes('Vorhaltefenster'))).toBe(
      true
    )
  })

  it('nimmt «Freigabe laeuft» als Hinweis, nicht als Fehler', async () => {
    const t = tuer(() => [
      503,
      {
        format: 'buschtelefon-redaktion/2',
        fehler: 'nicht_bereit',
        grund: 'freigabe_laeuft'
      }
    ])
    const a = aufbau({ t })
    const ergebnis = await holeAb(a.dienste)
    expect(ergebnis.status).toBe('ok')
    expect(ergebnis.fehler.filter((f) => f.startsWith('Abholung'))).toEqual([])
    expect(a.stand.zeile['letzter_hinweis']).toEqual(expect.any(String))
    expect(ergebnis.hinweise).toContain(a.stand.zeile['letzter_hinweis'])
  })

  it('pflegt den Bestand auch, wenn die Tuer nicht antwortet', async () => {
    const alt = bestand(SPERRUNG, {
      erstmals_freigegeben_am: '2026-10-20T11:52:00+02:00',
      folge: 100
    })
    const t: Tuer = {
      urls: [],
      fetchImpl: async () => {
        throw new Error('ECONNREFUSED')
      }
    }
    const a = aufbau({
      t,
      funde: [alt],
      stand: { folge: 100 },
      meldungen: [
        {
          id: 'm-1',
          buschtelefon_fund: 'alt-2',
          status: 'entwurf',
          date_updated: null
        }
      ]
    })
    const ergebnis = await holeAb(a.dienste)
    expect(ergebnis.status).toBe('fehlgeschlagen')
    expect(
      ergebnis.fehler.some((f) => f.startsWith('Abholung fehlgeschlagen'))
    ).toBe(true)
    expect(
      ergebnis.fehler.some((f) => f.startsWith('Quellenliste nicht gelesen'))
    ).toBe(true)
    // 22 days old and undecided: lapsed, emptied, draft gone — the row stays.
    expect(ergebnis.aufgeraeumt.verfallen).toBe(1)
    expect(a.funde.finde('alt-2')).toMatchObject({
      entscheid: 'verfallen',
      text: null,
      kennung: SPERRUNG
    })
    expect(a.meldungen.finde('m-1')['status']).toBe('verworfen')
    expect(a.stand.zeile['folge']).toBe(100)
    expect(a.stand.zeile['letzter_fehler']).toEqual(
      expect.stringContaining('Abholung fehlgeschlagen')
    )
    expect(JSON.stringify(ergebnis)).not.toContain('geheim')
  })

  it('laesst die Zeilen eines gescheiterten Sichtungspakets unbenotet und nennt es', async () => {
    const m = modell()
    const kaputt: Modell = {
      aufrufe: m.aufrufe,
      send: async (body) => {
        if (JSON.stringify(body.system).includes('Du sichtest'))
          throw new Error('529 overloaded')
        return m.send(body)
      }
    }
    const a = aufbau({ m: kaputt })
    const ergebnis = await holeAb(a.dienste)
    expect(ergebnis.gesichtet).toBe(0)
    expect(
      ergebnis.fehler.some((f) =>
        f.includes('Musterdorf: Sichtung fehlgeschlagen')
      )
    ).toBe(true)
    expect(ergebnis.fehler.join(' ')).not.toContain('529 overloaded')
    expect(
      a.funde.zeilen.every(
        (z) =>
          (z['vorschlag'] ?? null) === null &&
          (z['gesichtet_folge'] ?? null) === null
      )
    ).toBe(true)
    expect(ergebnis.entwuerfe).toBe(0)
  })

  it('deckelt die Entwuerfe und nennt die wartenden', async () => {
    const a = aufbau()
    const ergebnis = await holeAb(a.dienste, { entwuerfe: 1 })
    expect(ergebnis.entwuerfe).toBe(1)
    expect(ergebnis.wartend).toHaveLength(2)
    expect(ergebnis.hinweise.some((h) => h.includes('Deckel 1 je Lauf'))).toBe(
      true
    )
  })
})

describe('Sichtung und Schwelle', () => {
  it('sichtet, was nie benotet wurde oder dessen Folge weitergerueckt ist', () => {
    const z = bestand(SPERRUNG) as never as Parameters<
      typeof brauchtSichtung
    >[0]
    expect(brauchtSichtung({ ...z, gesichtet_folge: null })).toBe(true)
    expect(
      brauchtSichtung({ ...z, folge: '17650', gesichtet_folge: '17650' })
    ).toBe(false)
    // As strings '9000' > '17650' — compared as numbers it is not.
    expect(
      brauchtSichtung({ ...z, folge: '17650', gesichtet_folge: '9000' })
    ).toBe(true)
    expect(
      brauchtSichtung({
        ...z,
        ...(leereMaterial('2026-11-11T00:00:00Z') as object),
        gesichtet_folge: null
      })
    ).toBe(false)
  })

  it('macht aus Stufen unter der Schwelle keine Vorschlaege und schreibt ihnen keinen Entwurf', async () => {
    const a = aufbau({
      m: modell({
        stufe: (eintrag) => (eintrag.includes('Hauptstrasse') ? 4 : 2)
      })
    })
    const ergebnis = await holeAb(a.dienste)
    expect(ergebnis.gesichtet).toBe(4)
    expect(ergebnis.vorschlaege).toBe(1)
    expect(ergebnis.entwuerfe).toBe(1)
    expect(a.funde.zeilen.filter((z) => z['vorschlag'] === true)).toHaveLength(
      1
    )
    // Nothing is filtered: every row is still there, graded.
    expect(a.funde.zeilen.every((z) => z['vorschlag_wert'] !== null)).toBe(true)
  })

  it('wendet eine verstellte Schwelle auf benotete offene Zeilen an', async () => {
    const funde = sammlung('funde', [
      { id: 'a', entscheid: 'offen', vorschlag: false, vorschlag_wert: 2 },
      { id: 'b', entscheid: 'offen', vorschlag: true, vorschlag_wert: 3 },
      { id: 'c', entscheid: 'offen', vorschlag: null, vorschlag_wert: null },
      { id: 'd', entscheid: 'abgelehnt', vorschlag: false, vorschlag_wert: 2 }
    ])
    expect(await gleicheSchwelleAb(funde, 2)).toBe(1)
    expect(funde.finde('a')['vorschlag']).toBe(true)
    expect(funde.finde('c')['vorschlag']).toBeNull()
    expect(funde.finde('d')['vorschlag']).toBe(false)
    expect(await gleicheSchwelleAb(funde, 4)).toBe(2)
  })

  it('gibt die Beispiele der Gemeinde in den User-Turn — nie fuer Funde ohne Gemeinde', async () => {
    const gefragt: string[] = []
    const a = aufbau()
    a.dienste.ladeSignale = async (gemeindeId) => {
      gefragt.push(gemeindeId)
      return {
        entscheide: [
          {
            titel: 'Sperrung Dorfplatz',
            rubrikName: 'Du bisch vo Musterdorf',
            entscheid: 'uebernommen',
            grund: null
          }
        ],
        rahmen: {}
      }
    }
    await holeAb(a.dienste)
    expect(gefragt).toEqual(['g-1'])
    const musterdorf = a.m.aufrufe.find(
      (x) => x.art === 'sichtung' && x.prompt.startsWith('Gemeinde: Musterdorf')
    )
    expect(musterdorf?.prompt).toContain('Sperrung Dorfplatz')
  })

  it('reicht nur weiter, wenn eine scharf gestellte Regel zitiert ist und der Dienst da ist', async () => {
    const weitergereicht: string[] = []
    const m = modell()
    const mitEmpfehlung: Modell = {
      aufrufe: m.aufrufe,
      send: async (body) => {
        const antwort = await m.send(body)
        if (!JSON.stringify(body.system).includes('Du sichtest')) return antwort
        const block = antwort.content[0] as { text: string }
        const json = JSON.parse(block.text) as { urteile: Zeile[] }
        for (const u of json.urteile) {
          u['empfehlung'] = 'weiterreichen'
          u['empfehlung_regel'] = 'R1'
        }
        block.text = JSON.stringify(json)
        return antwort
      }
    }
    const a = aufbau({ m: mitEmpfehlung })
    a.dienste.reicheAutomatischWeiter = async (id) => {
      weitergereicht.push(id)
    }
    // R1 is a plain hint: the recommendation must not act.
    await holeAb(a.dienste)
    expect(weitergereicht).toEqual([])

    const scharf = aufbau({ m: mitEmpfehlung })
    scharf.dienste.regelzeilen = [
      { ...scharf.dienste.regelzeilen[0]!, wirkung: 'weiterreichen' }
    ]
    scharf.dienste.reicheAutomatischWeiter = async (id) => {
      weitergereicht.push(id)
    }
    const ergebnis = await holeAb(scharf.dienste)
    expect(weitergereicht).toHaveLength(4)
    expect(
      ergebnis.hinweise.some((h) =>
        h.includes('an die Chefredaktion weitergereicht')
      )
    ).toBe(true)
  })
})

describe('raeumeAuf', () => {
  it('leert nach den Fristen und loescht nie eine Zeile', async () => {
    const funde = sammlung('funde', [
      bestand(SPERRUNG, {
        id: 'offen-alt',
        erstmals_freigegeben_am: '2026-10-25T11:52:00+02:00'
      }),
      bestand(SPERRUNG, {
        id: 'offen-neu',
        erstmals_freigegeben_am: '2026-11-09T11:52:00+01:00'
      }),
      bestand(SPERRUNG, {
        id: 'abgelehnt',
        entscheid: 'abgelehnt',
        ablehnungsgrund: 'unbestaetigt',
        entschieden_am: '2026-11-10T10:00:00+01:00'
      }),
      bestand(SPERRUNG, {
        id: 'publiziert',
        entscheid: 'uebernommen',
        entschieden_am: '2026-11-05T10:00:00+01:00'
      }),
      bestand(SPERRUNG, {
        id: 'in-arbeit',
        entscheid: 'uebernommen',
        entschieden_am: '2026-11-05T10:00:00+01:00'
      }),
      bestand(SPERRUNG, {
        id: 'beurteilt',
        entscheid: 'weitergereicht',
        entschieden_am: '2026-11-05T10:00:00+01:00'
      }),
      bestand(SPERRUNG, {
        id: 'bei-chef',
        entscheid: 'weitergereicht',
        entschieden_am: '2026-11-05T10:00:00+01:00'
      })
    ])
    const meldungen = sammlung('meldungen', [
      {
        id: 'm-1',
        buschtelefon_fund: 'publiziert',
        status: 'publiziert',
        publiziert_am: '2026-11-06T09:00:00+01:00',
        date_updated: null,
        date_created: null
      },
      {
        id: 'm-2',
        buschtelefon_fund: 'in-arbeit',
        status: 'entwurf',
        publiziert_am: null,
        date_updated: null,
        date_created: null
      }
    ])
    const hinweise = sammlung('hinweise', [
      { id: 'h-1', buschtelefon_fund: 'beurteilt', status: 'kein_hinweis' },
      { id: 'h-2', buschtelefon_fund: 'bei-chef', status: 'offen' }
    ])
    const ergebnis = await raeumeAuf(
      { funde, meldungen, hinweise, logger: STILL },
      '2026-11-11',
      '2026-11-11T11:00:00.000Z'
    )

    expect(ergebnis).toEqual({ verfallen: 1, geleert: 3, fehler: [] })
    expect(funde.zeilen).toHaveLength(7)
    expect(funde.finde('offen-alt')).toMatchObject({
      entscheid: 'verfallen',
      text: null,
      kommentare: []
    })
    expect(funde.finde('offen-neu')).toMatchObject({
      entscheid: 'offen',
      material_geloescht_am: null
    })
    // Rejected: comments at once, the wording stays as a lesson for 30 days.
    expect(funde.finde('abgelehnt')).toMatchObject({
      kommentare: [],
      ablehnungsgrund: 'unbestaetigt',
      material_geloescht_am: null
    })
    expect(funde.finde('abgelehnt')['text']).toBe(fund(SPERRUNG).text)
    expect(funde.finde('publiziert')).toMatchObject({
      kommentare: [],
      material_geloescht_am: null
    })
    expect((funde.finde('in-arbeit')['kommentare'] as unknown[]).length).toBe(3)
    expect(funde.finde('beurteilt')).toMatchObject({
      text: null,
      material_geloescht_am: '2026-11-11T11:00:00.000Z'
    })
    expect(funde.finde('bei-chef')['text']).toBe(fund(SPERRUNG).text)
  })

  it('liest den Stand der Meldung: in Arbeit schlaegt fertig', () => {
    const m = (status: string, publiziert_am: string | null = null) => ({
      status,
      publiziert_am,
      date_updated: '2026-11-07T10:00:00Z',
      date_created: '2026-11-06T10:00:00Z'
    })
    expect(meldungStand([])).toEqual({ status: null, abgeschlossenAm: null })
    expect(meldungStand([m('verworfen'), m('entwurf')]).status).toBe('entwurf')
    expect(
      meldungStand([m('verworfen'), m('publiziert', '2026-11-08T09:00:00Z')])
    ).toEqual({
      status: 'publiziert',
      abgeschlossenAm: '2026-11-08T09:00:00Z'
    })
    expect(meldungStand([m('verworfen')])).toEqual({
      status: 'verworfen',
      abgeschlossenAm: '2026-11-07T10:00:00Z'
    })
  })
})

describe('quelleFelder', () => {
  it('bildet eine Quelle auf ihre Zeile ab', () => {
    const [quelle] = liesQuellenAntwort(fixture('quellen.json')).quellen
    if (quelle === undefined) throw new Error('keine Quelle')
    const felder = quelleFelder(quelle)
    expect(felder).toMatchObject({
      kennung: 'fb-gruppe:1000000001',
      kanal: 'facebook',
      art: 'gruppe',
      url: 'https://www.facebook.com/groups/1000000001',
      sichtbarkeit: 'oeffentlich',
      stand: 'gelesen'
    })
    // Not the door's number: the run counts it.
    expect(felder).not.toHaveProperty('n_ausgelassen')
  })
})

// ---------------------------------------------------------------------------
// The review's findings of 11 November 2026, each as a scenario of the run
// ---------------------------------------------------------------------------

/** A raw find of the fixture, as the door delivers it, with changes. */
function roh(kennung: string, mehr: Zeile = {}): Zeile {
  const f = (FUNDE['funde'] as Zeile[]).find((x) => x['kennung'] === kennung)
  if (f === undefined) throw new Error(`kein roher Fund ${kennung}`)
  return { ...JSON.parse(JSON.stringify(f)), ...mehr }
}

function grabstein(kennung: string, folge: number, grund: string): Zeile {
  return {
    kennung,
    folge,
    status: 'entfernt',
    entfernt_grund: grund,
    aenderung: ['status'],
    erstmals_freigegeben_am: '2026-11-09T11:51:55+01:00',
    geaendert_am: '2026-11-11T11:52:10+01:00',
    kanal: 'facebook',
    quelle: 'fb-gruppe:1000000001',
    gemeinden_bfs: [2761]
  }
}

function seite(
  funde: Zeile[],
  weiter: number | null = null,
  ausgelassen: Zeile[] = []
): Zeile {
  return { ...LEER(), funde, ausgelassen, weiter }
}

/** The door delivers `erste` once, then nothing new. */
function einmal(erste: Zeile): Tuer {
  return tuer((nach) => (nach === null ? erste : LEER()))
}

function antwortText(text: string): Anthropic.Message {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-5',
    content: [{ type: 'text', text, citations: null }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 }
  } as unknown as Anthropic.Message
}

describe('holeAb — nicht erreichbar', () => {
  it('laesst einem offenen Vorschlag Stufe und Entwurf, wenn nur der Status rueckt', async () => {
    const alt = bestand(SPERRUNG, {
      folge: 17500,
      vorschlag: true,
      vorschlag_wert: 4,
      vorschlag_begruendung: 'Sperrung betrifft viele.',
      gesichtet_folge: 17500
    })
    const a = aufbau({
      funde: [alt],
      t: einmal(
        seite([
          roh(SPERRUNG, {
            folge: 17700,
            status: 'nicht_erreichbar',
            aenderung: ['status']
          })
        ])
      ),
      meldungen: [
        {
          id: 'm-1',
          buschtelefon_fund: 'alt-2',
          status: 'entwurf',
          date_updated: null,
          date_created: '2026-11-10T12:05:00Z'
        }
      ]
    })
    const ergebnis = await holeAb(a.dienste)

    expect(a.funde.finde('alt-2')).toMatchObject({
      status: 'nicht_erreichbar',
      folge: 17700,
      vorschlag: true,
      vorschlag_wert: 4,
      vorschlag_begruendung: 'Sperrung betrifft viele.',
      // Graded state moves with the folge: no new Sichtung for a login wall.
      gesichtet_folge: 17700,
      text: fund(SPERRUNG).text,
      entscheid: 'offen'
    })
    expect(a.funde.finde('alt-2')['hinweise']).toContain(
      HINWEIS_NICHT_ERREICHBAR
    )
    expect(a.meldungen.finde('m-1')['status']).toBe('entwurf')
    expect(a.meldungen.zeilen).toHaveLength(1)
    expect(a.m.aufrufe).toEqual([])
    expect(ergebnis).toMatchObject({ unveraendert: 1, ersetzt: 0 })
  })

  it('benotet einen Fund, der schon hinter der Anmeldewand ankommt, und schreibt ihm den Entwurf', async () => {
    const a = aufbau({
      t: einmal(seite([roh(SPERRUNG, { status: 'nicht_erreichbar' })]))
    })
    const ergebnis = await holeAb(a.dienste)
    expect(ergebnis.gesichtet).toBe(1)
    expect(a.funde.zeilen[0]).toMatchObject({
      status: 'nicht_erreichbar',
      vorschlag: true
    })
    expect(ergebnis.entwuerfe).toBe(1)
  })

  it('nimmt den Hinweis wieder ab, wenn das Original wieder aufgeht — ohne neue Sichtung', async () => {
    const alt = bestand(SPERRUNG, {
      folge: 17700,
      status: 'nicht_erreichbar',
      hinweise: [HINWEIS_NICHT_ERREICHBAR],
      vorschlag: true,
      vorschlag_wert: 3,
      gesichtet_folge: 17700
    })
    const a = aufbau({
      funde: [alt],
      t: einmal(seite([roh(SPERRUNG, { folge: 17800, aenderung: ['status'] })]))
    })
    await holeAb(a.dienste)
    expect(a.funde.finde('alt-2')).toMatchObject({
      status: 'aktiv',
      folge: 17800,
      gesichtet_folge: 17800,
      vorschlag_wert: 3,
      hinweise: null
    })
    expect(a.m.aufrufe.filter((x) => x.art === 'sichtung')).toEqual([])
  })
})

describe('holeAb — Entfernung, Wiederkehr und was sie nach sich zieht', () => {
  it('belebt einen an der Quelle geloeschten Fund wieder, der unentschieden war', async () => {
    const erst = aufbau({
      funde: [bestand(SPERRUNG, { folge: 17500 })],
      t: einmal(seite([grabstein(SPERRUNG, 17600, 'an_der_quelle_geloescht')]))
    })
    await holeAb(erst.dienste)
    expect(erst.funde.finde('alt-2')).toMatchObject({
      status: 'entfernt',
      entfernt_grund: 'an_der_quelle_geloescht',
      entscheid: 'verfallen',
      text: null
    })

    const dann = aufbau({
      funde: erst.funde.zeilen,
      jetzt: new Date('2026-11-12T12:00:00+01:00'),
      t: einmal(seite([roh(SPERRUNG, { folge: 17800, aenderung: ['neu'] })]))
    })
    const ergebnis = await holeAb(dann.dienste)
    expect(dann.funde.finde('alt-2')).toMatchObject({
      status: 'aktiv',
      entscheid: 'offen',
      entschieden_am: null,
      material_geloescht_am: null,
      entfernt_grund: null,
      text: fund(SPERRUNG).text,
      folge: 17800,
      // Re-sighted in the same run.
      vorschlag_wert: 3,
      gesichtet_folge: 17800
    })
    expect(dann.funde.finde('alt-2')['hinweise']).toContain(HINWEIS_WIEDER_DA)
    expect(ergebnis.ersetzt).toBe(1)
    expect(ergebnis.hinweise.some((h) => h.includes('wieder offen'))).toBe(true)
  })

  it('belebt nichts wieder, wenn nach der Entfernung an der Quelle ein Loeschbegehren folgt', async () => {
    const erst = aufbau({
      funde: [bestand(SPERRUNG, { folge: 17500 })],
      t: einmal(seite([grabstein(SPERRUNG, 17600, 'an_der_quelle_geloescht')]))
    })
    await holeAb(erst.dienste)
    const zweit = aufbau({
      funde: erst.funde.zeilen,
      jetzt: new Date('2026-11-11T12:00:00+01:00'),
      t: einmal(seite([grabstein(SPERRUNG, 17700, 'loeschbegehren')]))
    })
    await holeAb(zweit.dienste)
    expect(zweit.funde.finde('alt-2')).toMatchObject({
      entfernt_grund: 'loeschbegehren',
      folge: 17700
    })
    const dann = aufbau({
      funde: zweit.funde.zeilen,
      jetzt: new Date('2026-11-12T12:00:00+01:00'),
      t: einmal(seite([roh(SPERRUNG, { folge: 17800, aenderung: ['neu'] })]))
    })
    const ergebnis = await holeAb(dann.dienste)
    expect(ergebnis.ignoriert).toBe(1)
    expect(dann.funde.finde('alt-2')).toMatchObject({
      status: 'entfernt',
      text: null
    })
  })

  it('belebt einen Fund nicht wieder, den die Chefredaktion zurueckgab und der dann an der Quelle verschwand', async () => {
    const erst = aufbau({
      funde: [
        bestand(SPERRUNG, {
          folge: 17500,
          entscheid: 'offen',
          // «Zurück auf den Tisch»: open again, with the hand-back stamp.
          entschieden_am: '2026-11-09T15:00:00+01:00'
        })
      ],
      t: einmal(seite([grabstein(SPERRUNG, 17600, 'an_der_quelle_geloescht')]))
    })
    await holeAb(erst.dienste)
    expect(erst.funde.finde('alt-2')).toMatchObject({
      entscheid: 'verfallen',
      entschieden_am: '2026-11-09T15:00:00+01:00'
    })
    const dann = aufbau({
      funde: erst.funde.zeilen,
      jetzt: new Date('2026-11-12T12:00:00+01:00'),
      t: einmal(seite([roh(SPERRUNG, { folge: 17800, aenderung: ['neu'] })]))
    })
    const ergebnis = await holeAb(dann.dienste)
    expect(ergebnis.ignoriert).toBe(1)
    expect(dann.funde.finde('alt-2')['status']).toBe('entfernt')
  })

  it('belebt nach einem Loeschbegehren nichts wieder', async () => {
    const erst = aufbau({
      funde: [bestand(SPERRUNG, { folge: 17500 })],
      t: einmal(seite([grabstein(SPERRUNG, 17600, 'loeschbegehren')]))
    })
    await holeAb(erst.dienste)
    const dann = aufbau({
      funde: erst.funde.zeilen,
      t: einmal(seite([roh(SPERRUNG, { folge: 17800, aenderung: ['neu'] })]))
    })
    const ergebnis = await holeAb(dann.dienste)
    expect(ergebnis.ignoriert).toBe(1)
    expect(dann.funde.finde('alt-2')).toMatchObject({
      status: 'entfernt',
      entfernt_grund: 'loeschbegehren',
      text: null,
      entscheid: 'verfallen'
    })
  })

  it('vollendet eine halbe Entfernung im naechsten Lauf, ohne dass der Grabstein wiederkommt', async () => {
    const a = aufbau({
      funde: [
        bestand(SPERRUNG, {
          id: 'alt-5',
          kennung: GRABSTEIN,
          folge: 17400,
          entscheid: 'uebernommen',
          entschieden_am: '2026-11-10T14:00:00+01:00'
        })
      ],
      meldungen: [
        {
          id: 'm-pruefung',
          buschtelefon_fund: 'alt-5',
          status: 'in_pruefung',
          date_updated: null
        }
      ],
      hinweise: [
        {
          id: 'h-alt',
          buschtelefon_fund: 'alt-5',
          status: 'offen',
          titel: 'Weiss jemand, warum …',
          quelltext: 'Wortlaut mit Sandra'
        }
      ]
    })
    let kaputt = true
    const meldungUpdate = a.meldungen.updateOne
    a.meldungen.updateOne = async (id, payload) => {
      if (kaputt) throw new Error('Statuswechsel verweigert')
      return meldungUpdate(id, payload)
    }
    const hinweisUpdate = a.hinweise.updateOne
    a.hinweise.updateOne = async (id, payload) => {
      if (kaputt) throw new Error('nicht schreibbar')
      return hinweisUpdate(id, payload)
    }

    const erster = await holeAb(a.dienste)
    expect(a.funde.finde('alt-5')).toMatchObject({
      status: 'entfernt',
      text: null
    })
    expect(a.meldungen.finde('m-pruefung')['status']).toBe('in_pruefung')
    expect(
      erster.fehler.some((f) =>
        f.includes('Meldung m-pruefung nicht verworfen')
      )
    ).toBe(true)
    expect(erster.fehler.some((f) => f.includes('h-alt nicht geleert'))).toBe(
      true
    )

    // The bookmark passed the tombstone; the next run finishes without it.
    kaputt = false
    const zweiter = await holeAb(a.dienste)
    expect(zweiter.entfernt).toBe(0)
    expect(a.meldungen.finde('m-pruefung')['status']).toBe('verworfen')
    expect(String(a.meldungen.finde('m-pruefung')['fehler'])).toContain(
      'an der Quelle gelöscht'
    )
    expect(a.hinweise.finde('h-alt')).toMatchObject({
      quelltext: null,
      titel: LEAD_OHNE_WORTLAUT
    })
    expect(zweiter.fehler).toEqual(
      expect.not.arrayContaining([expect.stringContaining('nicht verworfen')])
    )
  })

  it('leert die Kopie im alten Hinweis, sobald die Aufbewahrung das Material leert — ein neuer bleibt', async () => {
    const a = aufbau({
      t: einmal(LEER()),
      funde: [
        bestand(SPERRUNG, {
          id: 'beurteilt',
          entscheid: 'weitergereicht',
          entschieden_am: '2026-11-05T10:00:00+01:00'
        })
      ],
      hinweise: [
        {
          id: 'h-alt',
          buschtelefon_fund: 'beurteilt',
          status: 'kein_hinweis',
          titel: 'Weiss jemand, warum …',
          quelltext: 'Wortlaut'
        },
        {
          id: 'h-neu',
          buschtelefon_fund: 'beurteilt',
          status: 'kein_hinweis',
          titel: 'Beitrag aus Facebook-Gruppe «X» vom 8. November 2026',
          quelltext: null
        }
      ]
    })
    await holeAb(a.dienste)
    expect(a.funde.finde('beurteilt')['text']).toBeNull()
    expect(a.hinweise.finde('h-alt')).toMatchObject({
      quelltext: null,
      titel: LEAD_OHNE_WORTLAUT
    })
    expect(a.hinweise.finde('h-neu')['titel']).toBe(
      'Beitrag aus Facebook-Gruppe «X» vom 8. November 2026'
    )
  })

  it('nimmt einem entschiedenen Fund den Wortlaut eines an der Quelle entfernten Kommentars — sonst nichts', async () => {
    const gespeichert = fund(SPERRUNG).kommentare
    const a = aufbau({
      funde: [
        bestand(SPERRUNG, {
          folge: 17500,
          text: 'Stand beim Entscheid',
          entscheid: 'weitergereicht',
          entschieden_am: '2026-11-10T14:00:00+01:00',
          kommentare: gespeichert
        })
      ],
      hinweise: [{ id: 'h-1', buschtelefon_fund: 'alt-2', status: 'offen' }],
      t: einmal(
        seite([
          roh(SPERRUNG, {
            folge: 17700,
            aenderung: ['kommentare'],
            kommentare: (roh(SPERRUNG)['kommentare'] as Zeile[]).map((k) =>
              k['kennung'] === 'k:9f3a02'
                ? { ...k, stand: 'entfernt', text: null, autor_vorname: null }
                : k
            )
          })
        ])
      )
    })
    const ergebnis = await holeAb(a.dienste)
    const zeile = a.funde.finde('alt-2')
    expect(zeile).toMatchObject({
      text: 'Stand beim Entscheid',
      entscheid: 'weitergereicht',
      folge: 17700
    })
    const kommentare = zeile['kommentare'] as Zeile[]
    expect(kommentare.find((k) => k['kennung'] === 'k:9f3a02')).toMatchObject({
      stand: 'entfernt',
      text: null,
      autor_vorname: null,
      bilder: []
    })
    expect(kommentare.find((k) => k['kennung'] === 'k:9f3a01')).toMatchObject({
      autor_vorname: 'Marc'
    })
    expect(JSON.stringify(kommentare)).not.toContain('Danke!')
    expect(zeile['hinweise']).toContain(HINWEIS_KOMMENTARE_ENTFERNT)
    expect(ergebnis.entschieden).toBe(1)
    expect(a.m.aufrufe).toEqual([])
  })
})

describe('holeAb — die Sichtbarkeit aendert sich unter einem bearbeiteten Entwurf', () => {
  it('fuehrt Quellenzeile und Datengrundlage des stehen gebliebenen Entwurfs nach', async () => {
    const oeffentlich = bestand(SPERRUNG, { folge: 17500 })
    const quelle = oeffentlich as never as Parameters<typeof mitQuelle>[1]
    const a = aufbau({
      funde: [oeffentlich],
      meldungen: [
        {
          id: 'm-1',
          buschtelefon_fund: 'alt-2',
          status: 'entwurf',
          date_updated: '2026-11-10T15:00:00Z',
          date_created: '2026-11-10T11:00:00Z',
          text: mitQuelle('Von Hand verbessert.', quelle),
          datengrundlage: {
            ...datengrundlageVon(quelle),
            ergaenzung: 'Die Gemeinde bestätigt.'
          }
        }
      ],
      t: einmal(
        seite([
          roh(SPERRUNG, {
            folge: 17700,
            aenderung: ['herkunft'],
            quelle_sichtbarkeit: 'geschlossen'
          })
        ])
      )
    })
    await holeAb(a.dienste)
    const entwurf = a.meldungen.finde('m-1')
    expect(entwurf['status']).toBe('entwurf')
    expect(entwurf['text']).toMatch(/^Von Hand verbessert\.\n\nQuelle: /)
    expect(entwurf['text']).toContain('">Zur Gruppe</a>')
    expect(entwurf['text']).not.toContain(fund(SPERRUNG).link)
    expect(entwurf['datengrundlage']).toMatchObject({
      url: 'https://www.facebook.com/groups/1000000001',
      sichtbarkeit: 'geschlossen',
      ergaenzung: 'Die Gemeinde bestätigt.'
    })
    expect(a.funde.finde('alt-2')['hinweise']).toEqual(
      expect.arrayContaining([HINWEIS_ENTWURF_AELTER, HINWEIS_QUELLE_NEU])
    )
  })

  it('schreibt einen bearbeiteten Entwurf nicht an, dessen Quelle sich nicht geaendert hat', async () => {
    const zeile = bestand(SPERRUNG, { folge: 17500 })
    const quelle = zeile as never as Parameters<typeof mitQuelle>[1]
    const a = aufbau({
      funde: [zeile],
      meldungen: [
        {
          id: 'm-1',
          buschtelefon_fund: 'alt-2',
          status: 'entwurf',
          date_updated: '2026-11-10T15:00:00Z',
          text: mitQuelle('Von Hand.', quelle),
          datengrundlage: datengrundlageVon(quelle)
        }
      ]
    })
    await holeAb(a.dienste)
    expect(
      a.meldungen.protokoll.filter(
        ([art, id]) => art === 'update' && id === 'm-1'
      )
    ).toEqual([])
    expect(a.funde.finde('alt-2')['hinweise']).not.toContain(HINWEIS_QUELLE_NEU)
  })
})

describe('holeAb — der volle Abruf haelt, was die Tuer noch hat', () => {
  const zuAlt = (erste: Zeile): Tuer =>
    tuer((nach) =>
      nach === null
        ? erste
        : [
            410,
            {
              format: 'buschtelefon-redaktion/2',
              fehler: 'stand_zu_alt',
              verworfen_bis: 500
            }
          ]
    )

  it('laesst einen ausgelassenen oder verweigerten Fund nicht verfallen', async () => {
    const ausgelassen = bestand(SPERRUNG, {
      id: 'aus',
      kennung: 'fb:1000000001_2000000007',
      folge: 100
    })
    const verweigert = bestand(SPERRUNG, {
      id: 'kaputt',
      kennung: 'fb:1000000001_2000000006',
      folge: 100
    })
    const a = aufbau({
      t: zuAlt(FUNDE),
      stand: { folge: 120 },
      funde: [ausgelassen, verweigert]
    })
    const ergebnis = await holeAb(a.dienste)
    expect(ergebnis.aufgeraeumt.verfallen).toBe(0)
    for (const id of ['aus', 'kaputt'])
      expect(a.funde.finde(id)).toMatchObject({
        entscheid: 'offen',
        material_geloescht_am: null,
        text: fund(SPERRUNG).text
      })
  })

  it('laesst nichts verfallen, wenn ein verweigerter Eintrag keine lesbare Kennung trug', async () => {
    const verschwunden = bestand(SPERRUNG, {
      id: 'alt-9',
      kennung: 'fb:1_9',
      folge: 100
    })
    const mitNamenlosem = {
      ...FUNDE,
      funde: [...(FUNDE['funde'] as Zeile[]), { folge: 17686, status: 'aktiv' }]
    }
    const a = aufbau({
      t: zuAlt(mitNamenlosem),
      stand: { folge: 120 },
      funde: [verschwunden]
    })
    const ergebnis = await holeAb(a.dienste)
    expect(ergebnis.ungueltig.some((u) => u.startsWith('ohne Kennung'))).toBe(
      true
    )
    expect(a.funde.finde('alt-9')).toMatchObject({
      entscheid: 'offen',
      material_geloescht_am: null
    })
    expect(
      ergebnis.hinweise.some((h) =>
        h.includes('offene Funde wurden darum nicht als verfallen markiert')
      )
    ).toBe(true)
  })
})

describe('holeAb — Ausgelassene zaehlen nach Kennung', () => {
  const auslassung = (kennung: string, folge: number): Zeile => ({
    kennung,
    folge,
    grund: 'kein_link',
    quelle: 'fb-gruppe:1000000001',
    kanal: 'facebook',
    gemeinden_bfs: [2761],
    veroeffentlicht_am: '2026-11-10T09:00:00+01:00'
  })

  it('zaehlt jeden ausgelassenen Fund einmal und keinen, der spaeter im Lauf doch kam', async () => {
    const W = 'fb:1000000001_2000000099'
    const X = 'fb:1000000001_2000000098'
    const t = tuer((nach) => {
      if (nach === null)
        return seite([], 17001, [auslassung(X, 17000), auslassung(W, 17001)])
      if (nach === 17001)
        return seite([roh(FLYER, { kennung: W, folge: 17500 })], null, [
          auslassung(X, 17002)
        ])
      return LEER()
    })
    const a = aufbau({ t })
    const ergebnis = await holeAb(a.dienste)
    expect(ergebnis.ausgelassen).toBe(1)
    const quelle = a.quellen.zeilen.find(
      (q) => q['kennung'] === 'fb-gruppe:1000000001'
    )
    expect(quelle?.['n_ausgelassen']).toBe(1)

    // A free retry with nothing new leaves the count as it is.
    const leer = aufbau({ t: tuer(() => LEER()) })
    leer.quellen.zeilen.push({ ...quelle, id: 'q-1' })
    await holeAb(leer.dienste)
    expect(
      leer.quellen.zeilen.find(
        (q) => q['kennung'] === 'fb-gruppe:1000000001'
      )?.['n_ausgelassen']
    ).toBe(1)

    // The next day the group delivers another find, not X: X is still
    // held back — the door re-delivers it only when it changes.
    const andere = aufbau({
      t: einmal(seite([roh(SPERRUNG, { folge: 17900 })]))
    })
    andere.quellen.zeilen.push({ ...quelle, id: 'q-1' })
    await holeAb(andere.dienste)
    const danach = andere.quellen.zeilen.find(
      (q) => q['kennung'] === 'fb-gruppe:1000000001'
    )
    expect(danach?.['n_ausgelassen']).toBe(1)

    // And when X finally arrives, it leaves the count.
    const kommt = aufbau({
      t: einmal(seite([roh(FLYER, { kennung: X, folge: 18000 })]))
    })
    kommt.quellen.zeilen.push({ ...danach, id: 'q-1' })
    await holeAb(kommt.dienste)
    expect(
      kommt.quellen.zeilen.find(
        (q) => q['kennung'] === 'fb-gruppe:1000000001'
      )?.['n_ausgelassen']
    ).toBe(0)
  })

  it('zaehlt im Lauf jede Kennung einmal und Namenlose nach Folge', () => {
    expect(
      ausgelasseneImLauf(
        new Map([
          ['a', { folge: 3, quelle: 'q1', ausgelassen: true }],
          ['b', { folge: 4, quelle: 'q1', ausgelassen: false }],
          ['c', { folge: 5, quelle: 'q2', ausgelassen: true }]
        ]),
        new Map([['q1', [7, 8, 8]]])
      )
    ).toBe(4)
  })
})

describe('fuehreAusgelasseneNach', () => {
  const JETZT = '2026-11-12T11:00:00.000Z'
  const eintrag = (
    kennung: string | null,
    folge: number,
    seit = '2026-11-10T11:00:00.000Z'
  ) => ({ kennung, folge, seit })
  const ausl = (eintraege: Array<[string, number, string | null, boolean]>) =>
    new Map(
      eintraege.map(([k, folge, quelle, ausgelassen]) => [
        k,
        { folge, quelle, ausgelassen }
      ])
    )

  it('behaelt, was die Tuer heute nicht erwaehnt, und nimmt, was ankam, heraus', () => {
    const neu = fuehreAusgelasseneNach(
      [eintrag('x', 10), eintrag('y', 11)],
      'q1',
      ausl([['y', 20, 'q1', false]]),
      new Map(),
      false,
      JETZT
    )
    expect(neu.map((e) => e.kennung)).toEqual(['x'])
  })

  it('nimmt neu Ausgelassene dieser Quelle auf, nicht die einer anderen', () => {
    const neu = fuehreAusgelasseneNach(
      [],
      'q1',
      ausl([
        ['a', 30, 'q1', true],
        ['b', 31, 'q2', true]
      ]),
      new Map([['q1', [32, 32]]]),
      false,
      JETZT
    )
    expect(neu).toEqual([
      { kennung: 'a', folge: 30, seit: JETZT },
      { kennung: null, folge: 32, seit: JETZT }
    ])
  })

  it('verwirft, was dreissig Tage nicht mehr genannt wurde', () => {
    const neu = fuehreAusgelasseneNach(
      [eintrag('alt', 1, '2026-10-01T11:00:00.000Z'), eintrag(null, 2)],
      'q1',
      new Map(),
      new Map(),
      false,
      JETZT
    )
    expect(neu.map((e) => e.folge)).toEqual([2])
  })

  it('setzt nach einem vollen Abruf genau das, was dieser ausliess', () => {
    const neu = fuehreAusgelasseneNach(
      [eintrag('x', 10), eintrag(null, 11)],
      'q1',
      ausl([['z', 40, 'q1', true]]),
      new Map(),
      true,
      JETZT
    )
    expect(neu.map((e) => e.kennung)).toEqual(['z'])
  })

  it('liest eine kaputte Liste ohne zu scheitern', () => {
    expect(
      liesAusgelassene([
        { kennung: 'a', folge: '12', seit: JETZT },
        { kennung: 5, folge: 1, seit: JETZT },
        'quatsch',
        { kennung: null, folge: 3 }
      ])
    ).toEqual([{ kennung: 'a', folge: 12, seit: JETZT }])
    expect(liesAusgelassene(null)).toEqual([])
  })
})

describe('holeAb — was ein Modell sagte, bleibt draussen', () => {
  it('nennt eine unlesbare Sichtung neutral und gibt ihre Antwort nirgends weiter', async () => {
    const roheAntwort = 'Sandra Muster von der Hauptstrasse 12: Stufe 4'
    const m = modell()
    const kaputt: Modell = {
      aufrufe: m.aufrufe,
      send: (async (body) => {
        if (JSON.stringify(body.system).includes('Du sichtest'))
          return antwortText(roheAntwort)
        return m.send(body)
      }) as MessageSender
    }
    const protokoll: unknown[] = []
    const a = aufbau({ m: kaputt })
    a.dienste.logger = {
      info: (x: string) => {
        protokoll.push(x)
      },
      warn: (e: unknown, x?: string) => {
        protokoll.push(e, x)
      }
    }
    const ergebnis = await holeAb(a.dienste)
    expect(
      ergebnis.fehler.some((f) =>
        f.includes(
          'Sichtung fehlgeschlagen: Die Antwort des Modells war nicht lesbar.'
        )
      )
    ).toBe(true)
    const alles = JSON.stringify([ergebnis, protokoll, a.stand.zeile])
    for (const verboten of ['Sandra', 'Muster von', 'Hauptstrasse 12'])
      expect(alles).not.toContain(verboten)
  })
})
