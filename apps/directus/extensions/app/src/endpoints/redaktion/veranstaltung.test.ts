import { describe, expect, it } from 'vitest'
import {
  anlassFakten,
  dauerangebotJetzt,
  pruefeDauerangebotModus,
  type AnlassRohzeile
} from './veranstaltung'
import {
  pruefeQuelle,
  pruefeQuellenAenderung,
  standardName
} from './veranstaltungsquelle'

const zeile = (ueber: Partial<AnlassRohzeile> = {}): AnlassRohzeile => ({
  id: 'a1',
  titel: 'Markt des Alterns',
  termine: ['2026-09-25'],
  von: '2026-09-25',
  bis: null,
  zeit: '13:00–18:00',
  lokalitaet: 'KUSPO',
  adresse: null,
  ort: 'Pratteln',
  veranstalter: 'Gemeinde Pratteln',
  kategorie: null,
  preis: null,
  anmeldung: null,
  frist_am: null,
  beschreibung: 'Text.',
  text_abgeschnitten: false,
  dokumente: [
    {
      bezeichnung: 'Flyer',
      url: 'https://www.pratteln.ch/_doc/1',
      typ: 'pdf',
      gelesen: true,
      text: 'Flyertext'
    }
  ],
  traktanden: null,
  traktanden_url: null,
  anker: 'einmalig',
  zugang: 'offen',
  url: 'https://www.pratteln.ch/_rte/anlass/7353004',
  url_kanonisch: null,
  entscheid: 'offen',
  vorschlag_begruendung: null,
  dauerangebot: null,
  gemeinde: { id: 'g1', name: 'Pratteln' },
  quelle: {
    id: 'q1',
    name: 'Veranstaltungskalender der Gemeinde Pratteln',
    url: 'https://www.pratteln.ch/anlaesseaktuelles'
  },
  ...ueber
})

describe('anlassFakten', () => {
  it('bildet die Zeile auf die Fakten ab, mit dem Kalendernamen und dem heutigen Tag', () => {
    const f = anlassFakten(zeile(), '2026-09-19')
    expect(f).toMatchObject({
      gemeinde: 'Pratteln',
      quelleName: 'Veranstaltungskalender der Gemeinde Pratteln',
      termine: ['2026-09-25'],
      anker: 'einmalig',
      dauerangebot: false,
      url: 'https://www.pratteln.ch/_rte/anlass/7353004',
      heute: '2026-09-19',
      traktanden: []
    })
    expect(f.dokumente[0]).toEqual({
      bezeichnung: 'Flyer',
      url: 'https://www.pratteln.ch/_doc/1',
      typ: 'pdf',
      gelesen: true,
      text: 'Flyertext',
      grund: null
    })
  })

  it('ein Dauerangebot erkennt sich am Anker; der kanonische Link gewinnt', () => {
    const f = anlassFakten(
      zeile({
        anker: 'dauerangebot',
        url_kanonisch: 'https://www.pratteln.ch/k'
      }),
      '2026-09-19'
    )
    expect(f.dauerangebot).toBe(true)
    expect(f.url).toBe('https://www.pratteln.ch/k')
  })
})

describe('Dauerangebot-Schalter', () => {
  it('kennt drei Stellungen', () => {
    expect(pruefeDauerangebotModus({ modus: 'nie' })).toBe('nie')
    expect(pruefeDauerangebotModus({ modus: 'intervall' })).toBe('intervall')
    expect(pruefeDauerangebotModus({ modus: 'jetzt' })).toBe('jetzt')
    expect(pruefeDauerangebotModus({ modus: 'morgen' })).toBeNull()
    expect(pruefeDauerangebotModus(null)).toBeNull()
  })

  it('«jetzt» ist ein Vorschlag ohne Modell, auf heute datiert', () => {
    expect(dauerangebotJetzt('2026-09-19')).toMatchObject({
      anker: 'dauerangebot',
      anker_am: '2026-09-19',
      vorschlag: true,
      zuletzt_vorgelegt_am: '2026-09-19',
      entscheid: 'offen'
    })
  })
})

describe('pruefeQuelle', () => {
  const liest = async () => ({
    plattform: 'iweb_termine' as const,
    gefunden: 21
  })

  it('liest die Seite vor dem Speichern und benennt den Kalender', async () => {
    const ergebnis = await pruefeQuelle(
      {
        roh: { url: 'https://www.aesch.bl.ch/anlaesseaktuelles' },
        liesSeite: liest
      },
      'Aesch'
    )
    expect(ergebnis).toEqual({
      status: 'geprueft',
      felder: {
        url: 'https://www.aesch.bl.ch/anlaesseaktuelles',
        name: 'Veranstaltungskalender der Gemeinde Aesch',
        art: 'gemeinde',
        aktiv: true,
        plattform: 'iweb_termine',
        letzter_hinweis: null
      },
      gefunden: 21
    })
  })

  it('weist Unsinn ab und meldet eine unlesbare Seite mit Grund', async () => {
    expect(
      await pruefeQuelle(
        { roh: { url: 'aesch.ch' }, liesSeite: liest },
        'Aesch'
      )
    ).toMatchObject({
      status: 'ungueltig'
    })
    const kaputt = await pruefeQuelle(
      {
        roh: { url: 'https://www.aesch.bl.ch/aktuellesinformationen' },
        liesSeite: async () => {
          throw new Error(
            'Die Seite ist eine Newsuebersicht, keine Veranstaltungsuebersicht.'
          )
        }
      },
      'Aesch'
    )
    expect(kaputt).toEqual({
      status: 'nicht_lesbar',
      grund:
        'Die Seite ist eine Newsuebersicht, keine Veranstaltungsuebersicht.'
    })
  })

  it('eine Plattform wird angelegt, aber inaktiv, und sagt warum', async () => {
    const ergebnis = await pruefeQuelle(
      {
        roh: {
          url: 'https://crossiety.app/dorfplatz/aesch/agenda',
          art: 'plattform'
        },
        liesSeite: async () => {
          throw new Error('darf nicht gelesen werden')
        }
      },
      'Aesch'
    )
    expect(ergebnis).toMatchObject({
      status: 'geprueft',
      felder: {
        art: 'plattform',
        aktiv: false,
        name: 'crossiety.app',
        plattform: null
      },
      gefunden: 0
    })
    expect(
      standardName('ort', 'Pratteln', 'https://z-7.ch/#event-calendar')
    ).toBe('z-7.ch')
  })

  it('die Aenderung nimmt nur den Schalter und den Namen', () => {
    expect(
      pruefeQuellenAenderung({ aktiv: false, name: ' Z7 ', url: 'x' })
    ).toEqual({
      aktiv: false,
      name: 'Z7'
    })
    expect(pruefeQuellenAenderung({ url: 'x' })).toBeNull()
  })
})
