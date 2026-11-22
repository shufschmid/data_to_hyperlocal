import type { KandidatFelder, SmdBeitragFelder } from '@/graphql/redaktion'
import { abSchwelle, ordneKandidaten, publizierbare } from './presseschau'
import { anzahlOffen, tisch, vorgeschlagen } from './smd'
import { EINSTELLBARE_TISCHE } from './tische'

// Die Relevanz-Stufen auf dem Wochenblätter- und dem SMD-Tisch (22.11.2026):
// der Spiegel der Regeln im Backend, damit ein Umstellen der Schwelle hinter
// dem Zahnrad sofort wirkt.

describe('die Regler hinter dem Zahnrad', () => {
  it('kennen Wochenblätter und SMD, mit dem Satz, was die Schwelle dort bewirkt', () => {
    for (const wert of ['wochenblatt', 'smd']) {
      const t = EINSTELLBARE_TISCHE.find((x) => x.wert === wert)
      expect(t).toBeDefined()
      expect(t?.hinweis).toMatch(/Lauf/)
    }
  })
})

describe('Wochenblätter — Stufe und Reihenfolge', () => {
  const k = (id: string, wert: number | null, ueber: Partial<KandidatFelder> = {}) =>
    ({
      id,
      entscheid: 'offen',
      zeitbezug: null,
      anlass_am: null,
      vorschlag_wert: wert,
      ...ueber
    }) as KandidatFelder

  it('legt die höchste Stufe zuoberst, hält die Blattfolge je Stufe und stellt Unbenotetes ans Ende', () => {
    const { aktuell } = ordneKandidaten(
      [k('a', 2), k('b', null), k('c', 4), k('d', 2), k('e', 3)],
      '2026-11-22'
    )
    expect(aktuell.map((x) => x.id)).toEqual(['c', 'e', 'a', 'd', 'b'])
  })

  it('faltet eine vergangene Vorschau weiterhin weg, welche Stufe sie auch hat', () => {
    const { aktuell, vorbei } = ordneKandidaten(
      [k('a', 4, { zeitbezug: 'vorschau', anlass_am: '2026-11-20' }), k('b', 1)],
      '2026-11-22'
    )
    expect(aktuell.map((x) => x.id)).toEqual(['b'])
    expect(vorbei.map((x) => x.id)).toEqual(['a'])
  })

  it('sagt, wozu der Lauf den Entwurf schreibt: ab der Schwelle, Unbenotetes nie', () => {
    expect(abSchwelle({ vorschlag_wert: 3 }, 3)).toBe(true)
    expect(abSchwelle({ vorschlag_wert: 2 }, 3)).toBe(false)
    expect(abSchwelle({ vorschlag_wert: 2 }, 2)).toBe(true)
    expect(abSchwelle({ vorschlag_wert: null }, 1)).toBe(false)
    expect(abSchwelle({}, 1)).toBe(false)
  })

  it('zählt für «Alle publizieren» Entwürfe und Freigegebenes dieses Tischs, nicht die Gegenprüfung', () => {
    const m = (id: string, status: string, kandidat: { id: string } | null) => ({ id, status, kandidat })
    expect(
      publizierbare([
        m('1', 'entwurf', { id: 'k' }),
        m('2', 'freigegeben', { id: 'k' }),
        m('3', 'in_pruefung', { id: 'k' }),
        m('4', 'publiziert', { id: 'k' }),
        m('5', 'entwurf', null)
      ]).map((x) => x.id)
    ).toEqual(['1', '2'])
  })
})

describe('SMD — Stufe gegen Schwelle', () => {
  const e = (id: string, ueber: Partial<SmdBeitragFelder>) =>
    ({
      id,
      medium: 'bzbasel.ch',
      titel: id,
      lead: null,
      blog: null,
      datum: '2026-11-21',
      zeit: null,
      date_created: '2026-11-21T14:45:00Z',
      entscheid: 'offen',
      vorschlag: null,
      gemeinde: { id: 'g', name: 'Aesch' },
      ...ueber
    }) as SmdBeitragFelder

  it('nimmt die Stufe, wo es eine gibt, sonst das alte Bit', () => {
    expect(vorgeschlagen({ vorschlag: false, vorschlag_wert: 3 }, 3)).toBe(true)
    expect(vorgeschlagen({ vorschlag: true, vorschlag_wert: 2 }, 3)).toBe(false)
    expect(vorgeschlagen({ vorschlag: true, vorschlag_wert: null }, 4)).toBe(true)
    expect(vorgeschlagen({ vorschlag: false }, 1)).toBe(false)
  })

  it('legt die höchste Stufe zuoberst und zählt nach der Schwelle', () => {
    const zeilen = [
      e('drei', { vorschlag_wert: 3 }),
      e('vier', { vorschlag_wert: 4 }),
      e('zwei', { vorschlag_wert: 2 })
    ]
    const filter = { gemeinde: null, medium: null, suche: '' }
    const normal = tisch(zeilen, filter, new Map(), '2026-11-22', 3)
    expect(normal.vorschlaege.map((x) => x.id)).toEqual(['vier', 'drei'])
    expect(normal.uebrige.map((x) => x.id)).toEqual(['zwei'])
    expect(anzahlOffen(zeilen, new Map(), 3)).toBe(2)
    expect(anzahlOffen(zeilen, new Map(), 2)).toBe(3)
    expect(anzahlOffen(zeilen, new Map(), 4)).toBe(1)
  })
})
