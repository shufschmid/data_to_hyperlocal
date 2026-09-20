import { describe, expect, it } from 'vitest'
import { heuteAus } from '../gemeindeseite/datum'
import {
  abgesagtOderVerschoben,
  anmeldefrist,
  berechneAnker,
  dauerangebotNachEntscheid,
  erkenneZugang,
  imVorschlagsfenster,
  istAbfuhr,
  istGremium,
  istPlatzhalter,
  waehleDauerangebote,
  type AnkerEingabe
} from './anker'

const HEUTE = '2026-09-18'
const HEUTE_OBJ = heuteAus(HEUTE)
const BEKANNT = { erstlauf: false, bekannt: true }
const UNBEKANNT = { erstlauf: false, bekannt: false }

const anlass = (
  ueber: Partial<AnkerEingabe> & { titel: string }
): AnkerEingabe => ({
  termine: ['2026-09-25'],
  von: '2026-09-25',
  bis: null,
  spanne: false,
  text: '',
  kategorie: null,
  teaser: null,
  abgesagt: false,
  serieSeit: null,
  ...ueber
})

describe('Erkenner', () => {
  it('Abfuhr, Platzhalter, Gremium, Absage', () => {
    expect(istAbfuhr({ titel: 'Grünabfuhr' })).toBe(true)
    expect(istAbfuhr({ titel: 'Kunststoffsammlung' })).toBe(true)
    expect(istAbfuhr({ titel: 'Häckseldienst' })).toBe(true)
    expect(istAbfuhr({ titel: 'Markt des Alterns' })).toBe(false)
    expect(istPlatzhalter('Blanko-Abstimmungstermin')).toBe(true)
    expect(istPlatzhalter('Reservetermin Gemeindeversammlung')).toBe(true)
    expect(istPlatzhalter('Gemeindeversammlung')).toBe(false)
    expect(istGremium('Einwohnerratssitzung')).toBe(true)
    expect(istGremium('Eidg. und kantonale Abstimmungen vom 27.09.2026')).toBe(
      true
    )
    expect(istGremium('Abstimmungs-/Wahlsonntag')).toBe(true)
    expect(istGremium('Auswahl der besten Weine')).toBe(false)
    expect(
      abgesagtOderVerschoben('Gemeindeversammlung findet nicht statt')
    ).toBe('ausfall')
    expect(
      abgesagtOderVerschoben(
        'Die Führung wurde vom 19. auf den 26. September verschoben.'
      )
    ).toBe('verschoben')
    expect(abgesagtOderVerschoben('Kein Vorwissen nötig.')).toBeNull()
  })

  it('liest die Anmeldefrist aus dem Satz, auch ohne Jahr', () => {
    expect(
      anmeldefrist('Anmeldung bis 21. September in der Bibliothek', HEUTE_OBJ)
    ).toBe('2026-09-21')
    expect(
      anmeldefrist(
        'Anmeldeschluss: bis Mittwoch, 23.09.2026, 12 Uhr',
        HEUTE_OBJ
      )
    ).toBe('2026-09-23')
    expect(anmeldefrist('Keine Anmeldung notwendig.', HEUTE_OBJ)).toBeNull()
  })

  it('unterscheidet offenen Zugang von Programm', () => {
    expect(
      erkenneZugang(
        'Eine Ausstellung vom 9. Mai 2026 bis 21. März 2027, Mi/Fr/Sa/So 14–17 Uhr'
      )
    ).toBe('offen')
    expect(
      erkenneZugang('Herbstcamp für Kinder. Anmeldung bis 20. September.')
    ).toBe('programm')
    expect(
      erkenneZugang('Ausstellung mit Führung, Anmeldung für Gruppen erbeten')
    ).toBe('offen')
    expect(erkenneZugang('Wir treffen uns im Park.')).toBe('unbekannt')
  })
})

describe('berechneAnker — die Reihenfolge der Regeln', () => {
  it('Abfuhr vor allem anderen, auch vor dem Rhythmus (Aeschs Gruenabfuhr alle drei Wochen)', () => {
    const befund = berechneAnker(
      anlass({
        titel: 'Grünabfuhr',
        termine: ['2026-09-21', '2026-10-12', '2026-11-02'],
        von: '2026-09-21'
      }),
      HEUTE,
      BEKANNT,
      HEUTE_OBJ
    )
    expect(befund).toMatchObject({ anker: 'abfuhr', ankerAm: '2026-09-21' })
  })

  it('Platzhalter nie, Ausfall und Verschiebung vor dem Gremium', () => {
    expect(
      berechneAnker(
        anlass({ titel: 'Blanko-Abstimmungstermin' }),
        HEUTE,
        BEKANNT,
        HEUTE_OBJ
      ).anker
    ).toBe('platzhalter')
    expect(
      berechneAnker(
        anlass({
          titel: 'Gemeindeversammlung findet nicht statt',
          abgesagt: true,
          termine: ['2026-10-15'],
          von: '2026-10-15'
        }),
        HEUTE,
        BEKANNT,
        HEUTE_OBJ
      )
    ).toMatchObject({ anker: 'ausfall', ankerAm: '2026-10-15' })
    expect(
      berechneAnker(
        anlass({
          titel: 'Waldführung',
          text: 'Die Führung wurde vom 19. auf den 26. September verschoben.'
        }),
        HEUTE,
        BEKANNT,
        HEUTE_OBJ
      ).anker
    ).toBe('verschoben')
  })

  it('Gremium wegen der Traktanden, wie selten es auch tagt', () => {
    const befund = berechneAnker(
      anlass({
        titel: 'Einwohnerratssitzung',
        termine: ['2026-09-21', '2026-11-02', '2026-12-14'],
        von: '2026-09-21'
      }),
      HEUTE,
      BEKANNT,
      HEUTE_OBJ
    )
    expect(befund).toMatchObject({ anker: 'gremium', ankerAm: '2026-09-21' })
  })

  it('die Anmeldefrist haengt den Anker VOR den Termin; eine vorbeie Frist ist ein Hinweis', () => {
    const offen = berechneAnker(
      anlass({
        titel: 'Bastelnachmittag',
        text: 'Anmeldung bis am 21.09.2026.',
        termine: ['2026-09-23'],
        von: '2026-09-23'
      }),
      HEUTE,
      BEKANNT,
      HEUTE_OBJ
    )
    expect(offen).toMatchObject({
      anker: 'frist',
      ankerAm: '2026-09-21',
      fristAm: '2026-09-21'
    })
    const vorbei = berechneAnker(
      anlass({
        titel: 'Runder Tisch',
        text: 'Anmeldungen bis 11. September 2026.',
        termine: ['2026-09-24'],
        von: '2026-09-24'
      }),
      HEUTE,
      BEKANNT,
      HEUTE_OBJ
    )
    expect(vorbei.anker).toBe('einmalig')
    expect(vorbei.hinweise[0]).toMatch(/Anmeldefrist 11\.9\.2026 ist vorbei/)
  })

  it('eine unbekannte Serie mit Beginn in der Zukunft ist neu — nicht auf dem Erstlauf', () => {
    const serie = anlass({
      titel: 'Krabbelgruppe',
      text: 'Jeden Dienstag von 9 bis 11 Uhr.',
      termine: ['2026-10-06', '2026-10-13'],
      von: '2026-10-06'
    })
    expect(berechneAnker(serie, HEUTE, UNBEKANNT, HEUTE_OBJ)).toMatchObject({
      anker: 'neu',
      ankerAm: '2026-10-06'
    })
    expect(
      berechneAnker(serie, HEUTE, { erstlauf: true, bekannt: false }, HEUTE_OBJ)
        .anker
    ).toBe('routine')
    expect(berechneAnker(serie, HEUTE, BEKANNT, HEUTE_OBJ).anker).toBe(
      'routine'
    )
  })

  it('einmalig ist einmalig, monatlich eine Erinnerung, woechentlich Routine', () => {
    expect(
      berechneAnker(
        anlass({ titel: 'Markt des Alterns' }),
        HEUTE,
        BEKANNT,
        HEUTE_OBJ
      )
    ).toMatchObject({
      anker: 'einmalig',
      ankerAm: '2026-09-25'
    })
    expect(
      berechneAnker(
        anlass({
          titel: 'Eltern-Kind-Café',
          text: 'Einmal im Monat besucht uns die Beraterin.',
          termine: ['2026-09-24'],
          von: '2026-09-24'
        }),
        HEUTE,
        BEKANNT,
        HEUTE_OBJ
      )
    ).toMatchObject({ anker: 'erinnerung', ankerAm: '2026-09-24' })
    expect(
      berechneAnker(
        anlass({
          titel: 'Freitags-Treff',
          text: 'Jeden Freitag von 9 bis 11 Uhr.'
        }),
        HEUTE,
        BEKANNT,
        HEUTE_OBJ
      )
    ).toMatchObject({ anker: 'routine', ankerAm: null })
  })

  it('eine Abweichung vom Monatsmuster ist ein Anker', () => {
    const befund = berechneAnker(
      anlass({
        titel: 'Tauschen statt Kaufen',
        text: 'Jeweils am letzten Mittwoch des Monats.',
        termine: ['2026-08-26', '2026-09-23', '2026-10-28'],
        von: '2026-08-26'
      }),
      HEUTE,
      BEKANNT,
      HEUTE_OBJ
    )
    expect(befund).toMatchObject({ anker: 'abweichung', ankerAm: '2026-09-23' })
  })

  it('laufend: beginnt, endet nur bei offenem Zugang und nicht bei «das ganze Jahr»', () => {
    const ausstellung = anlass({
      titel: 'Alder & Bahn',
      text: 'Eine Ausstellung, Mi/Fr/Sa/So 14–17 Uhr.',
      termine: ['2026-08-10', '2026-09-27'],
      von: '2026-08-10',
      bis: '2026-09-27',
      spanne: true
    })
    expect(berechneAnker(ausstellung, HEUTE, BEKANNT, HEUTE_OBJ)).toMatchObject(
      { anker: 'endet', ankerAm: '2026-09-27' }
    )
    expect(
      berechneAnker(
        {
          ...ausstellung,
          termine: ['2026-10-01', '2026-11-30'],
          von: '2026-10-01',
          bis: '2026-11-30'
        },
        HEUTE,
        BEKANNT,
        HEUTE_OBJ
      )
    ).toMatchObject({ anker: 'beginnt', ankerAm: '2026-10-01' })
    const camp = berechneAnker(
      {
        ...ausstellung,
        titel: 'Ferienpass',
        text: 'Ferienpass, Anmeldung bis 20. Juni.'
      },
      HEUTE,
      BEKANNT,
      HEUTE_OBJ
    )
    expect(camp.anker).toBe('routine')
    expect(camp.hinweise[0]).toMatch(/keine letzte Gelegenheit/)
    const jass = berechneAnker(
      {
        ...ausstellung,
        titel: 'Zusammen Jassen',
        text: 'Jassrunden das ganze Jahr über, jeden Freitagnachmittag.'
      },
      HEUTE,
      BEKANNT,
      HEUTE_OBJ
    )
    expect(jass.anker).toBe('routine')
  })
})

describe('Fenster und Dauerangebot', () => {
  it('das Vorschlagsfenster reicht zehn Tage vor den Anker', () => {
    expect(imVorschlagsfenster('2026-09-28', '2026-09-18')).toBe(true)
    expect(imVorschlagsfenster('2026-09-29', '2026-09-18')).toBe(false)
    expect(imVorschlagsfenster('2026-09-17', '2026-09-18')).toBe(false)
    expect(imVorschlagsfenster(null, '2026-09-18')).toBe(false)
  })

  it('waehlt eines je Woche, das am laengsten Wartende zuerst, und zaehlt den Rest', () => {
    const { vorgelegt, warten } = waehleDauerangebote(
      [
        {
          id: 'a',
          zuletzt_vorgelegt_am: '2026-05-01',
          dauerangebot: 'intervall'
        },
        { id: 'b', zuletzt_vorgelegt_am: null, dauerangebot: null },
        {
          id: 'c',
          zuletzt_vorgelegt_am: '2026-01-01',
          dauerangebot: 'intervall'
        },
        { id: 'd', zuletzt_vorgelegt_am: null, dauerangebot: 'nie' }
      ],
      '2026-09-18'
    )
    expect(vorgelegt).toEqual(['b'])
    expect(warten).toBe(1)
  })

  it('der erste Entscheid stellt die Uhr', () => {
    expect(
      dauerangebotNachEntscheid('uebernommen', null, '2026-09-18')
    ).toEqual({
      dauerangebot: 'intervall',
      zuletzt_gemeldet_am: '2026-09-18'
    })
    expect(
      dauerangebotNachEntscheid('abgelehnt', 'nicht_relevant', '2026-09-18')
    ).toEqual({ dauerangebot: 'nie' })
    expect(
      dauerangebotNachEntscheid('abgelehnt', 'veraltet', '2026-09-18')
    ).toEqual({})
  })
})
