import { describe, expect, it } from 'vitest'
import {
  buildBeschreibung,
  buildGesundheit,
  buildOpenapi,
  dokuPfad,
  KONVENTION,
  REGISTER,
  VERSION
} from './register'

describe('dokuPfad', () => {
  it('macht aus dem Express-Pfad den Pfad, den ein Abnehmer aufruft', () => {
    // Directus haengt einen Endpunkt-Eintrag unter seinen Namen — der Eintrag
    // heisst `api`, also ist /v1/artikel oeffentlich /api/v1/artikel.
    expect(dokuPfad('/v1/artikel')).toBe('/api/v1/artikel')
    expect(dokuPfad('/v1/artikel/:id')).toBe('/api/v1/artikel/{id}')
    expect(dokuPfad('/v1/openapi.json')).toBe('/api/v1/openapi.json')
  })
})

describe('buildBeschreibung', () => {
  // R15: die Beschreibung kommt aus dem Register, nie aus einer Liste von Hand.
  // Eine Liste, die jemand beim Hinzufuegen einer Route vergisst, ist der
  // haeufigste Fehler dieser Art.
  it('nennt genau die Routen des Registers, mit Zweck und Parametern', () => {
    const beschreibung = buildBeschreibung()
    const endpunkte = beschreibung['endpunkte'] as {
      pfad: string
      methoden: string[]
      zweck: string
      parameter?: unknown[]
    }[]

    expect(endpunkte.map((e) => e.pfad)).toEqual(
      REGISTER.map((r) => dokuPfad(r.pfad))
    )
    for (const e of endpunkte) {
      expect(e.methoden).toEqual(['GET'])
      expect(e.zweck.length).toBeGreaterThan(10)
    }
    // Die Liste fuehrt ihre Parameter, die Gesundheit hat keine.
    const artikel = endpunkte.find((e) => e.pfad === '/api/v1/artikel')!
    expect(artikel.parameter).toHaveLength(4)
    expect(
      endpunkte.find((e) => e.pfad === '/api/v1/gesundheit')!.parameter
    ).toBeUndefined()
  })

  it('sagt, welcher Konvention sie folgt und dass sie kein Merkmal braucht', () => {
    const beschreibung = buildBeschreibung()
    expect(beschreibung['konvention']).toBe(KONVENTION)
    // R4a: der Abnehmer muss wissen, woran er ist.
    expect(beschreibung['merkmal']).toBe('keines')
    expect(beschreibung['openapi']).toBe('/api/v1/openapi.json')
  })
})

describe('buildOpenapi', () => {
  it('beschreibt genau die Routen des Registers', () => {
    const schema = buildOpenapi()
    const paths = schema['paths'] as Record<string, unknown>

    expect(Object.keys(paths).sort()).toEqual(
      REGISTER.map((r) => dokuPfad(r.pfad)).sort()
    )
    expect(schema['openapi']).toBe('3.0.3')
    expect((schema['info'] as { version: string }).version).toBe(VERSION)
  })

  it('nennt bei Inhaltspfaden die 503-Antwort, bei den offenen nicht', () => {
    const paths = buildOpenapi()['paths'] as Record<
      string,
      { get: { responses: Record<string, unknown> } }
    >
    expect(paths['/api/v1/artikel']!.get.responses['503']).toBeDefined()
    expect(paths['/api/v1/gesundheit']!.get.responses['503']).toBeUndefined()
  })
})

describe('buildGesundheit', () => {
  const zeit = '2026-09-03T10:00:00.000Z'

  it('ist bereit, wenn Datenbank und Schalter stimmen', () => {
    const g = buildGesundheit({ datenbank: true, offen: true, zeit })
    expect(g.bereit).toBe(true)
    expect(g.konvention).toBe(KONVENTION)
    expect(g.merkmal).toBe('keines')
    expect(g.zeit).toBe(zeit)
  })

  // R5 woertlich: ein Dienst, der nichts ausliefert, sagt das — und die zwei
  // Einzelbools sagen, welcher der beiden Gruende es ist.
  it('ist nicht bereit, wenn der Schalter aus ist, und sagt warum', () => {
    const aus = buildGesundheit({ datenbank: true, offen: false, zeit })
    expect(aus.bereit).toBe(false)
    expect(aus.datenbank).toBe(true)
    expect(aus.offen).toBe(false)

    const kaputt = buildGesundheit({ datenbank: false, offen: true, zeit })
    expect(kaputt.bereit).toBe(false)
    expect(kaputt.datenbank).toBe(false)
  })
})
