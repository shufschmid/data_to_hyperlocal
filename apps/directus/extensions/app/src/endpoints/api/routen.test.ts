import { describe, expect, it, vi } from 'vitest'
import { REGISTER } from './register'
import {
  verdrahte,
  type AnfrageLike,
  type AntwortLike,
  type Deps,
  type RouterLike
} from './routen'
import type { Rohzeile } from './projektion'

// Die fuenf Pruefungen aus Regel R16 der Konvention, sinngemaess fuer den
// offenen Modus — alle ueber einen Fake-Router und Stub-Deps, also ohne Netz,
// ohne Datenbank und ohne Express. Die entscheidende Eigenschaft: die
// Pruefungen 2 und 5 laufen UEBER DAS REGISTER, nicht ueber eine Liste von
// Hand. Eine Route, die jemand hinzufuegt und in der Liste vergisst, ist der
// haeufigste Fehler dieser Art.

interface Aufzeichnung {
  methode: 'get' | 'all' | 'use'
  pfad: string | null
  handler: unknown[]
}

function fakeRouter() {
  const eintraege: Aufzeichnung[] = []
  const router: RouterLike = {
    use: (...handler) =>
      eintraege.push({ methode: 'use', pfad: null, handler }),
    get: (pfad, ...handler) =>
      eintraege.push({ methode: 'get', pfad, handler }),
    all: (pfad, ...handler) => eintraege.push({ methode: 'all', pfad, handler })
  }
  return { router, eintraege }
}

function fakeAntwort() {
  const aufzeichnung = {
    status: 0,
    koerper: undefined as unknown,
    kopf: {} as Record<string, string>
  }
  const res: AntwortLike = {
    status(code) {
      aufzeichnung.status = code
      return res
    },
    set(feld, wert) {
      aufzeichnung.kopf[feld] = wert
      return res
    },
    json(koerper) {
      aufzeichnung.koerper = koerper
      return koerper
    }
  }
  return { res, aufzeichnung }
}

function anfrage(
  query: Record<string, unknown> = {},
  params: Record<string, string | undefined> = {}
): AnfrageLike {
  return { query, params }
}

const ZEILE: Rohzeile = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  titel: 'Tempo 30 im Dorfkern',
  lead: 'Der Kanton hat bewilligt.',
  text: 'Text.',
  publiziert_am: '2026-09-02T06:00:00.000Z',
  erscheint_am: null,
  perle: null,
  lauf: null,
  kandidat: null,
  sendungskandidat: 's-1',
  amtsblattmeldung: null,
  spiel: null,
  gemeinde: { id: 'g-1', name: 'Münchenstein', bfs_nummer: 2769 },
  datengrundlage: { quelle: 'punkt6', sendung: 'punkt6' }
}

function stubDeps(ueber: Partial<Deps> = {}): Deps {
  return {
    ladeArtikel: vi.fn().mockResolvedValue([ZEILE]),
    zaehleArtikel: vi.fn().mockResolvedValue(1),
    ladeGemeinden: vi.fn().mockResolvedValue([
      {
        id: 'g-1',
        name: 'Münchenstein',
        bfs_nummer: 2769,
        bezirk: 'Arlesheim'
      }
    ]),
    datenbankBereit: vi.fn().mockResolvedValue(true),
    istOffen: () => true,
    jetzt: () => '2026-09-03T12:00:00.000Z',
    logger: { error: vi.fn() },
    ...ueber
  }
}

/** Ruft die verdrahtete GET-Route eines Pfades auf. */
async function rufe(
  pfad: string,
  deps: Deps,
  req: AnfrageLike = anfrage()
): Promise<{ status: number; koerper: unknown; kopf: Record<string, string> }> {
  const { router, eintraege } = fakeRouter()
  verdrahte(router, deps)
  const { res, aufzeichnung } = fakeAntwort()

  // Die use-Middleware zuerst, damit der X-Robots-Tag-Kopf gesetzt ist — genau
  // wie Express es tun wuerde.
  const kopfMiddleware = eintraege.find((e) => e.methode === 'use')!
    .handler[0] as (r: AnfrageLike, s: AntwortLike, n: () => void) => void
  kopfMiddleware(req, res, () => {})

  const route = eintraege.find((e) => e.methode === 'get' && e.pfad === pfad)!
  // Bei Inhaltsrouten steht das Tor vor dem Handler: durchlaufen, wie Express.
  let weiter = false
  for (const handler of route.handler) {
    weiter = false
    await (
      handler as (
        r: AnfrageLike,
        s: AntwortLike,
        n: () => void
      ) => void | Promise<void>
    )(req, res, () => {
      weiter = true
    })
    if (!weiter) break
  }
  return {
    status: aufzeichnung.status,
    koerper: aufzeichnung.koerper,
    kopf: aufzeichnung.kopf
  }
}

// --- Pruefung 1 ---------------------------------------------------------------

describe('die drei offenen Wege', () => {
  const OFFENE = ['/v1/gesundheit', '/v1/beschreibung', '/v1/openapi.json']

  it('antworten auch bei abgeschalteter Schnittstelle', async () => {
    const deps = stubDeps({ istOffen: () => false })
    for (const pfad of OFFENE) {
      const antwort = await rufe(pfad, deps)
      // Die Gesundheit sagt 503 UND bleibt aussagekraeftig (R3: derselbe
      // Koerper) — ein Waechter muss sehen koennen, was fehlt.
      expect([200, 503], pfad).toContain(antwort.status)
      expect(antwort.koerper, pfad).toBeDefined()
    }
  })

  it('liefern keinen Bestand', async () => {
    // „Kein Bestand" heisst: keine Artikelinhalte. Die Beschreibung NENNT den
    // Pfad /api/v1/artikel natuerlich — das ist ihr Zweck.
    const deps = stubDeps()
    for (const pfad of OFFENE) {
      const koerper = JSON.stringify((await rufe(pfad, deps)).koerper)
      expect(koerper, pfad).not.toContain('Tempo 30')
      expect(koerper, pfad).not.toContain('Der Kanton hat bewilligt')
      expect(koerper, pfad).not.toContain('Münchenstein')
    }
    // Der harte Beweis: es wurde nicht einmal gelesen.
    expect(deps.ladeArtikel).not.toHaveBeenCalled()
    expect(deps.ladeGemeinden).not.toHaveBeenCalled()
  })

  it('die Gesundheit sagt, dass kein Merkmal noetig ist', async () => {
    const koerper = (await rufe('/v1/gesundheit', stubDeps())).koerper as {
      merkmal: string
      bereit: boolean
    }
    expect(koerper.merkmal).toBe('keines')
    expect(koerper.bereit).toBe(true)
  })
})

// --- Pruefung 2 ---------------------------------------------------------------

describe('der Schalter', () => {
  // Ueber das Register iteriert, nicht ueber eine Liste: eine neue Inhaltsroute
  // wird hier automatisch mitgeprueft.
  const INHALT = REGISTER.filter((r) => r.inhalt)

  it('haelt jede Inhaltsroute zurueck, solange er aus ist', async () => {
    expect(INHALT.length).toBeGreaterThan(0)
    const deps = stubDeps({ istOffen: () => false })

    for (const eintrag of INHALT) {
      const antwort = await rufe(
        eintrag.pfad,
        deps,
        anfrage({}, { id: ZEILE.id })
      )
      expect(antwort.status, eintrag.pfad).toBe(503)
      expect(antwort.koerper, eintrag.pfad).toEqual({
        fehler: {
          code: 'schnittstelle_abgeschaltet',
          meldung:
            'Die Schnittstelle ist abgeschaltet. Sie wird mit BLOG_API_OFFEN=ja eingeschaltet.'
        }
      })
    }
    // Und nichts wurde gelesen — der Bestand bleibt unangetastet.
    expect(deps.ladeArtikel).not.toHaveBeenCalled()
  })

  // R4a will, dass ein mitgeschicktes Merkmal IGNORIERT wird. Diese Handler
  // tun das von sich aus: sie lesen den Kopf nie und arbeiten ohne
  // accountability, ein Merkmal kann hier also nichts oeffnen und nichts
  // schliessen. Gegen die echte Anwendung gemessen: mit gueltigem Token kommt
  // Byte fuer Byte dieselbe Antwort.
  //
  // ABER: ein UNGUELTIGES Merkmal weist Directus selbst mit 401 ab, bevor
  // dieser Endpunkt ueberhaupt gefragt wird — dieselbe Pipeline, die auch
  // /redaktion/blog vorschaltet. Das ist eine Abweichung von R4a, die aus einem
  // Endpunkt heraus nicht zu heilen ist, und sie steht im Vertrag
  // (SCHNITTSTELLE.md).
  it('liest das Merkmal nie — es kann hier nichts oeffnen und nichts schliessen', async () => {
    const deps = stubDeps()
    const antwort = await rufe('/v1/artikel', deps)
    expect(antwort.status).toBe(200)
    // Kein Handler dieser Datei bekommt die Koepfe ueberhaupt zu sehen:
    // AnfrageLike hat kein `headers`-Feld.
    expect(Object.keys(anfrage())).toEqual(['query', 'params'])
  })
})

// --- Pruefung 3 ---------------------------------------------------------------

describe('das Fehlerformat', () => {
  it('gilt fuer 400', async () => {
    const antwort = await rufe(
      '/v1/artikel',
      stubDeps(),
      anfrage({ grenze: '501' })
    )
    expect(antwort.status).toBe(400)
    expect(antwort.koerper).toEqual({
      fehler: {
        code: 'ungueltige_eingabe',
        meldung:
          'Der Parameter «grenze» muss eine ganze Zahl zwischen 1 und 500 sein.'
      }
    })
  })

  it('gilt fuer 404 — unbekannte Kennung, unbekannte Gemeinde, unbekannter Pfad', async () => {
    const leer = stubDeps({ ladeArtikel: vi.fn().mockResolvedValue([]) })
    const kennung = await rufe(
      '/v1/artikel/:id',
      leer,
      anfrage({}, { id: ZEILE.id })
    )
    expect(kennung.status).toBe(404)
    expect((kennung.koerper as { fehler: { code: string } }).fehler.code).toBe(
      'nicht_gefunden'
    )

    // Eine Nicht-UUID kommt gar nicht bis zur Datenbank — ein Tippfehler darf
    // kein 500 werden.
    const krumm = await rufe(
      '/v1/artikel/:id',
      leer,
      anfrage({}, { id: 'quatsch' })
    )
    expect(krumm.status).toBe(404)
    expect(leer.ladeArtikel).toHaveBeenCalledTimes(1)

    const gemeinde = await rufe(
      '/v1/artikel',
      stubDeps(),
      anfrage({ gemeinde: 'muttenz' })
    )
    expect(gemeinde.status).toBe(404)
    expect(
      (gemeinde.koerper as { fehler: { meldung: string } }).fehler.meldung
    ).toContain('/api/v1/gemeinden')
  })

  it('gilt fuer 405 und nennt die erlaubte Methode', () => {
    const { router, eintraege } = fakeRouter()
    verdrahte(router, stubDeps())
    const alle = eintraege.find(
      (e) => e.methode === 'all' && e.pfad === '/v1/artikel'
    )!
    const { res, aufzeichnung } = fakeAntwort()
    ;(alle.handler[0] as (r: AnfrageLike, s: AntwortLike) => void)(
      anfrage(),
      res
    )
    expect(aufzeichnung.status).toBe(405)
    const koerper = aufzeichnung.koerper as {
      fehler: { code: string; meldung: string }
    }
    expect(koerper.fehler.code).toBe('methode_nicht_erlaubt')
    expect(koerper.fehler.meldung).toContain('GET')
  })

  it('faengt den unbekannten Pfad, damit kein HTML des Rahmens durchscheint', () => {
    const { router, eintraege } = fakeRouter()
    verdrahte(router, stubDeps())
    // Die letzten beiden use-Handler: Catch-all (2 Argumente) und Fehler (4).
    const uses = eintraege.filter((e) => e.methode === 'use')
    const catchAll = uses.at(-2)!.handler[0] as (
      r: AnfrageLike,
      s: AntwortLike
    ) => void
    const { res, aufzeichnung } = fakeAntwort()
    catchAll(anfrage(), res)
    expect(aufzeichnung.status).toBe(404)
    expect(
      (aufzeichnung.koerper as { fehler: { code: string } }).fehler.code
    ).toBe('nicht_gefunden')
  })

  it('macht aus einem Absturz ein 500 ohne Stacktrace, und loggt ihn', () => {
    const { router, eintraege } = fakeRouter()
    const deps = stubDeps()
    verdrahte(router, deps)
    const fehlerHandler = eintraege.filter((e) => e.methode === 'use').at(-1)!
      .handler[0] as (
      p: unknown,
      r: AnfrageLike,
      s: AntwortLike,
      n: () => void
    ) => void
    const { res, aufzeichnung } = fakeAntwort()
    fehlerHandler(new TypeError('irgendwo tief drin'), anfrage(), res, () => {})

    expect(aufzeichnung.status).toBe(500)
    const koerper = aufzeichnung.koerper as {
      fehler: { code: string; meldung: string }
    }
    expect(koerper.fehler.code).toBe('interner_fehler')
    expect(koerper.fehler.meldung).toContain('TypeError')
    expect(koerper.fehler.meldung).not.toContain('irgendwo tief drin')
    expect(deps.logger.error).toHaveBeenCalled()
  })

  it('gilt fuer 503 — siehe die Schalter-Pruefung', async () => {
    const antwort = await rufe(
      '/v1/artikel',
      stubDeps({ istOffen: () => false })
    )
    expect(antwort.status).toBe(503)
  })
})

// --- Pruefung 4 ---------------------------------------------------------------

describe('das Blaettern', () => {
  const bestand: Rohzeile[] = Array.from({ length: 5 }, (_, i) => ({
    ...ZEILE,
    id: `a1b2c3d4-0000-4000-8000-00000000000${i + 1}`
  }))

  function seitenDeps(): Deps {
    return stubDeps({
      ladeArtikel: vi.fn(async (abfrage) =>
        bestand.slice(abfrage.versatz, abfrage.versatz + abfrage.grenze)
      ),
      zaehleArtikel: vi.fn().mockResolvedValue(bestand.length)
    })
  }

  it('zaehlt richtig und sagt, ob mehr kommt', async () => {
    const erste = (
      await rufe('/v1/artikel', seitenDeps(), anfrage({ grenze: '2' }))
    ).koerper as Record<string, unknown>
    expect(erste['anzahl']).toBe(2)
    expect(erste['gesamt']).toBe(5)
    expect(erste['versatz']).toBe(0)
    expect(erste['grenze']).toBe(2)
    expect(erste['weitere']).toBe(true)
  })

  it('sagt an der Grenze, dass nichts mehr kommt', async () => {
    const letzte = (
      await rufe(
        '/v1/artikel',
        seitenDeps(),
        anfrage({ grenze: '2', versatz: '3' })
      )
    ).koerper as Record<string, unknown>
    expect(letzte['anzahl']).toBe(2)
    expect(letzte['weitere']).toBe(false)
  })

  it('bleibt hinter dem Ende ruhig und ehrlich', async () => {
    const dahinter = (
      await rufe('/v1/artikel', seitenDeps(), anfrage({ versatz: '99' }))
    ).koerper as Record<string, unknown>
    expect(dahinter['anzahl']).toBe(0)
    expect(dahinter['gesamt']).toBe(5)
    expect(dahinter['weitere']).toBe(false)
    expect(dahinter['artikel']).toEqual([])
  })

  it('reicht Gemeinde und Datum an die Abfrage weiter', async () => {
    const deps = seitenDeps()
    await rufe(
      '/v1/artikel',
      deps,
      anfrage({ gemeinde: 'muenchenstein', seit: '2026-09-01' })
    )
    expect(deps.ladeArtikel).toHaveBeenCalledWith(
      expect.objectContaining({
        gemeinde: expect.objectContaining({ id: 'g-1' }),
        seit: '2026-09-01T00:00:00.000Z'
      })
    )
  })
})

// --- Pruefung 5 ---------------------------------------------------------------

describe('Register und Verdrahtung', () => {
  it('verdrahtet genau die Routen des Registers — keine mehr, keine weniger', () => {
    const { router, eintraege } = fakeRouter()
    verdrahte(router, stubDeps())

    const gets = eintraege
      .filter((e) => e.methode === 'get')
      .map((e) => e.pfad)
      .sort()
    expect(gets).toEqual(REGISTER.map((r) => r.pfad).sort())

    // Und jede Route hat ihre 405-Absicherung.
    const alls = eintraege
      .filter((e) => e.methode === 'all')
      .map((e) => e.pfad)
      .sort()
    expect(alls).toEqual(REGISTER.map((r) => r.pfad).sort())
  })

  it('stellt das Tor nur vor die Inhaltsrouten', () => {
    const { router, eintraege } = fakeRouter()
    verdrahte(router, stubDeps())
    for (const eintrag of REGISTER) {
      const route = eintraege.find(
        (e) => e.methode === 'get' && e.pfad === eintrag.pfad
      )!
      expect(route.handler.length, eintrag.pfad).toBe(eintrag.inhalt ? 2 : 1)
    }
  })

  it('setzt X-Robots-Tag auf jede Antwort', async () => {
    for (const eintrag of REGISTER) {
      const antwort = await rufe(
        eintrag.pfad,
        stubDeps(),
        anfrage({}, { id: ZEILE.id })
      )
      expect(antwort.kopf['X-Robots-Tag'], eintrag.pfad).toBe('noindex')
    }
  })
})

describe('/v1/gemeinden', () => {
  it('nennt die Kennungen, nach denen ein Abnehmer fragen darf', async () => {
    const koerper = (await rufe('/v1/gemeinden', stubDeps())).koerper as Record<
      string,
      unknown
    >
    expect(koerper['gemeinden']).toEqual([
      {
        gemeinde: 'muenchenstein',
        name: 'Münchenstein',
        bfs_nummer: 2769,
        bezirk: 'Arlesheim'
      }
    ])
    expect(koerper['anzahl']).toBe(1)
    expect(koerper['weitere']).toBe(false)
  })
})

describe('/v1/artikel/:id', () => {
  it('liefert denselben Zuschnitt wie die Liste', async () => {
    const einzeln = (
      await rufe('/v1/artikel/:id', stubDeps(), anfrage({}, { id: ZEILE.id }))
    ).koerper as Record<string, unknown>
    const ausListe = (
      (await rufe('/v1/artikel', stubDeps())).koerper as {
        artikel: Record<string, unknown>[]
      }
    ).artikel[0]!

    expect(Object.keys(einzeln).sort()).toEqual(Object.keys(ausListe).sort())
    expect(einzeln['id']).toBe(ZEILE.id)
    expect(einzeln['rubrik']).toBe('sendung')
  })
})
