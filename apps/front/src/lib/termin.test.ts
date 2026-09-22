import {
  auftritteBeimUmschalten,
  eingabeAus,
  kurzesDatum,
  pruefeEingabe,
  terminSatz,
  weichtAb
} from './termin'

describe('terminSatz', () => {
  it('sagt, dass es keinen Termin gibt — und was dann gilt', () => {
    expect(terminSatz(null, null)).toMatch(/Kein Termin/)
  })

  it('nennt Termin, Ende und die Auftritte', () => {
    expect(terminSatz({ ideal: '2026-11-02', ende: '2026-11-13', auftritte: ['2026-11-02'] }, true)).toBe(
      'Termin 02.11.2026 · bis 13.11.2026 · wichtig: Auftritte sofort nach Publikation, 02.11.2026'
    )
    expect(terminSatz({ ideal: '2026-10-09', ende: '2026-10-09', auftritte: [] }, false)).toBe(
      'Termin 09.10.2026 · ein Auftritt am Werktag davor'
    )
  })
})

describe('weichtAb', () => {
  const t = { ideal: '2026-10-17', ende: '2026-10-17', auftritte: ['2026-10-17'] }

  it('erkennt den gekippten Wichtig-Schalter — das Lernsignal', () => {
    expect(weichtAb(t, t, true, false)).toBe(true)
    expect(weichtAb(t, t, true, true)).toBe(false)
  })

  it('erkennt verschobene Tage', () => {
    expect(weichtAb({ ...t, ideal: '2026-10-18' }, t, false, false)).toBe(true)
    expect(weichtAb({ ...t, auftritte: [] }, t, false, false)).toBe(true)
    expect(weichtAb(null, null, false, false)).toBe(false)
    expect(weichtAb(null, t, false, false)).toBe(true)
  })
})

describe('auftritteBeimUmschalten', () => {
  it('setzt beim Einschalten den Termin selbst, wenn die Liste leer ist', () => {
    expect(auftritteBeimUmschalten([], true, '2026-10-17')).toEqual(['2026-10-17'])
    expect(auftritteBeimUmschalten(['2026-10-01'], true, '2026-10-17')).toEqual(['2026-10-01'])
  })

  it('leert die Liste beim Ausschalten — dann gilt die Standardregel', () => {
    expect(auftritteBeimUmschalten(['2026-10-17'], false, '2026-10-17')).toEqual([])
  })
})

describe('pruefeEingabe', () => {
  it('laesst einen leeren Termin zu und einen sauberen', () => {
    expect(pruefeEingabe({ ideal: null, ende: null, auftritte: [], wichtig: false })).toBeNull()
    expect(
      pruefeEingabe({ ideal: '2026-10-17', ende: '2026-10-19', auftritte: ['2026-10-17'], wichtig: true })
    ).toBeNull()
  })

  // Dieselben Regeln wie der Endpunkt — der Fehler steht auf der Karte, bevor
  // etwas geschickt wird.
  it('benennt, was der Endpunkt ablehnen wuerde', () => {
    expect(pruefeEingabe({ ideal: null, ende: '2026-10-19', auftritte: [], wichtig: false })).toMatch(
      /braucht einen Termin/
    )
    expect(pruefeEingabe({ ideal: '2026-10-17', ende: '2026-10-16', auftritte: [], wichtig: false })).toMatch(
      /vor dem Termin/
    )
    expect(
      pruefeEingabe({ ideal: '2026-10-17', ende: null, auftritte: ['2026-10-18'], wichtig: true })
    ).toMatch(/nach dem Ende/)
    expect(
      pruefeEingabe({
        ideal: '2026-10-17',
        ende: '2026-10-31',
        auftritte: ['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'],
        wichtig: true
      })
    ).toMatch(/fünf/)
  })
})

describe('eingabeAus / kurzesDatum', () => {
  it('uebersetzt die gespeicherte Zeile in die Eingabe', () => {
    expect(eingabeAus(null, null)).toEqual({ ideal: null, ende: null, auftritte: [], wichtig: false })
    expect(eingabeAus({ ideal: '2026-10-17', ende: '2026-10-17', auftritte: ['2026-10-17'] }, true)).toEqual({
      ideal: '2026-10-17',
      ende: '2026-10-17',
      auftritte: ['2026-10-17'],
      wichtig: true
    })
    expect(kurzesDatum('2026-10-17')).toBe('17.10.2026')
  })
})
