import { describe, expect, it } from 'vitest'
import {
  erscheinungstag,
  heuteIso,
  istBsFeiertag,
  istNewsletterTag,
  morgenIso,
  osterdatum,
  verschiebe,
  wochentag
} from './feiertage'

describe('osterdatum', () => {
  // Pinned against published dates rather than against the algorithm itself —
  // a transcription error in the computus would otherwise test as correct.
  it.each([
    [2024, '2024-03-31'],
    [2025, '2025-04-20'],
    [2026, '2026-04-05'],
    [2027, '2027-03-28'],
    [2028, '2028-04-16']
  ])('Ostern %i faellt auf %s', (jahr, erwartet) => {
    expect(osterdatum(jahr)).toBe(erwartet)
  })
})

describe('istBsFeiertag', () => {
  it('kennt die festen Feiertage', () => {
    expect(istBsFeiertag('2026-01-01')).toBe(true)
    expect(istBsFeiertag('2026-05-01')).toBe(true)
    expect(istBsFeiertag('2026-08-01')).toBe(true)
    expect(istBsFeiertag('2026-12-25')).toBe(true)
    expect(istBsFeiertag('2026-12-26')).toBe(true)
  })

  it('rechnet die beweglichen aus Ostern aus', () => {
    // Ostern 2026: 5. April.
    expect(istBsFeiertag('2026-04-03')).toBe(true) // Karfreitag
    expect(istBsFeiertag('2026-04-06')).toBe(true) // Ostermontag
    expect(istBsFeiertag('2026-05-14')).toBe(true) // Auffahrt
    expect(istBsFeiertag('2026-05-25')).toBe(true) // Pfingstmontag
  })

  it('haelt gewoehnliche Tage frei', () => {
    expect(istBsFeiertag('2026-06-12')).toBe(false)
    expect(istBsFeiertag('2026-04-07')).toBe(false)
  })
})

describe('istNewsletterTag', () => {
  it('schliesst Wochenenden aus', () => {
    expect(istNewsletterTag('2026-06-13')).toBe(false) // Samstag
    expect(istNewsletterTag('2026-06-14')).toBe(false) // Sonntag
    expect(istNewsletterTag('2026-06-12')).toBe(true) // Freitag
  })

  it('schliesst Feiertage aus, auch wenn sie auf einen Werktag fallen', () => {
    expect(wochentag('2026-05-01')).toBe(5) // Freitag
    expect(istNewsletterTag('2026-05-01')).toBe(false)
  })
})

describe('erscheinungstag', () => {
  it('nimmt den Vortag, wenn dieser ein Newsletter-Tag ist', () => {
    // Papierabfuhr Mittwoch 10. Juni 2026 -> Dienstag.
    expect(erscheinungstag('2026-06-10')).toBe('2026-06-09')
  })

  it('springt fuer einen Montagstermin auf den Freitag zurueck', () => {
    // Gruenabfuhr Montag 15. Juni 2026 -> Freitag 12. Juni.
    expect(erscheinungstag('2026-06-15')).toBe('2026-06-12')
  })

  it('springt fuer einen Samstagstermin auf den Freitag', () => {
    // Sonderabfaelle Samstag 9. Mai 2026 -> Freitag 8. Mai.
    expect(erscheinungstag('2026-05-09')).toBe('2026-05-08')
  })

  it('ueberspringt einen Feiertag am Vortag', () => {
    // Termin Montag 4. Mai 2026: der Freitag davor ist der 1. Mai -> Donnerstag.
    expect(erscheinungstag('2026-05-04')).toBe('2026-04-30')
  })

  it('ueberbrueckt die vier geschlossenen Ostertage', () => {
    // Termin Dienstag 7. April 2026. Ostermontag 6., Ostern 5., Samstag 4.,
    // Karfreitag 3. April -> Donnerstag 2. April.
    expect(erscheinungstag('2026-04-07')).toBe('2026-04-02')
  })

  it('geht ueber den Jahreswechsel zurueck', () => {
    // Termin Freitag 2. Januar 2026: Neujahr ist Donnerstag -> Mittwoch 31.12.
    expect(erscheinungstag('2026-01-02')).toBe('2025-12-31')
  })

  it('terminiert einen Haeckseldienst nach der Anmeldefrist, nicht nach der Tour', () => {
    // Binningen: Tour am Mittwoch 4. Maerz 2026, Anmeldeschluss Montag 2. Maerz.
    // Der Anker ist die Frist, nicht die Tour.
    expect(erscheinungstag('2026-03-04')).toBe('2026-03-03')
  })
})

describe('erscheinungstag mit Uhrzeit', () => {
  it('bleibt am Fristtag selbst, wenn die Frist nach der Lesezeit liegt', () => {
    // Anmeldeschluss Montag 11.30 Uhr: der Newsletter ist um 10 Uhr gelesen,
    // also kann die Leserin am Montagmorgen noch anmelden.
    expect(erscheinungstag('2026-03-02', '11:30')).toBe('2026-03-02')
  })

  it('geht einen Tag zurueck, wenn die Frist vor der Lesezeit liegt', () => {
    // Frist um 8 Uhr — da hat noch niemand den Newsletter gelesen.
    expect(erscheinungstag('2026-03-02', '08:00')).toBe('2026-02-27')
  })

  it('behandelt genau 10 Uhr als zu knapp', () => {
    // Gleichstand mit der Lesezeit ist ein Muenzwurf; eine Erinnerung einen Tag
    // zu frueh ist schwaecher, eine einen Tag zu spaet ist wertlos.
    expect(erscheinungstag('2026-03-02', '10:00')).toBe('2026-02-27')
  })

  it('geht ohne Uhrzeit auf Nummer sicher', () => {
    expect(erscheinungstag('2026-03-02', null)).toBe('2026-02-27')
  })

  it('weicht aus, wenn der Fristtag selbst kein Newsletter-Tag ist', () => {
    // Frist am 1. Mai (Feiertag, Freitag), 11.30 Uhr: es gibt keine Ausgabe,
    // in der die Erinnerung noch rechtzeitig kaeme.
    expect(erscheinungstag('2026-05-01', '11:30')).toBe('2026-04-30')
  })

  it('weicht auch am Wochenende aus', () => {
    // Frist Samstag 12 Uhr -> Freitag.
    expect(erscheinungstag('2026-06-13', '12:00')).toBe('2026-06-12')
  })

  it('liest eine Tageszeit als Frist nach der Lesezeit', () => {
    // "Anmeldung bis Montagvormittag" (Aesch): der Vormittag endet um zwoelf,
    // der Newsletter ist um zehn gelesen — die Montagausgabe reicht noch.
    expect(erscheinungstag('2026-09-07', 'Vormittag')).toBe('2026-09-07')
    expect(erscheinungstag('2026-09-07', 'Mittag')).toBe('2026-09-07')
    expect(erscheinungstag('2026-09-07', 'Abend')).toBe('2026-09-07')
  })

  it('behandelt ein unbekanntes Zeitwort als frueh', () => {
    // "morgens" endet um die Lesezeit herum — Vortag, die sichere Seite.
    expect(erscheinungstag('2026-09-07', 'morgens')).toBe('2026-09-04')
  })
})

describe('verschiebe', () => {
  it('rechnet ueber Monats- und Jahresgrenzen', () => {
    expect(verschiebe('2026-01-31', 1)).toBe('2026-02-01')
    expect(verschiebe('2026-01-01', -1)).toBe('2025-12-31')
    expect(verschiebe('2028-02-28', 1)).toBe('2028-02-29') // Schaltjahr
  })

  it('bleibt ueber die Sommerzeitumstellung hinweg stabil', () => {
    // Die Umstellung 2026 faellt auf den 29. Maerz; mit lokaler Zeitrechnung
    // waere hier ein Tag verlorengegangen.
    expect(verschiebe('2026-03-28', 1)).toBe('2026-03-29')
    expect(verschiebe('2026-03-29', 1)).toBe('2026-03-30')
  })
})

describe('heuteIso / morgenIso', () => {
  it('liest den Schweizer Kalendertag, nicht den UTC-Tag', () => {
    // 22:30 UTC ist in Zuerich bereits der Folgetag (Sommerzeit).
    const spaetabends = new Date('2026-06-11T22:30:00Z')
    expect(heuteIso(spaetabends)).toBe('2026-06-12')
    expect(morgenIso(spaetabends)).toBe('2026-06-13')
  })
})
