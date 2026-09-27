import {
  abstimmungstage,
  abstimmungsterminText,
  abstimmungsTitel,
  meldungenNachAbstimmung,
  zeitleiste
} from './redaktion'

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
  it('nimmt einen Abstimmungstag als fünften Zufluss auf, datiert auf den Sonntag', () => {
    const ergebnis = zeitleiste({ ...LEER, abstimmungen: [VORLAGE] }, 40)
    const zeile = ergebnis.datiert[0]

    expect(zeile?.herkunft).toBe('abstimmung')
    expect(zeile?.datum).toBe('2026-09-27')
    expect(zeile?.abstimmungId).toBe('a-1')
    expect(zeile?.link).toBe('https://vework-public.bl.ch/app/publication/2026-09-27')
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

describe('abstimmungstage — eine Zeile je Sonntag', () => {
  const ZWEITE = {
    ...VORLAGE,
    id: 'a-0',
    vote_id: '20260927_E1',
    titel: 'Neutralitätsinitiative',
    gemeindezahlen: [
      { bfs: '2765', gemeinde: 'Binningen', ausgezaehlt: false, ergebnisse: [] },
      { bfs: '2761', gemeinde: 'Aesch (BL)', ausgezaehlt: false, ergebnisse: [] }
    ],
    gemeinden_ausgezaehlt: 20
  }

  it('fasst die Vorlagen eines Tages zusammen, die erste nach vote_id vorne', () => {
    const [tag] = abstimmungstage([VORLAGE, ZWEITE])
    expect(tag?.vorlagen.map((v) => v.id)).toEqual(['a-0', 'a-1'])
    expect(tag?.gemeindenAusgezaehlt).toBe(20)
  })

  it('zählt eine Gemeinde erst als ausgezählt, wenn sie es in jeder Vorlage ist', () => {
    const [tag] = abstimmungstage([VORLAGE, ZWEITE])
    expect(tag?.gemeinden.find((g) => g.bfs === '2765')?.ausgezaehlt).toBe(false)
  })

  it('macht aus zwei Vorlagen EINE Zeile, die beide Ids kennt', () => {
    const zeilen = zeitleiste({ ...LEER, abstimmungen: [VORLAGE, ZWEITE] }, 40).datiert
    expect(zeilen).toHaveLength(1)
    expect(zeilen[0]?.abstimmungId).toBe('a-0')
    expect(zeilen[0]?.abstimmungIds).toEqual(['a-0', 'a-1'])
    expect(zeilen[0]?.titel).toContain('2 Vorlagen')
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

describe('die kommenden Abstimmungstage des Bundes', () => {
  const TERMINE = [
    { id: 't1', datum: '2026-09-27', art: 'festgelegt', vorlagen: 2 },
    { id: 't2', datum: '2026-11-29', art: 'festgelegt', vorlagen: 4 },
    { id: 't3', datum: '2027-02-28', art: 'blanko', vorlagen: null },
    { id: 't4', datum: '2027-10-24', art: 'nationalratswahlen', vorlagen: null },
    { id: 't5', datum: '2026-06-14', art: 'genutzt', vorlagen: 2 }
  ]

  it('zeigt die Tage des nächsten Jahres, aber keinen, der schon Resultate hat', () => {
    const zeilen = zeitleiste(
      { ...LEER, abstimmungen: [VORLAGE], abstimmungstermine: TERMINE, heute: '2026-09-27' },
      40
    ).datiert
    const termine = zeilen.filter((z) => z.herkunft === 'abstimmungstermin').map((z) => z.datum)
    // Der 27.09. steht als Abstimmungszeile da, der 24.10.2027 liegt über ein Jahr voraus.
    expect(termine).toEqual(['2027-02-28', '2026-11-29'])
    expect(zeilen.filter((z) => z.herkunft === 'abstimmung')).toHaveLength(1)
  })

  it('sagt, was die Liste weiss und was nicht', () => {
    expect(abstimmungsterminText(TERMINE[1]!).titel).toBe(
      'Abstimmungssonntag vom 29.11.2026 · 4 eidgenössische Vorlagen'
    )
    expect(abstimmungsterminText(TERMINE[2]!)).toMatchObject({
      titel: 'Abstimmungssonntag vom 28.02.2027 · Blanko-Termin'
    })
    expect(abstimmungsterminText(TERMINE[2]!).hinweis).toMatch(/spätestens vier Monate vorher/)
    expect(abstimmungsterminText(TERMINE[2]!).hinweis).toMatch(/Kantonale Vorlagen nennt diese Liste nicht/)
    expect(abstimmungsterminText(TERMINE[3]!).titel).toBe('Nationalratswahlen vom 24.10.2027')
  })
})
