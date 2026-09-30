import { describe, expect, it } from 'vitest'
import {
  anlassFakten,
  brauchtNachlesen,
  type AnlassRohzeile
} from './veranstaltung'
import { pruefeQuelle } from './veranstaltungsquelle'

const LISTE =
  'https://www.blutspende.ch/de/blutspendetermine/terminliste?location_search_form%5Bradius%5D=0&location_search_form%5Bterm%5D=4147'

// Seit dem 30. September 2026 liest die Registrierung JEDE Art: erkennt ein
// Leser die Vorlage, ist die Zeile aktiv; sonst ruht sie mit dem Grund — nur
// der Kalender der Gemeinde wird abgewiesen, denn dort ist es eine falsche
// Adresse und kein fehlender Leser.
describe('pruefeQuelle — eine Organisation ueber ihre PLZ-Suche', () => {
  it('wird aktiv, wenn die Seite als Terminliste erkannt ist — auch leer', async () => {
    const ergebnis = await pruefeQuelle(
      {
        roh: {
          url: LISTE,
          art: 'organisation',
          name: 'Blutspende SRK Schweiz'
        },
        liesSeite: async () => ({
          plattform: 'blutspende_termine',
          gefunden: 0
        })
      },
      'Bottmingen'
    )
    expect(ergebnis).toEqual({
      status: 'geprueft',
      felder: {
        url: LISTE,
        name: 'Blutspende SRK Schweiz',
        art: 'organisation',
        aktiv: true,
        plattform: 'blutspende_termine',
        letzter_hinweis: null
      },
      gefunden: 0
    })
  })

  it('ruht mit dem Grund, wo kein Leser die Seite erkennt', async () => {
    const ergebnis = await pruefeQuelle(
      {
        roh: {
          url: 'https://crossiety.app/dorfplatz/aesch/agenda',
          art: 'plattform'
        },
        liesSeite: async () => {
          throw new Error(
            'Seitenaufbau nicht erkannt (keine der bekannten Plattformen)'
          )
        }
      },
      'Aesch'
    )
    expect(ergebnis).toMatchObject({
      status: 'geprueft',
      felder: {
        art: 'plattform',
        aktiv: false,
        plattform: null,
        letzter_hinweis:
          'Noch kein Leser für diesen Kalender: Seitenaufbau nicht erkannt (keine der bekannten Plattformen)'
      }
    })
    // Der Kalender der Gemeinde wird weiterhin abgewiesen.
    expect(
      await pruefeQuelle(
        {
          roh: { url: 'https://www.aesch.bl.ch/x', art: 'gemeinde' },
          liesSeite: async () => {
            throw new Error('nicht erkannt')
          }
        },
        'Aesch'
      )
    ).toEqual({ status: 'nicht_lesbar', grund: 'nicht erkannt' })
  })
})

const zeile = (ueber: Partial<AnlassRohzeile> = {}): AnlassRohzeile => ({
  id: 'b1',
  titel: 'Blutspende in Aesch',
  termine: ['2027-01-26'],
  von: '2027-01-26',
  bis: null,
  zeit: '17:00–20:00',
  lokalitaet: 'Röm. Kath. Pfarrheim',
  adresse: 'In den Saalbünten 1',
  ort: 'Aesch',
  veranstalter: 'Blutspende SRK Nordwestschweiz (BS/BL)',
  kategorie: 'Blutspende',
  preis: null,
  anmeldung: 'Termin online reservierbar',
  frist_am: null,
  beschreibung: null,
  text_abgeschnitten: false,
  dokumente: [],
  traktanden: null,
  traktanden_url: null,
  anker: 'einmalig',
  anker_am: '2027-01-26',
  zugang: 'unbekannt',
  url: 'https://www.blutspende.ch/de/blutspendetermine/termin/pdja37vslwxsilljm_xuta',
  url_kanonisch: null,
  plattform: 'blutspende_termine',
  gelesen_am: '2026-12-01T13:05:00Z',
  entscheid: 'offen',
  vorschlag_begruendung: null,
  dauerangebot: null,
  gemeinde: { id: 'g1', name: 'Aesch' },
  quelle: {
    id: 'q1',
    name: 'Blutspende SRK Schweiz',
    url: LISTE,
    art: 'organisation'
  },
  ...ueber
})

// Eine Eckdaten-Vorlage traegt NIE einen Beschrieb: einmal gelesen genuegt,
// und ein Nachlesen bei jedem Klick machte aus einem Aussetzer von
// blutspende.ch eine Absage fuer eine Zeile, die alle Fakten laengst hat.
describe('brauchtNachlesen', () => {
  it('liest eine gelesene Eckdaten-Zeile nicht noch einmal — eine ungelesene schon', () => {
    const z = zeile()
    expect(brauchtNachlesen(z, anlassFakten(z, '2026-12-28'))).toBe(false)
    const ungelesen = zeile({ gelesen_am: null })
    expect(
      brauchtNachlesen(ungelesen, anlassFakten(ungelesen, '2026-12-28'))
    ).toBe(true)
  })

  it('liest jede andere Zeile ohne Material nach, und jede falsch gelesene', () => {
    const iweb = zeile({ plattform: 'iweb_termine' })
    expect(brauchtNachlesen(iweb, anlassFakten(iweb, '2026-12-28'))).toBe(true)
    const mitText = zeile({
      plattform: 'iweb_termine',
      beschreibung: 'Ein Beschrieb.'
    })
    expect(brauchtNachlesen(mitText, anlassFakten(mitText, '2026-12-28'))).toBe(
      false
    )
    const falsch = zeile({
      url: 'https://www.example.ch/anlaesse/detail/7',
      url_kanonisch: 'https://www.example.ch/anlaesse/'
    })
    expect(brauchtNachlesen(falsch, anlassFakten(falsch, '2026-12-28'))).toBe(
      true
    )
  })

  it('reicht die Art der Quelle an die Fakten weiter', () => {
    expect(anlassFakten(zeile(), '2026-12-28').quelleArt).toBe('organisation')
  })
})
