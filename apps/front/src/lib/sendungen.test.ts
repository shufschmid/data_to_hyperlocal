import type { AlleMeldungFelder, SendungskandidatFelder } from '@/graphql/redaktion'
import { anzahlOffen, bleibtOffen, kandidatenJeEdition, meldungJeKandidat, zeitText } from './sendungen'

function kandidat(ueber: Partial<SendungskandidatFelder> = {}): SendungskandidatFelder {
  return {
    id: 'k1',
    quelle: 'regionaljournal',
    titel: 'Schulhaus wird saniert',
    zusammenfassung: 'Kosten: 4 Millionen.',
    begruendung: 'Betrifft alle Familien im Dorf.',
    zeitmarke_sekunden: 261,
    entscheid: 'offen',
    ablehnungsgrund: null,
    gemeinde: { id: 'g1', name: 'Aesch' },
    edition: { id: 'e1' },
    punkt6_edition: null,
    ...ueber
  }
}

describe('bleibtOffen', () => {
  it('laesst Unentschiedenes liegen und Erledigtes gehen', () => {
    expect(bleibtOffen(kandidat())).toBe(true)
    expect(bleibtOffen(kandidat({ entscheid: 'abgelehnt' }))).toBe(false)
    expect(bleibtOffen(kandidat({ entscheid: 'weitergereicht' }))).toBe(false)
  })

  // Dieselbe Regel wie beim Amtsblatt, aus demselben Grund: die Meldung wird
  // auf der Karte redigiert, also muss die Karte den Vorschlag behalten.
  it('haelt einen uebernommenen Vorschlag, solange die Meldung redigiert wird', () => {
    const uebernommen = kandidat({ entscheid: 'uebernommen' })

    expect(bleibtOffen(uebernommen, 'entwurf')).toBe(true)
    expect(bleibtOffen(uebernommen, 'in_pruefung')).toBe(true)
    expect(bleibtOffen(uebernommen, 'publiziert')).toBe(false)
    expect(bleibtOffen(uebernommen, 'verworfen')).toBe(false)
    expect(bleibtOffen(uebernommen, null)).toBe(false)
  })
})

describe('kandidatenJeEdition', () => {
  // Eine Sendung kann mehrere Gemeinden betreffen — darum eine Liste je
  // Beitrag, nicht ein Kandidat.
  it('sammelt mehrere Vorschlaege zum selben Beitrag', () => {
    const karte = kandidatenJeEdition([
      kandidat({ id: 'a', edition: { id: 'e1' } }),
      kandidat({ id: 'b', edition: { id: 'e1' } }),
      kandidat({ id: 'c', edition: { id: 'e2' } })
    ])

    expect(karte.get('e1')?.map((k) => k.id)).toEqual(['a', 'b'])
    expect(karte.get('e2')?.map((k) => k.id)).toEqual(['c'])
  })

  it('ordnet auch die punkt6-Beitraege zu', () => {
    const karte = kandidatenJeEdition([
      kandidat({ id: 'p', quelle: 'punkt6', edition: null, punkt6_edition: { id: 'x1' } })
    ])

    expect(karte.get('x1')?.map((k) => k.id)).toEqual(['p'])
  })

  it('laesst einen Kandidaten ohne Beitrag einfach weg', () => {
    expect(kandidatenJeEdition([kandidat({ edition: null })]).size).toBe(0)
  })
})

describe('anzahlOffen', () => {
  function meldung(ueber: Partial<AlleMeldungFelder>): AlleMeldungFelder {
    return {
      id: 'm1',
      titel: null,
      lead: null,
      text: null,
      status: 'entwurf',
      verarbeitung: 'idle',
      zeit_warnungen: null,
      fehler: null,
      publiziert_am: null,
      erscheint_am: null,
      date_created: null,
      gemeinde: null,
      lauf: null,
      spiel: null,
      kandidat: null,
      amtsblattmeldung: null,
      sendungskandidat: null,
      perle: null,
      ...ueber
    }
  }

  it('zaehlt Offenes und angefangene Arbeit', () => {
    const kandidaten = [
      kandidat({ id: '1' }),
      kandidat({ id: '2', entscheid: 'abgelehnt' }),
      kandidat({ id: '3', entscheid: 'uebernommen' })
    ]

    expect(anzahlOffen(kandidaten)).toBe(1)
    expect(anzahlOffen(kandidaten, [meldung({ sendungskandidat: { id: '3' } })])).toBe(2)
    expect(anzahlOffen(kandidaten, [meldung({ sendungskandidat: { id: '3' }, status: 'publiziert' })])).toBe(
      1
    )
  })

  it('ordnet die Meldungen ihren Kandidaten zu', () => {
    const karte = meldungJeKandidat([
      meldung({ id: 'm1', sendungskandidat: { id: 'k1' } }),
      meldung({ id: 'm2', sendungskandidat: null })
    ])

    expect(karte.get('k1')?.id).toBe('m1')
    expect(karte.size).toBe(1)
  })
})

describe('zeitText', () => {
  it('macht aus Sekunden die Stelle, die man anspringt', () => {
    expect(zeitText(261)).toBe('4:21')
    expect(zeitText(49)).toBe('0:49')
    expect(zeitText(0)).toBe('0:00')
    expect(zeitText(null)).toBe('')
  })
})
