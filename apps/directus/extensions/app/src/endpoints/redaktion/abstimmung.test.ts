import { describe, expect, it } from 'vitest'
import { faktenFuer, meldungsfelder, type Abstimmungszeile } from './abstimmung'

const URL_K3 =
  'https://vework-public.bl.ch/app/publication/2026-09-27/issues/k3a'

const zeile = (ueber: Partial<Abstimmungszeile> = {}): Abstimmungszeile => ({
  id: 'a-1',
  vote_id: '20260927_K3',
  datum: '2026-09-27',
  titel:
    'Formulierte Gesetzesinitiative «Fairer Kompromiss bei der Mehrwertabgabe»',
  ebene: 'kanton',
  teile: [
    {
      art: 'vorlage',
      titel:
        'Formulierte Gesetzesinitiative «Fairer Kompromiss bei der Mehrwertabgabe»',
      url: URL_K3,
      kanton: {
        ja: 40000,
        nein: 30000,
        prozentJa: 57.142857,
        beteiligung: 44.4,
        stimmberechtigte: 190000,
        leer: 500,
        ungueltig: 300,
        antwort: 'angenommen',
        gemeinden: 86
      }
    }
  ],
  gemeindezahlen: [
    {
      bfs: '2765',
      gemeinde: 'Binningen',
      ausgezaehlt: true,
      ergebnisse: [
        {
          art: 'vorlage',
          antwort: 'angenommen',
          ja: 2100,
          nein: 1500,
          prozentJa: 58.3,
          beteiligung: 47.2,
          stimmberechtigte: 8000,
          leer: 40,
          ungueltig: 30
        }
      ]
    },
    {
      bfs: '2761',
      gemeinde: 'Aesch (BL)',
      ausgezaehlt: false,
      ergebnisse: []
    }
  ],
  gemeinden_total: 86,
  gemeinden_ausgezaehlt: 85,
  ausgezaehlt: false,
  stichfrage_gilt: false,
  stichfrage_grund: 'Zu dieser Frage gibt es keinen Gegenvorschlag.',
  vergleich: {
    datum: '2026-06-14',
    gemeinden: [{ bfs: '2765', beteiligung: 54.9 }]
  },
  quelle_url: URL_K3,
  ...ueber
})

const binningen = { id: 'g-1', name: 'Binningen', bfs_nummer: 2765 }
const aesch = { id: 'g-2', name: 'Aesch (BL)', bfs_nummer: 2761 }

describe('faktenFuer — das Tor vor jedem Artikel', () => {
  it('schreibt fuer eine ausgezaehlte Gemeinde', () => {
    const fakten = faktenFuer({ zeile: zeile(), gemeinde: binningen })

    expect(fakten.gemeinde).toBe('Binningen')
    expect(fakten.teile[0]?.gemeinde?.ja).toBe(2100)
    expect(fakten.vergleich?.beteiligung).toBe(54.9)
  })

  it('verweigert eine Gemeinde, die noch auszaehlt', () => {
    // Die wichtigste Regel dieses Zuflusses, am Endpunkt: eine teilausgezaehlte
    // Gemeinde ist kein Zwischenstand, sondern ein Nichts.
    expect(() => faktenFuer({ zeile: zeile(), gemeinde: aesch })).toThrow()
  })

  it('verweigert eine Gemeinde, die der Datensatz gar nicht fuehrt', () => {
    const riehen = { id: 'g-3', name: 'Riehen', bfs_nummer: 2703 }

    expect(() => faktenFuer({ zeile: zeile(), gemeinde: riehen })).toThrow()
  })

  it('verweigert eine Zeile ohne Adresse der Publikation', () => {
    // Die Quellenzeile baut der Code und traegt genau eine Adresse. Eine
    // Meldung, die eine Quelle nennt, die niemand oeffnen kann, ist schlimmer
    // als keine.
    expect(() =>
      faktenFuer({ zeile: zeile({ quelle_url: null }), gemeinde: binningen })
    ).toThrow()
    expect(() =>
      faktenFuer({ zeile: zeile({ quelle_url: '  ' }), gemeinde: binningen })
    ).toThrow()
  })

  it('laesst den Vergleich weg, wenn diese Gemeinde keinen hat', () => {
    const fakten = faktenFuer({
      zeile: zeile({ vergleich: { datum: '2026-06-14', gemeinden: [] } }),
      gemeinde: binningen
    })

    expect(fakten.vergleich).toBeNull()
  })

  it('uebergibt die Stichfrage nicht, wenn sie nichts entscheidet', () => {
    const fakten = faktenFuer({ zeile: zeile(), gemeinde: binningen })

    expect(fakten.teile.some((t) => t.art === 'stichfrage')).toBe(false)
    expect(fakten.stichfrage.gilt).toBe(false)
  })
})

describe('meldungsfelder', () => {
  it('haengt die Quellenzeile an und legt die Warnungen dazu', () => {
    const fakten = faktenFuer({ zeile: zeile(), gemeinde: binningen })
    const felder = meldungsfelder(
      {
        bericht: {
          titel: 'Binningen sagt Ja',
          lead: 'Ein Satz.',
          text: 'Ein Absatz.'
        },
        warnungen: ['Eine Warnung.']
      },
      fakten
    )

    expect(String(felder['text'])).toContain(URL_K3)
    expect(felder['zeit_warnungen']).toEqual(['Eine Warnung.'])
    expect(felder['verarbeitung']).toBe('idle')
  })
})
