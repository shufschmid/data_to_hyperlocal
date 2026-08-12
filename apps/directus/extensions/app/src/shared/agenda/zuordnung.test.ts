import { describe, expect, it } from 'vitest'
import {
  buildKatalogSystem,
  buildZuordnungPrompt,
  parseZuordnung,
  zuordnungHinweis,
  type KatalogEintrag
} from './zuordnung'

function eintrag(ueber: Partial<KatalogEintrag>): KatalogEintrag {
  return {
    id: 'uuid-1',
    externe_id: '12060',
    titel: 'Abfallmengen nach Kategorie, Gemeinde und Jahr (seit 2017)',
    hat_gemeinde: true,
    ...ueber
  }
}

const katalog = [
  eintrag({}),
  eintrag({
    id: 'uuid-2',
    externe_id: '10570',
    titel: 'Finanzausgleich nach Gemeinde und Jahr'
  }),
  eintrag({
    id: 'uuid-3',
    externe_id: '10240',
    titel: 'Baukosten nach Bezirk und Jahr',
    hat_gemeinde: false
  })
]

describe('buildKatalogSystem', () => {
  // Der Katalog ist der gecachte Praefix. Eine wechselnde Reihenfolge waere in
  // der Ausgabe unsichtbar und stuende nur auf der Rechnung.
  it('ist byte-identisch, unabhaengig von der Eingabereihenfolge', () => {
    const gedreht = [...katalog].reverse()
    expect(buildKatalogSystem(gedreht)).toBe(buildKatalogSystem(katalog))
  })

  it('nennt jede ID mit ihrem Titel', () => {
    const text = buildKatalogSystem(katalog)
    expect(text).toContain(
      '12060 | Abfallmengen nach Kategorie, Gemeinde und Jahr (seit 2017)'
    )
    expect(text).toContain('10570 | Finanzausgleich nach Gemeinde und Jahr')
  })

  // Ein Datensatz ohne Gemeindespalte ist trotzdem die richtige Antwort — er
  // taugt nur nicht fuer Meldungen. Das Modell soll ihn nennen duerfen.
  it('markiert Datensaetze ohne Gemeindegliederung, statt sie wegzulassen', () => {
    const text = buildKatalogSystem(katalog)
    expect(text).toContain(
      '10240 | Baukosten nach Bezirk und Jahr [ohne Gemeindegliederung]'
    )
  })

  it('nennt die Regel gegen erfundene IDs', () => {
    expect(buildKatalogSystem(katalog)).toContain('Erfinde keine ID')
  })
})

describe('buildZuordnungPrompt', () => {
  it('stellt nur den Eintrag in den User-Turn', () => {
    const prompt = buildZuordnungPrompt({
      titel: 'Abfallstatistik 2025',
      datum: '2026-07-07',
      quartal: '3. Quartal: Juli–September'
    })

    expect(prompt).toContain('Abfallstatistik 2025')
    expect(prompt).toContain('2026-07-07')
    // Der Katalog gehoert in den System-Block, sonst wird nichts gecacht.
    expect(prompt).not.toContain('12060')
  })

  it('kommt ohne Datum aus', () => {
    const prompt = buildZuordnungPrompt({
      titel: 'Haushalte 2025',
      datum: null,
      quartal: null
    })
    expect(prompt).toContain('(noch nicht publiziert)')
  })
})

describe('parseZuordnung', () => {
  it('loest eine gueltige ID zum Datensatz auf', () => {
    const zuordnung = parseZuordnung(
      {
        externe_id: '12060',
        begruendung: 'Abfallmengen sind die Abfallstatistik.'
      },
      katalog
    )

    expect(zuordnung.datensatz?.id).toBe('uuid-1')
    expect(zuordnung.begruendung).toBe('Abfallmengen sind die Abfallstatistik.')
  })

  it('nimmt null als Antwort an', () => {
    const zuordnung = parseZuordnung(
      {
        externe_id: null,
        begruendung: 'Diese Statistik gibt es im Portal nicht.'
      },
      katalog
    )

    expect(zuordnung.datensatz).toBeNull()
  })

  // Eine erfundene ID trifft sonst irgendeinen Datensatz mit dieser Nummer und
  // die Arbeitsflaeche zeigt einen plausiblen Titel neben der falschen Statistik.
  it('verwirft eine ID, die nicht im Katalog stand', () => {
    const zuordnung = parseZuordnung(
      { externe_id: '99999', begruendung: 'Passt genau.' },
      katalog
    )

    expect(zuordnung.datensatz).toBeNull()
    expect(zuordnung.begruendung).toContain('99999')
  })

  it('kommt ohne Begruendung aus, statt zu werfen', () => {
    expect(parseZuordnung({ externe_id: null }, katalog).begruendung).toBe(
      'Ohne Begruendung.'
    )
  })

  it('wirft bei einer Antwort, die kein Objekt ist', () => {
    expect(() => parseZuordnung('12060', katalog)).toThrow()
  })
})

describe('zuordnungHinweis', () => {
  it('nennt bei einem Treffer den Titel des Datensatzes', () => {
    const hinweis = zuordnungHinweis({
      datensatz: katalog[0]!,
      begruendung: 'Gleiches Thema.'
    })
    expect(hinweis).toContain('Abfallmengen')
    expect(hinweis).toContain('Gleiches Thema.')
  })

  it('sagt beim Fehltreffer, dass keiner passt', () => {
    expect(
      zuordnungHinweis({ datensatz: null, begruendung: 'Nur kantonal.' })
    ).toContain('Kein passender Datensatz')
  })
})
