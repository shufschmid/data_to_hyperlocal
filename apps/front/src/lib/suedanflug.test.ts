import {
  meldungenNachSuedanflug,
  monatsende,
  monatsname,
  suedanflugTitel,
  zeitleiste,
  type ZeitleistenQuellen
} from './redaktion'

const quellen = (ueber: Partial<ZeitleistenQuellen> = {}): ZeitleistenQuellen => ({
  ankuendigungen: [],
  bereiche: [],
  datensaetze: [],
  laeufe: [],
  ...ueber
})

const monat = (ueber: Partial<NonNullable<ZeitleistenQuellen['suedanflug']>[number]> = {}) => ({
  id: 'q-juli',
  jahr: 2026,
  monat: 7,
  quote: 43.7,
  anfluege: 3778,
  suedlandungen: 1652,
  aktualisiert_am: '2026-08-04',
  provisorisch: true,
  vorschlag: true,
  vorschlag_begruendung: 'Juli 2026: 43,7 Prozent der Landungen erfolgten ueber den Sueden.',
  befunde: [],
  quelle_url: 'https://www.euroairport.com/blatt.pdf',
  ...ueber
})

describe('monatsname und monatsende', () => {
  it('nennt den Monat auf Deutsch', () => {
    expect(monatsname(2026, 7)).toBe('Juli 2026')
    expect(monatsname(2025, 12)).toBe('Dezember 2025')
  })

  it('kennt die Laenge jedes Monats', () => {
    expect(monatsende(2026, 2)).toBe('2026-02-28')
    // Schaltjahr — sonst stuende der Februar 2024 einen Tag zu frueh.
    expect(monatsende(2024, 2)).toBe('2024-02-29')
    expect(monatsende(2026, 7)).toBe('2026-07-31')
  })
})

describe('suedanflugTitel', () => {
  it('nennt Monat und Quote mit Dezimalkomma', () => {
    expect(suedanflugTitel({ jahr: 2026, monat: 7, quote: 43.7 })).toBe(
      'Südanflug-Quote Juli 2026: 43,7 Prozent'
    )
  })

  it('sagt es, wenn das Blatt keine Quote druckt', () => {
    expect(suedanflugTitel({ jahr: 2026, monat: 7, quote: null })).toContain('ohne Quote')
  })
})

describe('zeitleiste mit Suedanflug', () => {
  it('mischt die Monatsblaetter in dieselbe Liste', () => {
    const { datiert } = zeitleiste(quellen({ suedanflug: [monat()] }))

    expect(datiert.length).toBe(1)
    expect(datiert[0]?.herkunft).toBe('suedanflug')
    expect(datiert[0]?.titel).toContain('43,7 Prozent')
    expect(datiert[0]?.quoteId).toBe('q-juli')
    expect(datiert[0]?.vorschlag).toBe(true)
    expect(datiert[0]?.link).toBe('https://www.euroairport.com/blatt.pdf')
  })

  it('datiert nach dem Stand, den das Blatt selbst nennt', () => {
    const { datiert } = zeitleiste(quellen({ suedanflug: [monat()] }))

    expect(datiert[0]?.datum).toBe('2026-08-04')
  })

  it('stellt ein Blatt ohne Stand ans Monatsende statt unter die Undatierten', () => {
    const { datiert, ohneDatum } = zeitleiste(quellen({ suedanflug: [monat({ aktualisiert_am: null })] }))

    expect(datiert[0]?.datum).toBe('2026-07-31')
    expect(ohneDatum).toEqual([])
  })

  it('sortiert die Monatsblaetter mit dem Rest, neueste zuerst', () => {
    const { datiert } = zeitleiste(
      quellen({
        bereiche: [{ id: 'b1', pfad: '18_4', titel: 'Steuern', stand: '2026-06-11', beobachten: true }],
        suedanflug: [monat()]
      })
    )

    expect(datiert.map((e) => e.herkunft)).toEqual(['suedanflug', 'portal'])
  })

  it('traegt die Befunde des Blatts mit', () => {
    const { datiert } = zeitleiste(
      quellen({
        suedanflug: [
          monat({
            befunde: ['7. August 2026: 130 Suedlandungen bei 128 Anfluegen.']
          })
        ]
      })
    )

    expect(datiert[0]?.befunde.length).toBe(1)
  })

  it('bleibt leer, solange die Quelle inaktiv ist', () => {
    expect(zeitleiste(quellen()).datiert).toEqual([])
  })
})

describe('meldungenNachSuedanflug', () => {
  it('buendelt mehrere Gemeinden unter einem Monatsblatt', () => {
    const nach = meldungenNachSuedanflug([
      { suedanflugquote: { id: 'q-juli' }, gemeinde: { id: 'g-bin' } },
      { suedanflugquote: { id: 'q-juli' }, gemeinde: { id: 'g-all' } },
      { suedanflugquote: null, gemeinde: { id: 'g-bin' } },
      { suedanflugquote: { id: 'q-august' }, gemeinde: { id: 'g-bin' } }
    ])

    expect(nach.get('q-juli')?.length).toBe(2)
    expect(nach.get('q-august')?.length).toBe(1)
    expect(nach.size).toBe(2)
  })
})
