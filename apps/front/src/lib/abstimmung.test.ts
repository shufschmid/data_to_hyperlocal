import { abstimmungsTitel, meldungenNachAbstimmung, zeitleiste } from './redaktion'

const VORLAGE = {
  id: 'a-1',
  vote_id: '20260927_K3',
  datum: '2026-09-27',
  titel: 'Formulierte Gesetzesinitiative «Fairer Kompromiss bei der Mehrwertabgabe»',
  ebene: 'kanton',
  gemeindezahlen: [
    { bfs: '2765', gemeinde: 'Binningen', ausgezaehlt: true, ergebnisse: [] },
    { bfs: '2761', gemeinde: 'Aesch (BL)', ausgezaehlt: false, ergebnisse: [] }
  ],
  gemeinden_total: 86,
  gemeinden_ausgezaehlt: 40,
  ausgezaehlt: false,
  stichfrage_gilt: false,
  stichfrage_grund: 'Der Kanton ist noch nicht fertig ausgezählt.',
  quelle_url: 'https://vework-public.bl.ch/app/publication/2026-09-27/issues/k3a'
}

const LEER = { ankuendigungen: [], bereiche: [], datensaetze: [], laeufe: [] }

describe('abstimmungsTitel', () => {
  it('nennt Datum und Vorlage', () => {
    expect(abstimmungsTitel(VORLAGE)).toContain('Abstimmung vom 27.09.2026')
    expect(abstimmungsTitel(VORLAGE)).toContain('Mehrwertabgabe')
  })
})

describe('die Zeitleiste', () => {
  it('nimmt eine Vorlage als fünften Zufluss auf, datiert auf den Abstimmungstag', () => {
    const ergebnis = zeitleiste({ ...LEER, abstimmungen: [VORLAGE] }, 40)
    const zeile = ergebnis.datiert[0]

    expect(zeile?.herkunft).toBe('abstimmung')
    expect(zeile?.datum).toBe('2026-09-27')
    expect(zeile?.abstimmungId).toBe('a-1')
    expect(zeile?.link).toBe(VORLAGE.quelle_url)
  })

  it('sagt auf der Zeile, wie weit ausgezählt ist', () => {
    const zeile = zeitleiste({ ...LEER, abstimmungen: [VORLAGE] }, 40).datiert[0]

    expect(zeile?.hinweis).toContain('40 von 86')
  })

  it('zeigt nur die ausgezählten Gemeinden als schreibbar', () => {
    const zeile = zeitleiste({ ...LEER, abstimmungen: [VORLAGE] }, 40).datiert[0]

    expect(zeile?.abstimmungsgemeinden.map((g) => g.bfs)).toEqual(['2765', '2761'])
    expect(zeile?.abstimmungsgemeinden[0]?.ausgezaehlt).toBe(true)
    expect(zeile?.abstimmungsgemeinden[1]?.ausgezaehlt).toBe(false)
  })
})

describe('meldungenNachAbstimmung', () => {
  it('bündelt je Vorlage, eine Meldung je Gemeinde', () => {
    const nach = meldungenNachAbstimmung([
      { abstimmung: { id: 'a-1' } },
      { abstimmung: { id: 'a-1' } },
      { abstimmung: null }
    ])

    expect(nach.get('a-1')).toHaveLength(2)
    expect(nach.size).toBe(1)
  })
})
