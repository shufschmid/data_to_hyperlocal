import { describe, expect, it } from 'vitest'
import {
  abholungVon,
  abnehmerStand,
  baueStand,
  istAbnehmerKennung,
  leseAbnehmer,
  leseStand,
  schneideSeite,
  standFilter,
  standVon,
  zeileAus
} from './abholung'

// Der Stand ist ein Paar, keine Zeit — und er wird kopiert, nie gebaut. Alles
// hier ist rein; die Datenbank sieht nur den Filter aus `standFilter`.

const ID_A = 'a1b2c3d4-0000-4000-8000-000000000001'
const ID_B = 'a1b2c3d4-0000-4000-8000-000000000002'

describe('baueStand und leseStand', () => {
  it('gehen hin und zurueck — Zeitpunkt in Millisekunden UTC, dann die Kennung', () => {
    const stand = baueStand({
      publiziert_am: '2026-09-22T14:03:11.412Z',
      id: ID_A
    })
    expect(stand).toBe(`2026-09-22T14:03:11.412Z|${ID_A}`)
    expect(leseStand(stand)).toEqual({
      ok: true,
      wert: { publiziert_am: '2026-09-22T14:03:11.412Z', id: ID_A }
    })
  })

  it('normalisiert, was Postgres anders rendert, auf dieselbe Form', () => {
    // Ein Offset statt Z, und eine Kennung in Grossbuchstaben: derselbe Stand.
    const gelesen = leseStand(
      `2026-09-22T16:03:11.412+02:00|${ID_A.toUpperCase()}`
    )
    expect(gelesen).toEqual({
      ok: true,
      wert: { publiziert_am: '2026-09-22T14:03:11.412Z', id: ID_A }
    })
  })

  it('weist alles ab, was kein Stand ist — auch eine blosse Uhrzeit', () => {
    for (const roh of [
      undefined,
      null,
      42,
      '',
      '2026-09-22T14:03:11.412Z',
      `irgendwann|${ID_A}`,
      '2026-09-22T14:03:11.412Z|keine-kennung',
      `2026-09-22T14:03:11.412Z|${ID_A}|mehr`
    ]) {
      const gelesen = leseStand(roh)
      expect(gelesen.ok, String(roh)).toBe(false)
      if (!gelesen.ok) expect(gelesen.meldung).toContain('abholung.stand')
    }
  })

  it('kennt keinen Stand fuer einen Beitrag ohne Publikationszeitpunkt', () => {
    expect(baueStand({ publiziert_am: null, id: ID_A })).toBeNull()
  })
})

describe('standFilter', () => {
  // Strikt nach dem Zeitpunkt — und OHNE die Kennung: Directus laesst `_gt`
  // auf einem uuid-Feld nicht zu (gemessen: die Verweigerung riss den Prozess
  // mit). Was zwei Beitraege mit demselben Zeitpunkt an einer Seitengrenze
  // zusammenhaelt, ist darum `schneideSeite`.
  it('liegt strikt hinter dem Zeitpunkt des Stands', () => {
    expect(
      standFilter({ publiziert_am: '2026-09-22T14:03:11.412Z', id: ID_A })
    ).toEqual({ publiziert_am: { _gt: '2026-09-22T14:03:11.412Z' } })
  })
})

describe('schneideSeite', () => {
  const z = (t: string, n: number) => ({ publiziert_am: t, id: `id-${n}` })
  const T1 = '2026-09-22T14:03:11.412Z'
  const T2 = '2026-09-22T14:03:11.413Z'

  it('laesst eine Seite, die kuerzer ist als die Grenze, wie sie ist', () => {
    const zeilen = [z(T1, 1), z(T2, 2)]
    expect(schneideSeite(zeilen, 3)).toEqual({
      seite: zeilen,
      ganzeGruppe: null
    })
  })

  it('wirft die Extrazeile ab, wenn sie einen neuen Zeitpunkt beginnt', () => {
    expect(schneideSeite([z(T1, 1), z(T1, 2), z(T2, 3)], 2)).toEqual({
      seite: [z(T1, 1), z(T1, 2)],
      ganzeGruppe: null
    })
  })

  it('haelt eine Gruppe, die die Grenze ueberschreitet, ganz zurueck', () => {
    // Zeile 2 und 3 teilen den Zeitpunkt; die Grenze fiele dazwischen. Also
    // endet die Seite vor der Gruppe — sie kommt naechstes Mal, vollstaendig.
    expect(schneideSeite([z(T1, 1), z(T2, 2), z(T2, 3)], 2)).toEqual({
      seite: [z(T1, 1)],
      ganzeGruppe: null
    })
  })

  it('nennt die Gruppe, wenn sie die ganze Seite ist — die muss dann ganz geholt werden', () => {
    expect(schneideSeite([z(T1, 1), z(T1, 2), z(T1, 3)], 2)).toEqual({
      seite: [],
      ganzeGruppe: T1
    })
  })
})

describe('die Kennung des Abnehmers', () => {
  it('ist kurz, klein und ASCII', () => {
    expect(istAbnehmerKennung('dorfkoenig')).toBe(true)
    expect(istAbnehmerKennung('dorfkoenig-2')).toBe(true)
    for (const falsch of [
      'Dorfkoenig',
      'd',
      'dorf könig',
      '-dorf',
      'x'.repeat(41),
      '',
      undefined
    ])
      expect(istAbnehmerKennung(falsch), String(falsch)).toBe(false)
  })

  it('fehlt als Parameter ohne Folgen, ist aber falsch geschrieben ein Fehler', () => {
    expect(leseAbnehmer(undefined)).toEqual({ ok: true, wert: null })
    expect(leseAbnehmer('  ')).toEqual({ ok: true, wert: null })
    expect(leseAbnehmer(' dorfkoenig ')).toEqual({
      ok: true,
      wert: 'dorfkoenig'
    })
    expect(leseAbnehmer('Dorfkönig').ok).toBe(false)
    expect(leseAbnehmer(['a', 'b']).ok).toBe(false)
  })
})

describe('abholungVon', () => {
  const seite = [
    { publiziert_am: '2026-09-22T14:03:11.412Z', id: ID_A },
    { publiziert_am: '2026-09-22T14:03:11.412Z', id: ID_B }
  ]

  it('nennt den bisherigen Stand und den, der nach dieser Seite zu bestaetigen ist', () => {
    const zeile = zeileAus(
      'dorfkoenig',
      { publiziert_am: '2026-09-21T10:00:00.000Z', id: ID_A },
      '2026-09-21T10:05:00.000Z'
    )
    expect(abholungVon('dorfkoenig', zeile, seite)).toEqual({
      abnehmer: 'dorfkoenig',
      bisher: `2026-09-21T10:00:00.000Z|${ID_A}`,
      stand: `2026-09-22T14:03:11.412Z|${ID_B}`
    })
  })

  it('hat beim ersten Kontakt keinen bisherigen und bei leerer Seite keinen neuen Stand', () => {
    expect(abholungVon('dorfkoenig', null, [])).toEqual({
      abnehmer: 'dorfkoenig',
      bisher: null,
      stand: null
    })
  })
})

describe('abnehmerStand und zeileAus', () => {
  it('schreibt beide Haelften des Stands und liest sie als einen zurueck', () => {
    const zeile = zeileAus(
      'dorfkoenig',
      { publiziert_am: '2026-09-22T14:03:11.412Z', id: ID_A },
      '2026-09-22T15:00:00.000Z'
    )
    expect(zeile).toEqual({
      kennung: 'dorfkoenig',
      abgeholt_bis: '2026-09-22T14:03:11.412Z',
      abgeholt_id: ID_A,
      abgeholt_am: '2026-09-22T15:00:00.000Z'
    })
    expect(standVon(zeile)).toBe(`2026-09-22T14:03:11.412Z|${ID_A}`)
    expect(abnehmerStand('dorfkoenig', zeile, 3)).toEqual({
      abnehmer: 'dorfkoenig',
      stand: `2026-09-22T14:03:11.412Z|${ID_A}`,
      abgeholt_bis: '2026-09-22T14:03:11.412Z',
      abgeholt_am: '2026-09-22T15:00:00.000Z',
      offen: 3
    })
  })

  it('sagt bei einem unbekannten Abnehmer, dass alles offen ist', () => {
    expect(abnehmerStand('neu', null, 170)).toEqual({
      abnehmer: 'neu',
      stand: null,
      abgeholt_bis: null,
      abgeholt_am: null,
      offen: 170
    })
  })
})
