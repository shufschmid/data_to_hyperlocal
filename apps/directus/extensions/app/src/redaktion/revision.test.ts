import { describe, expect, it } from 'vitest'
import type { OdsRecord } from '../shared/ods'
import {
  revisionsBefund,
  revisionsHinweis,
  revisionsSchreibungen
} from './revision'

const meldung = (
  text: string
): { titel: string | null; lead: string | null; text: string | null } => ({
  titel: 'Abfall in Binningen',
  lead: null,
  text
})

const zeilen: OdsRecord[] = [
  { gemeinde: 'Binningen', kategorie: 'Papier', menge: 25 },
  { gemeinde: 'Binningen', kategorie: 'Glas', menge: 75 }
]

describe('revisionsBefund', () => {
  it('schweigt, wenn jede Prozentangabe im neuen Stand noch traegt', () => {
    // 25 von 100 sind 25 Prozent — auch nach der Revision ableitbar.
    expect(
      revisionsBefund(meldung('Papier macht 25 Prozent aus.'), zeilen, [])
    ).toBeNull()
  })

  it('nennt die Zahlen, die der neue Stand nicht mehr belegt', () => {
    expect(
      revisionsBefund(meldung('Papier macht 31 Prozent aus.'), zeilen, [])
    ).toEqual([31])
  })

  it('nimmt die Einordnung des neuen Standes als weitere Erlaubnis', () => {
    expect(
      revisionsBefund(
        meldung('Das sind 42 Prozent des Kantonsschnitts.'),
        zeilen,
        [42]
      )
    ).toBeNull()
  })

  it('prueft Titel, Lead und Text zusammen', () => {
    const m = {
      titel: 'Ein Plus von 88 Prozent',
      lead: 'und 91 Prozent im Lead',
      text: 'Papier macht 25 Prozent aus.'
    }
    expect(revisionsBefund(m, zeilen, [])).toEqual([88, 91])
  })

  it('schweigt bei einer Meldung ohne Text', () => {
    expect(
      revisionsBefund({ titel: null, lead: null, text: null }, zeilen, [])
    ).toBeNull()
  })

  it('schweigt, wenn der neue Stand fuer diese Gemeinde leer ist', () => {
    // Keine Zeilen heisst keine Grundlage, nicht "alles falsch": der Waechter
    // darf nicht anschlagen, weil eine Gemeinde aus dem Datensatz fiel.
    expect(
      revisionsBefund(meldung('Papier macht 25 Prozent aus.'), [], [])
    ).toBeNull()
  })
})

describe('revisionsHinweis', () => {
  it('nennt jede Zahl und sagt, was der Leser tun muss', () => {
    const hinweis = revisionsHinweis([31, 68])
    expect(hinweis).toContain('31')
    expect(hinweis).toContain('68')
    expect(hinweis).toContain('revidiert')
  })
})

describe('revisionsSchreibungen', () => {
  const jetzt = '2026-09-15T12:00:00.000Z'
  // Zwei Gemeinden im selben Kantonsbestand: erst damit rechnet
  // beschreibeEinordnung ueberhaupt einen Kantonsschnitt aus.
  const kanton: OdsRecord[] = [
    ...zeilen,
    { gemeinde: 'Reinach', kategorie: 'Papier', menge: 10 },
    { gemeinde: 'Reinach', kategorie: 'Glas', menge: 40 }
  ]
  const reinach: OdsRecord[] = [
    { gemeinde: 'Reinach', kategorie: 'Papier', menge: 10 },
    { gemeinde: 'Reinach', kategorie: 'Glas', menge: 40 }
  ]
  const frisch = new Map([
    ['g-binningen', { eigene: zeilen, alle: zeilen }],
    ['g-reinach', { eigene: reinach, alle: kanton }]
  ])

  it('schreibt einen Hinweis, wo der neue Stand die Zahl nicht mehr traegt', () => {
    const schreibungen = revisionsSchreibungen(
      [
        {
          id: 'm1',
          gemeinde: 'g-binningen',
          titel: null,
          lead: null,
          text: 'Papier macht 31 Prozent aus.'
        }
      ],
      frisch,
      jetzt
    )
    expect(schreibungen).toHaveLength(1)
    expect(schreibungen[0]?.id).toBe('m1')
    expect(schreibungen[0]?.revision_hinweis).toContain('31')
    expect(schreibungen[0]?.revision_geprueft_am).toBe(jetzt)
  })

  it('loescht einen alten Hinweis, wenn der Beitrag wieder traegt', () => {
    const schreibungen = revisionsSchreibungen(
      [
        {
          id: 'm2',
          gemeinde: 'g-binningen',
          titel: null,
          lead: null,
          text: 'Papier macht 25 Prozent aus.',
          revision_hinweis: 'Ein alter Befund.'
        }
      ],
      frisch,
      jetzt
    )
    expect(schreibungen).toEqual([
      { id: 'm2', revision_hinweis: null, revision_geprueft_am: jetzt }
    ])
  })

  it('schreibt nichts, wo nichts zu melden ist und nichts stand', () => {
    const schreibungen = revisionsSchreibungen(
      [
        {
          id: 'm3',
          gemeinde: 'g-binningen',
          titel: null,
          lead: null,
          text: 'Papier macht 25 Prozent aus.'
        }
      ],
      frisch,
      jetzt
    )
    expect(schreibungen).toEqual([])
  })

  it('laesst eine Gemeinde ohne frische Zeilen in Ruhe', () => {
    const schreibungen = revisionsSchreibungen(
      [
        {
          id: 'm4',
          gemeinde: 'g-aesch',
          titel: null,
          lead: null,
          text: 'Das sind 99 Prozent.'
        }
      ],
      frisch,
      jetzt
    )
    expect(schreibungen).toEqual([])
  })

  it('nimmt die Einordnung der Gemeinde als Erlaubnis mit', () => {
    // Die Einordnung sagt fuer Reinach "42.86 Prozent unter dem
    // Kantonsschnitt". Aus Reinachs eigenen Zeilen allein folgt diese Zahl
    // nicht — sie ist nur erlaubt, weil der Waechter dieselbe Erlaubnis baut
    // wie die Freigabe.
    const schreibungen = revisionsSchreibungen(
      [
        {
          id: 'm5',
          gemeinde: 'g-reinach',
          titel: null,
          lead: null,
          text: 'Reinach liegt 42.86 Prozent unter dem Kantonsschnitt.'
        }
      ],
      frisch,
      jetzt
    )
    expect(schreibungen).toEqual([])
  })

  it('meldet dieselbe Zahl, wenn die Einordnung sie nicht hergibt', () => {
    // Gegenprobe zur vorigen: ohne die Kantonszeilen ist 42.86 unbelegt.
    const ohneKanton = new Map([
      ['g-reinach', { eigene: reinach, alle: reinach }]
    ])
    const schreibungen = revisionsSchreibungen(
      [
        {
          id: 'm6',
          gemeinde: 'g-reinach',
          titel: null,
          lead: null,
          text: 'Reinach liegt 42.86 Prozent unter dem Kantonsschnitt.'
        }
      ],
      ohneKanton,
      jetzt
    )
    expect(schreibungen).toHaveLength(1)
    expect(schreibungen[0]?.revision_hinweis).toContain('42.86')
  })
})
