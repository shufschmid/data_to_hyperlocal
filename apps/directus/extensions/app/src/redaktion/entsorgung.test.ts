import { describe, expect, it } from 'vitest'
import {
  buildExtraktionMessages,
  diffTermine,
  fasseZonenZusammen,
  letzterWochentagVor,
  merkblattGesamt,
  merkblattText,
  normalisiereFristzeit,
  normalisiereUhrzeit,
  parseExtraktion,
  beruehrtInhalt,
  ruecksetzungTermin,
  wochentagName,
  wochentagWarnung,
  type ExtrahierterTermin,
  type GespeicherterTermin
} from './entsorgung'

// Modelled on the Binningen 2026 calendar: two plateaus, monthly paper, a
// Häckseldienst with a registration deadline, bi-monthly Altmetall, and a
// weekly Hauskehricht that must never become a Termin.
const ANTWORT = {
  jahr: 2026,
  zonen: ['Westplateau', 'Ostplateau'],
  abfuhren: [
    {
      kategorie: 'Papier, Karton',
      zone: 'Westplateau',
      wochentag_laut_pdf: 'Mittwoch',
      daten: ['2026-01-07', '2026-02-04'],
      bereitstellung:
        'Fruehestens 18 Uhr am Vorabend, spaetestens 7 Uhr am Abfuhrtag.',
      anmeldung: null,
      anmeldung_wochentag: null,
      anmeldung_uhrzeit: null
    },
    {
      kategorie: 'Papier, Karton',
      zone: 'Ostplateau',
      wochentag_laut_pdf: 'Freitag',
      daten: ['2026-01-23'],
      bereitstellung:
        'Fruehestens 18 Uhr am Vorabend, spaetestens 7 Uhr am Abfuhrtag.',
      anmeldung: null,
      anmeldung_wochentag: null,
      anmeldung_uhrzeit: null
    },
    {
      kategorie: 'Haeckseldienst',
      zone: null,
      wochentag_laut_pdf: 'Mittwoch',
      daten: ['2026-03-04'],
      bereitstellung: 'Bereitstellen ab Dienstagabend am Strassenrand.',
      anmeldung: 'Anmeldung bei der Bauabteilung, Tel. 061 425 53 02.',
      anmeldung_wochentag: 'Montag',
      anmeldung_uhrzeit: '11:30'
    }
  ],
  regelmaessig: [
    {
      kategorie: 'Hauskehricht, Sperrgut',
      rhythmus: 'Jeden Mittwoch (West) bzw. Dienstag (Ost)'
    }
  ],
  hinweise: []
}

/** Replaces the abfuhren list, keeping the rest of a realistic answer. */
function mitAbfuhren(...abfuhren: unknown[]) {
  return { ...ANTWORT, abfuhren }
}

describe('parseExtraktion', () => {
  it('flacht die Kalenderzeilen zu einzelnen Terminen ab', () => {
    const extraktion = parseExtraktion(ANTWORT, 2026)

    // Drei Zeilen, aber vier Termine: die erste Zeile traegt zwei Daten.
    expect(extraktion.termine).toHaveLength(4)
    expect(extraktion.zonen).toEqual(['Westplateau', 'Ostplateau'])
    expect(extraktion.regelmaessig[0]?.kategorie).toBe('Hauskehricht, Sperrgut')
    expect(extraktion.hinweise).toEqual([])
  })

  it('gibt jedem Termin die Regeln seiner Zeile mit', () => {
    const extraktion = parseExtraktion(ANTWORT, 2026)
    const februar = extraktion.termine.find((t) => t.datum === '2026-02-04')

    expect(februar?.bereitstellung).toContain('spaetestens 7 Uhr')
    expect(februar?.zone).toBe('Westplateau')
  })

  it('sortiert die Termine chronologisch', () => {
    const extraktion = parseExtraktion(ANTWORT, 2026)
    expect(extraktion.termine.map((t) => t.datum)).toEqual([
      '2026-01-07',
      '2026-01-23',
      '2026-02-04',
      '2026-03-04'
    ])
  })

  it('rechnet die Anmeldefrist aus dem Wochentag aus', () => {
    // Der Kalender nennt eine Regel ("Montag vor dem Termin"), kein Datum.
    // Tour Mittwoch 4. Maerz -> Frist Montag 2. Maerz.
    const extraktion = parseExtraktion(ANTWORT, 2026)
    const haeckseln = extraktion.termine.find(
      (t) => t.kategorie === 'Haeckseldienst'
    )

    expect(haeckseln?.anmeldeschluss).toBe('2026-03-02')
  })

  it('verwirft ein unlesbares Datum und sagt es', () => {
    const extraktion = parseExtraktion(
      mitAbfuhren({ ...ANTWORT.abfuhren[0], daten: ['2026-02-31'] }),
      2026
    )

    expect(extraktion.termine).toHaveLength(0)
    expect(extraktion.hinweise[0]).toContain('unlesbares Datum')
  })

  it('verwirft ein Datum aus einem fremden Jahr', () => {
    const extraktion = parseExtraktion(
      mitAbfuhren({ ...ANTWORT.abfuhren[0], daten: ['2024-01-07'] }),
      2026
    )

    expect(extraktion.termine).toHaveLength(0)
    expect(extraktion.hinweise[0]).toContain('Kalenderjahr 2026')
  })

  it('laesst den Januar des Folgejahres zu — der Kalender druckt ihn mit', () => {
    const extraktion = parseExtraktion(
      mitAbfuhren({ ...ANTWORT.abfuhren[0], daten: ['2027-01-06'] }),
      2026
    )

    expect(extraktion.termine).toHaveLength(1)
  })

  it('meldet eine Zone, die der Kalender nie deklariert hat', () => {
    const extraktion = parseExtraktion(
      mitAbfuhren({ ...ANTWORT.abfuhren[0], zone: 'Suedplateau' }),
      2026
    )

    expect(extraktion.hinweise[0]).toContain('Suedplateau')
  })

  it('entfernt Doubletten derselben Kategorie, Zone und Datums', () => {
    const extraktion = parseExtraktion(
      mitAbfuhren({
        ...ANTWORT.abfuhren[0],
        daten: ['2026-01-07', '2026-01-07']
      }),
      2026
    )

    expect(extraktion.termine).toHaveLength(1)
  })

  it('meldet einen unbrauchbaren Anmeldetag statt zu raten', () => {
    const extraktion = parseExtraktion(
      mitAbfuhren({ ...ANTWORT.abfuhren[2], anmeldung_wochentag: 'jederzeit' }),
      2026
    )

    expect(extraktion.termine[0]?.anmeldeschluss).toBeNull()
    expect(extraktion.hinweise[0]).toContain('kein Wochentag')
  })

  it('reicht die Uhrzeit der Anmeldefrist mit', () => {
    // Sie entscheidet, in welcher Ausgabe die Erinnerung erscheint.
    const extraktion = parseExtraktion(ANTWORT, 2026)
    const haeckseln = extraktion.termine.find(
      (t) => t.kategorie === 'Haeckseldienst'
    )

    expect(haeckseln?.anmeldeschluss_zeit).toBe('11:30')
  })

  it('setzt keine Uhrzeit ohne Frist', () => {
    const extraktion = parseExtraktion(ANTWORT, 2026)
    const papier = extraktion.termine.find(
      (t) => t.kategorie === 'Papier, Karton'
    )

    expect(papier?.anmeldeschluss_zeit).toBeNull()
  })

  it('meldet eine unlesbare Uhrzeit und faellt auf den sicheren Weg zurueck', () => {
    const extraktion = parseExtraktion(
      mitAbfuhren({ ...ANTWORT.abfuhren[2], anmeldung_uhrzeit: 'rechtzeitig' }),
      2026
    )

    expect(extraktion.termine[0]?.anmeldeschluss_zeit).toBeNull()
    expect(extraktion.hinweise[0]).toContain('keine Uhrzeit')
  })

  it('rechnet eine Frist "N Tage vorher" auf den Stichtag um', () => {
    // Pratteln: "Anmeldung bis vier Tage vorher" — Tour Montag 9. Februar,
    // also Anmeldeschluss Donnerstag 5. Februar. Ohne dieses Feld erschiene
    // die Erinnerung erst am Vortag, drei Tage nach der Frist.
    const extraktion = parseExtraktion(
      mitAbfuhren({
        kategorie: 'Haeckseldienst',
        zone: null,
        wochentag_laut_pdf: 'Montag',
        daten: ['2026-02-09'],
        bereitstellung: null,
        anmeldung: 'Anmeldung bis vier Tage vorher, Tel. 061 599 90 09.',
        anmeldung_wochentag: null,
        anmeldung_uhrzeit: null,
        anmeldung_tage_vorher: 4
      }),
      2026
    )

    expect(extraktion.termine[0]?.anmeldeschluss).toBe('2026-02-05')
    expect(extraktion.hinweise).toHaveLength(0)
  })

  it('laesst eine Tageszeit als Fristzeit durch', () => {
    // "bis Montagvormittag" (Aesch): das Wort traegt die Ausgabe-Entscheidung
    // und darf nicht zu null werden — sonst rueckt die Erinnerung grundlos
    // einen Tag vor.
    const extraktion = parseExtraktion(
      mitAbfuhren({
        ...ANTWORT.abfuhren[2],
        anmeldung_uhrzeit: 'Montagvormittag'
      }),
      2026
    )

    expect(extraktion.termine[0]?.anmeldeschluss_zeit).toBe('Vormittag')
    expect(extraktion.hinweise).toHaveLength(0)
  })

  it('weist eine Antwort ohne Abfuhren-Feld zurueck', () => {
    expect(() => parseExtraktion({ jahr: 2026 }, 2026)).toThrow(/abfuhren/)
    expect(() => parseExtraktion('nein', 2026)).toThrow(/Objekt/)
  })
})

describe('parseExtraktion mit Dokument-Zone (Riehen-Fall)', () => {
  it('erzwingt die Zone des Dokuments auf allen Terminen', () => {
    // Riehen druckt je Zone ein eigenes PDF; die Zone steht auf dem Umschlag
    // und wurde von der Redaktorin erfasst. Was das Modell je Zeile behauptet,
    // ist dann keine Frage mehr.
    const extraktion = parseExtraktion(
      mitAbfuhren(
        { ...ANTWORT.abfuhren[0], zone: null },
        { ...ANTWORT.abfuhren[2], zone: 'irgendwas Erfundenes' }
      ),
      2026,
      'Zone 1'
    )

    expect(extraktion.termine.every((t) => t.zone === 'Zone 1')).toBe(true)
    expect(extraktion.zonen).toEqual(['Zone 1'])
  })

  it('fasst bei einem Zonen-Dokument nichts zur ganzen Gemeinde zusammen', () => {
    // Das Gegenstueck der Zone liegt in einem anderen PDF — dieses Dokument
    // sieht per Definition nur eine.
    const extraktion = parseExtraktion(ANTWORT, 2026, 'Zone 1')

    expect(extraktion.termine.every((t) => t.zone === 'Zone 1')).toBe(true)
  })
})

describe('merkblattGesamt', () => {
  const extraktion = parseExtraktion(ANTWORT, 2026)

  it('gibt bei einem einzelnen zonenlosen Dokument die schlichte Form', () => {
    const merkblatt = merkblattGesamt([{ zone: null, extraktion }])

    expect(merkblatt).not.toContain('— Ganze Gemeinde —')
    expect(merkblatt).toContain('Hauskehricht')
  })

  it('ueberschreibt bei mehreren Dokumenten jeden Abschnitt mit seiner Zone', () => {
    const merkblatt = merkblattGesamt([
      { zone: 'Zone 1', extraktion },
      { zone: 'Zone 2', extraktion }
    ])

    expect(merkblatt).toContain('— Zone 1 —')
    expect(merkblatt).toContain('— Zone 2 —')
  })
})

describe('fasseZonenZusammen', () => {
  const termin = (ueber: Partial<ExtrahierterTermin>): ExtrahierterTermin => ({
    kategorie: 'Haeckseldienst',
    zone: null,
    datum: '2026-03-04',
    wochentag_laut_pdf: 'Mittwoch',
    bereitstellung: 'Ab Dienstagabend.',
    anmeldung: 'Bauabteilung.',
    anmeldeschluss: '2026-03-02',
    anmeldeschluss_zeit: '11:30',
    ...ueber
  })

  const ZONEN = ['Westplateau', 'Ostplateau']

  it('macht aus zwei gleichen Zonenzeilen einen Termin fuer die ganze Gemeinde', () => {
    // Der Kalender druckt den Haeckseldienst in beiden Plateau-Tabellen, weil
    // die Seite so gebaut ist — nicht weil sich die beiden unterscheiden.
    const zusammen = fasseZonenZusammen(
      [termin({ zone: 'Westplateau' }), termin({ zone: 'Ostplateau' })],
      ZONEN
    )

    expect(zusammen).toHaveLength(1)
    expect(zusammen[0]?.zone).toBeNull()
  })

  it('laesst zwei Zonen stehen, wenn die Regeln sich unterscheiden', () => {
    // Gleicher Tag, andere Bereitstellung ist ein echter Unterschied.
    const zusammen = fasseZonenZusammen(
      [
        termin({ zone: 'Westplateau' }),
        termin({
          zone: 'Ostplateau',
          bereitstellung: 'Erst ab Mittwochmorgen.'
        })
      ],
      ZONEN
    )

    expect(zusammen).toHaveLength(2)
  })

  it('laesst eine einzelne Zone stehen — sie deckt nicht die Gemeinde ab', () => {
    const zusammen = fasseZonenZusammen(
      [termin({ zone: 'Westplateau' })],
      ZONEN
    )

    expect(zusammen).toHaveLength(1)
    expect(zusammen[0]?.zone).toBe('Westplateau')
  })

  it('fasst verschiedene Daten nicht zusammen', () => {
    // Papier faellt in den Zonen auf verschiedene Tage — das bleibt getrennt.
    const zusammen = fasseZonenZusammen(
      [
        termin({
          kategorie: 'Papier',
          zone: 'Westplateau',
          datum: '2026-01-07'
        }),
        termin({ kategorie: 'Papier', zone: 'Ostplateau', datum: '2026-01-23' })
      ],
      ZONEN
    )

    expect(zusammen).toHaveLength(2)
  })

  it('ruehrt eine Gemeinde ohne Zonen nicht an', () => {
    const zusammen = fasseZonenZusammen([termin({})], [])
    expect(zusammen).toHaveLength(1)
  })
})

describe('normalisiereUhrzeit', () => {
  it('nimmt die Schweizer Schreibweise mit Punkt', () => {
    // Der gedruckte Kalender schreibt "11.30 Uhr".
    expect(normalisiereUhrzeit('11.30 Uhr')).toBe('11:30')
    expect(normalisiereUhrzeit('11.30')).toBe('11:30')
  })

  it('nimmt auch die Doppelpunkt-Form', () => {
    expect(normalisiereUhrzeit('11:30')).toBe('11:30')
    expect(normalisiereUhrzeit('9:05')).toBe('09:05')
  })

  it('fuellt eine volle Stunde auf', () => {
    expect(normalisiereUhrzeit('7 Uhr')).toBe('07:00')
  })

  it('weist zurueck, was keine Uhrzeit ist', () => {
    expect(normalisiereUhrzeit('vormittags')).toBeNull()
    expect(normalisiereUhrzeit('25:00')).toBeNull()
    expect(normalisiereUhrzeit('11.75')).toBeNull()
  })
})

describe('normalisiereFristzeit', () => {
  it('laesst echte Uhrzeiten unveraendert durch', () => {
    expect(normalisiereFristzeit('11.30 Uhr')).toBe('11:30')
    expect(normalisiereFristzeit('7 Uhr')).toBe('07:00')
  })

  it('kanonisiert Tageszeiten — sie tragen die Ausgabe-Entscheidung', () => {
    // "bis Montagvormittag" (Aesch) heisst: bis Mittag. Das Wort geht als
    // Fristzeit durch, damit die Erinnerung noch in die Montagausgabe kommt.
    expect(normalisiereFristzeit('Vormittag')).toBe('Vormittag')
    expect(normalisiereFristzeit('vormittags')).toBe('Vormittag')
    expect(normalisiereFristzeit('Montagvormittag')).toBe('Vormittag')
    expect(normalisiereFristzeit('mittags')).toBe('Mittag')
    expect(normalisiereFristzeit('Nachmittag')).toBe('Nachmittag')
  })

  it('gibt fuer alles andere null zurueck — die sichere Seite', () => {
    expect(normalisiereFristzeit('morgens')).toBeNull()
    expect(normalisiereFristzeit('rechtzeitig')).toBeNull()
  })
})

describe('letzterWochentagVor', () => {
  it('nimmt den Montag vor einem Mittwochstermin', () => {
    expect(letzterWochentagVor('2026-03-04', 'Montag')).toBe('2026-03-02')
  })

  it('geht eine volle Woche zurueck, wenn der Termin selbst der Wochentag ist', () => {
    // Sonst waere die Frist der Termin selbst — also keine Frist.
    expect(letzterWochentagVor('2026-03-02', 'Montag')).toBe('2026-02-23')
  })

  it('rechnet ueber die Monatsgrenze', () => {
    expect(letzterWochentagVor('2026-03-04', 'Freitag')).toBe('2026-02-27')
  })

  it('versteht Abkuerzungen und "ae"', () => {
    expect(letzterWochentagVor('2026-03-04', 'Mo')).toBe('2026-03-02')
    expect(letzterWochentagVor('2026-03-05', 'Montag')).toBe('2026-03-02')
  })

  it('gibt null zurueck, wenn das kein Wochentag ist', () => {
    expect(letzterWochentagVor('2026-03-04', 'jederzeit')).toBeNull()
  })
})

describe('wochentagWarnung', () => {
  const termin = (ueber: Partial<ExtrahierterTermin>): ExtrahierterTermin => ({
    kategorie: 'Papier, Karton',
    zone: null,
    datum: '2026-01-07',
    wochentag_laut_pdf: 'Mittwoch',
    bereitstellung: null,
    anmeldung: null,
    anmeldeschluss: null,
    anmeldeschluss_zeit: null,
    ...ueber
  })

  it('schweigt, wenn Wochentag und Datum uebereinstimmen', () => {
    // Der 7. Januar 2026 ist tatsaechlich ein Mittwoch.
    expect(wochentagWarnung(termin({}))).toBeNull()
  })

  it('schlaegt an, wenn das Modell eine Spalte verrutscht ist', () => {
    const warnung = wochentagWarnung(termin({ datum: '2026-01-08' }))
    expect(warnung).toContain('Mittwoch')
    expect(warnung).toContain('Donnerstag')
  })

  it('nimmt Abkuerzungen und Sternchen hin', () => {
    expect(wochentagWarnung(termin({ wochentag_laut_pdf: 'Mi' }))).toBeNull()
    expect(
      wochentagWarnung(termin({ wochentag_laut_pdf: '*Mittwoch' }))
    ).toBeNull()
  })

  it('schweigt, wenn der Kalender keinen Wochentag nennt', () => {
    expect(wochentagWarnung(termin({ wochentag_laut_pdf: null }))).toBeNull()
  })
})

describe('wochentagName', () => {
  it('nennt den Wochentag auf Deutsch', () => {
    expect(wochentagName('2026-06-12')).toBe('Freitag')
    expect(wochentagName('2026-05-09')).toBe('Samstag')
  })
})

describe('diffTermine', () => {
  const gespeichert = (
    ueber: Partial<GespeicherterTermin>
  ): GespeicherterTermin => ({
    id: 'id-1',
    kategorie: 'Papier, Karton',
    zone: 'Westplateau',
    datum: '2026-01-07',
    bereitstellung: 'Bis 7 Uhr.',
    anmeldung: null,
    anmeldeschluss: null,
    anmeldeschluss_zeit: null,
    geprueft: true,
    meldung: 'meldung-1',
    ...ueber
  })

  const extrahiert = (
    ueber: Partial<ExtrahierterTermin>
  ): ExtrahierterTermin => ({
    kategorie: 'Papier, Karton',
    zone: 'Westplateau',
    datum: '2026-01-07',
    wochentag_laut_pdf: 'Mittwoch',
    bereitstellung: 'Bis 7 Uhr.',
    anmeldung: null,
    anmeldeschluss: null,
    anmeldeschluss_zeit: null,
    ...ueber
  })

  it('laesst einen unveraenderten Termin in Ruhe — Bestaetigung und Meldung bleiben', () => {
    const diff = diffTermine([gespeichert({})], [extrahiert({})])

    expect(diff.anlegen).toHaveLength(0)
    expect(diff.aktualisieren).toHaveLength(0)
    expect(diff.loeschen).toHaveLength(0)
    expect(diff.invalidiereMeldungen).toHaveLength(0)
  })

  it('legt einen neuen Termin an', () => {
    const diff = diffTermine([], [extrahiert({})])
    expect(diff.anlegen).toHaveLength(1)
  })

  it('aktualisiert geaenderte Anweisungen und verwirft die Meldung dazu', () => {
    const diff = diffTermine(
      [gespeichert({})],
      [extrahiert({ bereitstellung: 'Neu: bis 6.30 Uhr.' })]
    )

    expect(diff.aktualisieren).toHaveLength(1)
    expect(diff.invalidiereMeldungen).toEqual(['meldung-1'])
  })

  it('behandelt ein verschobenes Datum als Loeschung plus Neuanlage', () => {
    const diff = diffTermine(
      [gespeichert({})],
      [extrahiert({ datum: '2026-01-14' })]
    )

    expect(diff.anlegen).toHaveLength(1)
    expect(diff.loeschen).toHaveLength(1)
    expect(diff.invalidiereMeldungen).toEqual(['meldung-1'])
  })

  it('nennt jede betroffene Meldung nur einmal', () => {
    const diff = diffTermine(
      [
        gespeichert({ id: 'a', datum: '2026-01-07' }),
        gespeichert({ id: 'b', datum: '2026-01-08' })
      ],
      []
    )

    expect(diff.loeschen).toHaveLength(2)
    expect(diff.invalidiereMeldungen).toEqual(['meldung-1'])
  })

  it('unterscheidet Zonen — gleicher Tag, andere Zone ist ein anderer Termin', () => {
    const diff = diffTermine(
      [gespeichert({ zone: 'Westplateau' })],
      [extrahiert({ zone: 'Ostplateau' })]
    )

    expect(diff.anlegen).toHaveLength(1)
    expect(diff.loeschen).toHaveLength(1)
  })
})

describe('ruecksetzungTermin', () => {
  it('nimmt die Bestaetigung zurueck, wenn das Datum korrigiert wird', () => {
    expect(ruecksetzungTermin({ datum: '2026-01-14' })).toEqual({
      geprueft: false
    })
  })

  it('nimmt sie auch bei geaenderten Anweisungen zurueck', () => {
    expect(ruecksetzungTermin({ bereitstellung: 'neu' })).toEqual({
      geprueft: false
    })
    expect(ruecksetzungTermin({ anmeldeschluss: '2026-03-02' })).toEqual({
      geprueft: false
    })
  })

  it('laesst das Bestaetigen selbst durch', () => {
    // Sonst haette die Bestaetigung sich selbst aufgehoben.
    expect(ruecksetzungTermin({ geprueft: true })).toBeNull()
  })

  it('ignoriert Schreibvorgaenge, die den Inhalt nicht beruehren', () => {
    expect(ruecksetzungTermin({ meldung: 'meldung-1' })).toBeNull()
    expect(ruecksetzungTermin({ warnung: null })).toBeNull()
  })
})

describe('beruehrtInhalt', () => {
  it('erkennt eine Inhaltsaenderung auch nach dem Filter-Durchlauf', () => {
    // Der Filter-Hook mischt geprueft:false in dieselbe Payload, BEVOR der
    // Action-Hook sie sieht. Eine Pruefung ueber ruecksetzungTermin wuerde das
    // fuer einen Bestaetigungs-Schreibvorgang halten und nie invalidieren —
    // genau so blieb in Aesch eine ueberholte Erinnerung stehen.
    const editorPayload = { anmeldeschluss_zeit: 'Vormittag' }
    const nachFilter = {
      ...editorPayload,
      ...ruecksetzungTermin(editorPayload)
    }

    expect(ruecksetzungTermin(nachFilter)).toBeNull()
    expect(beruehrtInhalt(nachFilter)).toBe(true)
  })

  it('laesst Buchhaltung in Ruhe', () => {
    expect(beruehrtInhalt({ geprueft: true })).toBe(false)
    expect(beruehrtInhalt({ meldung: null })).toBe(false)
  })
})

describe('merkblattText', () => {
  it('haelt fest, was keine Erinnerung ausloest', () => {
    const merkblatt = merkblattText(parseExtraktion(ANTWORT, 2026))

    expect(merkblatt).toContain('erzeugen keine Erinnerungen')
    expect(merkblatt).toContain('Hauskehricht')
    expect(merkblatt).toContain('Westplateau, Ostplateau')
  })
})

describe('buildExtraktionMessages', () => {
  it('stellt das PDF vor die Frage', () => {
    const [nachricht] = buildExtraktionMessages('JVBERi0=', 'Binningen', 2026)
    const inhalt = nachricht?.content as unknown as Array<
      Record<string, unknown>
    >

    expect(inhalt[0]?.type).toBe('document')
    expect(inhalt[1]?.type).toBe('text')
    expect(String(inhalt[1]?.text)).toContain('Binningen')
    expect(String(inhalt[1]?.text)).toContain('2026')
  })
})
