import { formulierbar, ordneKandidaten, vorschauVorbei, zeitbezugText } from './presseschau'

const vorschau = { zeitbezug: 'vorschau', anlass_am: '2026-09-26', entscheid: 'offen' }

describe('vorschauVorbei', () => {
  it('blendet eine offene Vorschau am Tag NACH dem Anlass aus', () => {
    expect(vorschauVorbei(vorschau, '2026-09-26')).toBe(false)
    expect(vorschauVorbei(vorschau, '2026-09-27')).toBe(true)
  })

  it('laesst Rueckschau, Uebernommenes und Kandidaten ohne Datum oben', () => {
    expect(vorschauVorbei({ ...vorschau, zeitbezug: 'rueckschau' }, '2026-10-01')).toBe(false)
    expect(vorschauVorbei({ ...vorschau, entscheid: 'uebernommen' }, '2026-10-01')).toBe(false)
    expect(vorschauVorbei({ ...vorschau, anlass_am: null }, '2026-10-01')).toBe(false)
    expect(vorschauVorbei({ zeitbezug: null, anlass_am: null, entscheid: 'offen' }, '2026-10-01')).toBe(false)
  })
})

describe('ordneKandidaten', () => {
  it('haengt vergangene Vorschauen unten an, nichts geht verloren', () => {
    const a = { ...vorschau, id: 'a' }
    const b = { ...vorschau, id: 'b', anlass_am: '2026-10-03' }
    const c = { zeitbezug: 'rueckschau', anlass_am: null, entscheid: 'offen', id: 'c' }
    const { aktuell, vorbei } = ordneKandidaten([a, b, c], '2026-09-27')
    expect(aktuell.map((k) => k.id)).toEqual(['b', 'c'])
    expect(vorbei.map((k) => k.id)).toEqual(['a'])
  })
})

describe('formulierbar', () => {
  it('zaehlt nur offene Kandidaten mit Fakten, ohne Meldung und ohne vergangene Vorschau', () => {
    const k = { zeitbezug: 'keiner', anlass_am: null, entscheid: 'offen', zusammenfassung: 'Fakten.' }
    expect(formulierbar(k, false, '2026-09-27')).toBe(true)
    expect(formulierbar(k, true, '2026-09-27')).toBe(false)
    expect(formulierbar({ ...k, zusammenfassung: ' ' }, false, '2026-09-27')).toBe(false)
    expect(formulierbar({ ...vorschau, zusammenfassung: 'x' }, false, '2026-09-27')).toBe(false)
  })
})

describe('zeitbezugText', () => {
  it('nennt Vorschau mit Tag und Rueckschau, sonst nichts', () => {
    expect(zeitbezugText(vorschau)).toBe('Vorschau · 26.09.2026')
    expect(zeitbezugText({ zeitbezug: 'vorschau', anlass_am: null })).toBe('Vorschau')
    expect(zeitbezugText({ zeitbezug: 'rueckschau', anlass_am: null })).toBe('Rückschau')
    expect(zeitbezugText({ zeitbezug: null, anlass_am: null })).toBeNull()
  })
})
