import { describe, expect, it } from 'vitest'
import {
  baueFakten,
  buildErinnerungPrompt,
  buildErinnerungRevision,
  datengrundlageErinnerung,
  datumMitWochentag,
  fristText,
  naechsterZonentermin,
  parseErinnerung,
  planeErinnerungen,
  zahlWarnungenErinnerung,
  zeitPruefungErinnerung,
  type ErinnerungsFakten,
  type PlanTermin
} from './erinnerung'

function termin(ueber: Partial<PlanTermin>): PlanTermin {
  return {
    id: 'id-1',
    kategorie: 'Papier, Karton',
    zone: null,
    datum: '2026-06-10',
    bereitstellung:
      'Fruehestens 18 Uhr am Vorabend, spaetestens 7 Uhr am Abfuhrtag.',
    anmeldung: null,
    anmeldeschluss: null,
    ...ueber
  }
}

const HEUTE = '2026-01-05'

describe('datumMitWochentag', () => {
  it('schreibt Wochentag und volles Datum aus', () => {
    expect(datumMitWochentag('2026-06-12')).toBe('Freitag, 12. Juni 2026')
  })

  it('verschiebt das Datum nicht ueber die Zeitzone', () => {
    // Mit lokaler Interpretation waere hier der 6. Januar herausgekommen.
    expect(datumMitWochentag('2026-01-07')).toBe('Mittwoch, 7. Januar 2026')
  })
})

describe('fristText', () => {
  it('haengt eine Uhrzeit mit Punkt an', () => {
    expect(fristText('2026-03-02', '11:30')).toBe(
      'Montag, 2. Maerz 2026, 11.30 Uhr'
    )
  })

  it('verschmilzt eine Tageszeit mit dem Wochentag statt eine Uhrzeit zu erfinden', () => {
    // Der Kalender sagt "Montagvormittag" — "12.00 Uhr" waere eine Praezision,
    // die er nicht traegt.
    expect(fristText('2026-09-07', 'Vormittag')).toBe(
      'Montagvormittag, 7. September 2026'
    )
  })

  it('laesst das blosse Datum stehen, wenn es keine Zeit gibt', () => {
    expect(fristText('2026-03-02', null)).toBe('Montag, 2. Maerz 2026')
  })
})

describe('planeErinnerungen', () => {
  it('terminiert auf den Newsletter-Tag vor dem Termin', () => {
    const plan = planeErinnerungen([termin({ datum: '2026-06-10' })], HEUTE)

    expect(plan.gruppen).toHaveLength(1)
    expect(plan.gruppen[0]?.erscheintAm).toBe('2026-06-09')
  })

  it('haengt sich an die Anmeldefrist, nicht an den Abfuhrtag', () => {
    // Haeckseldienst: Tour Mittwoch, Anmeldung bis Montag 11.30 Uhr. Der
    // Newsletter ist um 10 Uhr gelesen, also faellt die Erinnerung in die
    // Montagausgabe — dann kann die Leserin noch anmelden.
    const plan = planeErinnerungen(
      [
        termin({
          kategorie: 'Haeckseldienst',
          datum: '2026-03-04',
          anmeldeschluss: '2026-03-02',
          anmeldeschluss_zeit: '11:30'
        })
      ],
      HEUTE
    )

    expect(plan.gruppen[0]?.erscheintAm).toBe('2026-03-02')
  })

  it('rueckt vor, wenn die Frist am Morgen ablaeuft', () => {
    const plan = planeErinnerungen(
      [
        termin({
          kategorie: 'Haeckseldienst',
          datum: '2026-03-04',
          anmeldeschluss: '2026-03-02',
          anmeldeschluss_zeit: '08:00'
        })
      ],
      HEUTE
    )

    expect(plan.gruppen[0]?.erscheintAm).toBe('2026-02-27')
  })

  it('liest "Vormittag" als Frist nach der Lesezeit', () => {
    // Aesch: "Anmeldung bis spaetestens am Montagvormittag vor dem
    // Haeckseldienst" — keine Uhrzeit, aber der Vormittag endet um zwoelf.
    // Die Erinnerung gehoert in die Montagausgabe, nicht auf den Freitag.
    const plan = planeErinnerungen(
      [
        termin({
          kategorie: 'Haeckseldienst',
          datum: '2026-09-08',
          anmeldeschluss: '2026-09-07',
          anmeldeschluss_zeit: 'Vormittag'
        })
      ],
      HEUTE
    )

    expect(plan.gruppen[0]?.erscheintAm).toBe('2026-09-07')
  })

  it('laesst den Abfuhrtag selbst nie zu', () => {
    // Auch mit spaeter Uhrzeit am Abfuhrtag: das Papier muss um 7 Uhr draussen
    // sein, lange bevor jemand den Newsletter oeffnet.
    const plan = planeErinnerungen(
      [termin({ datum: '2026-06-10', anmeldeschluss_zeit: '18:00' })],
      HEUTE
    )

    expect(plan.gruppen[0]?.erscheintAm).toBe('2026-06-09')
  })

  it('fasst zwei Termine desselben Erscheinungstags zusammen', () => {
    // Altmetall Mittwoch und Karton Donnerstag werden beide am Dienstag
    // angekuendigt — das ergibt eine Meldung, nicht zwei.
    const plan = planeErinnerungen(
      [
        termin({ id: 'a', kategorie: 'Altmetall', datum: '2026-06-10' }),
        termin({ id: 'b', kategorie: 'Papier, Karton', datum: '2026-06-11' })
      ],
      HEUTE
    )

    expect(plan.gruppen).toHaveLength(2)

    const zusammen = planeErinnerungen(
      [
        termin({ id: 'a', kategorie: 'Altmetall', datum: '2026-06-10' }),
        termin({ id: 'b', kategorie: 'Sonderabfaelle', datum: '2026-06-10' })
      ],
      HEUTE
    )

    expect(zusammen.gruppen).toHaveLength(1)
    expect(zusammen.gruppen[0]?.termine).toHaveLength(2)
  })

  it('fasst auch ueber die Frist zusammen: Haeckselanmeldung trifft Papierabfuhr', () => {
    // Anmeldeschluss Montag 2. Maerz -> Freitag 27. Februar.
    // Papierabfuhr Montag 2. Maerz -> ebenfalls Freitag 27. Februar.
    const plan = planeErinnerungen(
      [
        termin({
          id: 'a',
          kategorie: 'Haeckseldienst',
          datum: '2026-03-04',
          anmeldeschluss: '2026-03-02'
        }),
        termin({ id: 'b', kategorie: 'Papier, Karton', datum: '2026-03-02' })
      ],
      HEUTE
    )

    expect(plan.gruppen).toHaveLength(1)
    expect(plan.gruppen[0]?.erscheintAm).toBe('2026-02-27')
    // Innerhalb der Meldung stehen die Termine nach Abfuhrdatum — so verlangt es
    // auch der Prompt. Dass der Haeckseldienst eine Frist hat, hebt ihn im Text
    // in den Lead, nicht in der Reihenfolge der Fakten.
    expect(plan.gruppen[0]?.termine.map((t) => t.kategorie)).toEqual([
      'Papier, Karton',
      'Haeckseldienst'
    ])
  })

  it('zaehlt Termine, deren Erscheinungstag vorbei ist, statt sie zu verschweigen', () => {
    // Kalender erst im Maerz hochgeladen: der Januar ist verloren, aber sichtbar.
    const plan = planeErinnerungen(
      [
        termin({ id: 'alt', datum: '2026-01-07' }),
        termin({ id: 'neu', datum: '2026-06-10' })
      ],
      '2026-03-15'
    )

    expect(plan.verpasst.map((t) => t.id)).toEqual(['alt'])
    expect(plan.gruppen).toHaveLength(1)
  })

  it('zaehlt auch den heutigen Erscheinungstag zu den verpassten', () => {
    // Die Ausgabe von heute ist beim naechtlichen Lauf schon gesetzt.
    const plan = planeErinnerungen(
      [termin({ datum: '2026-06-10' })],
      '2026-06-09'
    )
    expect(plan.verpasst).toHaveLength(1)
  })

  it('gibt die Gruppen chronologisch zurueck', () => {
    const plan = planeErinnerungen(
      [
        termin({ id: 'b', datum: '2026-08-12' }),
        termin({ id: 'a', datum: '2026-06-10' })
      ],
      HEUTE
    )

    expect(plan.gruppen.map((g) => g.erscheintAm)).toEqual([
      '2026-06-09',
      '2026-08-11'
    ])
  })
})

describe('naechsterZonentermin', () => {
  const west = termin({ id: 'w', zone: 'Westplateau', datum: '2026-06-10' })
  const ostFrueh = termin({ id: 'o1', zone: 'Ostplateau', datum: '2026-05-29' })
  const ostSpaet = termin({ id: 'o2', zone: 'Ostplateau', datum: '2026-06-26' })

  it('findet den naechsten Termin der anderen Zone', () => {
    const gefunden = naechsterZonentermin([west, ostFrueh, ostSpaet], west)
    expect(gefunden?.id).toBe('o2')
  })

  it('schweigt, wenn die Gemeinde keine Zonen kennt', () => {
    expect(naechsterZonentermin([termin({})], termin({}))).toBeNull()
  })

  it('nimmt keinen Termin einer anderen Kategorie', () => {
    const anderes = termin({
      id: 'x',
      zone: 'Ostplateau',
      kategorie: 'Altmetall'
    })
    expect(naechsterZonentermin([west, anderes], west)).toBeNull()
  })
})

describe('baueFakten', () => {
  const west = termin({ id: 'w', zone: 'Westplateau', datum: '2026-06-10' })
  const ost = termin({ id: 'o', zone: 'Ostplateau', datum: '2026-06-26' })

  it('reicht Datum, Bereitstellung und den Termin der anderen Zone fertig an', () => {
    const plan = planeErinnerungen([west, ost], HEUTE)
    const gruppe = plan.gruppen[0]
    if (gruppe === undefined) throw new Error('keine Gruppe')

    const fakten = baueFakten(gruppe, [west, ost], 'Binningen', 2026)

    expect(fakten.termine[0]?.datumText).toBe('Mittwoch, 10. Juni 2026')
    expect(fakten.termine[0]?.andereZone).toEqual({
      zone: 'Ostplateau',
      datumText: 'Freitag, 26. Juni 2026',
      datumIso: '2026-06-26'
    })
  })
})

describe('buildErinnerungPrompt', () => {
  const fakten = (): ErinnerungsFakten => ({
    gemeinde: 'Binningen',
    jahr: 2026,
    quellen: ['https://www.binningen.ch/abfall'],
    erscheintAm: '2026-03-03',
    termine: [
      {
        kategorie: 'Haeckseldienst',
        zone: null,
        datumText: 'Mittwoch, 4. Maerz 2026',
        datumIso: '2026-03-04',
        bereitstellung: 'Bereitstellen ab Dienstagabend am Strassenrand.',
        anmeldung: 'Anmeldung bei der Bauabteilung, Tel. 061 425 53 02.',
        anmeldeschlussText: 'Montag, 2. Maerz 2026',
        anmeldeschlussIso: '2026-03-02',
        zusatz: null,
        andereZone: null
      }
    ]
  })

  it('nennt Datum, Frist, Anmeldung und Link', () => {
    const prompt = buildErinnerungPrompt(fakten())

    expect(prompt).toContain('Mittwoch, 4. Maerz 2026')
    expect(prompt).toContain('Anmeldeschluss: Montag, 2. Maerz 2026')
    expect(prompt).toContain('061 425 53 02')
    expect(prompt).toContain('https://www.binningen.ch/abfall')
  })

  it('reicht den Zonen-Zusatz als Faktum mit — der Riehen-Fall', () => {
    // "Umfasst auch Bettingen" ist von der Redaktorin erfasst; das Modell darf
    // es nennen, aber nie selbst herleiten.
    const mitZusatz = fakten()
    const erster = mitZusatz.termine[0]
    if (erster !== undefined) {
      erster.zusatz = 'Umfasst auch die Gemeinde Bettingen (BS).'
    }

    const prompt = buildErinnerungPrompt(mitZusatz)

    expect(prompt).toContain(
      'Hinweis zur Zone: Umfasst auch die Gemeinde Bettingen (BS).'
    )
  })

  it('nennt jede Quelle nur einmal', () => {
    // Zwei Termine aus demselben Zonen-PDF sollen den Link nicht doppeln.
    const mitQuellen = fakten()
    mitQuellen.quellen = [
      'https://riehen.ch/zone1.pdf',
      'https://riehen.ch/zone2.pdf'
    ]

    const prompt = buildErinnerungPrompt(mitQuellen)

    expect(prompt).toContain(
      'https://riehen.ch/zone1.pdf und https://riehen.ch/zone2.pdf'
    )
  })

  it('wiederholt in der Revision dieselben Fakten', () => {
    // Sonst schriebe das Modell aus seiner eigenen Prosa weiter.
    const revision = buildErinnerungRevision(
      fakten(),
      { titel: 'Alt', lead: 'Alt', text: 'Alt' },
      'Kuerzer bitte.'
    )

    expect(revision).toContain('Mittwoch, 4. Maerz 2026')
    expect(revision).toContain('Kuerzer bitte.')
  })
})

describe('zeitPruefungErinnerung', () => {
  it('laesst die geforderte absolute Form durch', () => {
    const befund = zeitPruefungErinnerung(
      'Am Freitag (12. Juni 2026) ist Papierabfuhr im Westplateau.',
      2026
    )

    expect(befund.bestanden).toBe(true)
  })

  it('faengt "morgen" ab — das setzt erst der Newsletter ein', () => {
    const befund = zeitPruefungErinnerung(
      'Morgen ist Papierabfuhr, 12. Juni 2026.',
      2026
    )

    expect(befund.bestanden).toBe(false)
    expect(befund.hart).toContain('morgen')
  })

  it('verlangt die Jahreszahl im Text', () => {
    const befund = zeitPruefungErinnerung('Am Freitag ist Papierabfuhr.', 2026)

    expect(befund.jahrFehlt).toBe(true)
    expect(befund.bestanden).toBe(false)
  })
})

describe('zahlWarnungenErinnerung', () => {
  const fakten: ErinnerungsFakten = {
    gemeinde: 'Binningen',
    jahr: 2026,
    quellen: [],
    erscheintAm: '2026-06-09',
    termine: [
      {
        kategorie: 'Papier, Karton',
        zone: 'Westplateau',
        datumText: 'Mittwoch, 10. Juni 2026',
        datumIso: '2026-06-10',
        bereitstellung:
          'Fruehestens 18 Uhr am Vorabend, spaetestens 7 Uhr am Abfuhrtag.',
        anmeldung: null,
        anmeldeschlussText: null,
        anmeldeschlussIso: null,
        zusatz: null,
        andereZone: {
          zone: 'Ostplateau',
          datumText: 'Freitag, 26. Juni 2026',
          datumIso: '2026-06-26'
        }
      }
    ]
  }

  it('laesst Datum und Uhrzeiten aus den Angaben durch', () => {
    const warnungen = zahlWarnungenErinnerung(
      'Am Mittwoch (10. Juni 2026) ist Papierabfuhr. Bereitstellen ab 18 Uhr, spaetestens 7 Uhr. Im Ostplateau folgt der 26. Juni 2026.',
      fakten
    )

    expect(warnungen).toEqual([])
  })

  it('laesst ein uebergebenes Datum auch in Zahlenform durch', () => {
    // Die Fakten schreiben "10. Juni 2026", der Text "10.06.2026" — dieselbe
    // Aussage. Die "06" hier zu flaggen, wuerde die Redaktion lehren, die
    // Pruefung zu ignorieren.
    const warnungen = zahlWarnungenErinnerung(
      'Am Mittwoch (10.06.2026) ist Papierabfuhr im Westplateau.',
      fakten
    )

    expect(warnungen).toEqual([])
  })

  it('schlaegt bei einer erfundenen Zahl an', () => {
    // Eine Containergroesse, die im Kalender nirgends steht.
    const warnungen = zahlWarnungenErinnerung(
      'Am Mittwoch (10. Juni 2026) ist Papierabfuhr. Bis 140 Liter sind erlaubt.',
      fakten
    )

    expect(warnungen).toHaveLength(1)
    expect(warnungen[0]).toContain('140')
  })
})

describe('parseErinnerung', () => {
  it('nimmt eine vollstaendige Antwort an', () => {
    const erinnerung = parseErinnerung({ titel: 'T', lead: 'L', text: 'X' })
    expect(erinnerung.titel).toBe('T')
  })

  it('weist ein leeres Feld zurueck', () => {
    expect(() =>
      parseErinnerung({ titel: 'T', lead: '  ', text: 'X' })
    ).toThrow(/lead/)
  })
})

describe('datengrundlageErinnerung', () => {
  it('haelt fest, woraus die Erinnerung entstand', () => {
    const grundlage = datengrundlageErinnerung({
      gemeinde: 'Binningen',
      jahr: 2026,
      quellen: [],
      erscheintAm: '2026-06-09',
      termine: []
    })

    expect(grundlage.quelle).toBe('abfuhrkalender')
    expect(grundlage.erscheint_am).toBe('2026-06-09')
  })
})
