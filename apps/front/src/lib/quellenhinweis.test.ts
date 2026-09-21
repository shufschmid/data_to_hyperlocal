import { darfSchreiben } from './aktionen'
import { kannVonHand, kurzerFehler, laufFuer } from './quellenhinweis'

describe('kurzerFehler', () => {
  // Der gemessene Fall vom 21. September 2026: zweimal dieselbe Auskunft in
  // einem Satz, und die Zeile lief dreizeilig ueber den Bildschirm.
  it('macht aus der doppelten Absage einen Nachsatz', () => {
    expect(
      kurzerFehler(
        'EuroAirport nicht erreichbar: fetch failed — auch über den Crawler nicht: Crawler nicht erreichbar: fetch failed'
      )
    ).toBe('EuroAirport nicht erreichbar: fetch failed · auch nicht über den Crawler')
  })

  it('behaelt eine ANDERE Ursache, statt sie zu verschlucken', () => {
    expect(
      kurzerFehler('Bot-Pruefung (HTTP 403) — auch über den Crawler nicht: Crawler antwortete mit HTTP 502')
    ).toBe('Bot-Pruefung (HTTP 403) · über den Crawler: Crawler antwortete mit HTTP 502')
  })

  it('laesst einen einfachen Fehler in Ruhe', () => {
    expect(kurzerFehler('Zeitüberschreitung nach 20 Sekunden')).toBe('Zeitüberschreitung nach 20 Sekunden')
    expect(kurzerFehler(null)).toBe('')
    expect(kurzerFehler('   ')).toBe('')
  })
})

describe('laufFuer', () => {
  // Der Knopf muss GENAU den Lauf starten, der die Zeile geschrieben hat.
  it('schickt jede Quelle zu ihrem eigenen Lauf', () => {
    expect(laufFuer('euroairport')).toBe('quellen/lauf')
    expect(laufFuer('agenda')).toBe('quellen/lauf')
    expect(laufFuer('ods')).toBe('quellen/lauf')
    expect(laufFuer('statbl')).toBe('quellen/lauf')
    expect(laufFuer('amtsblatt')).toBe('amtsblatt/pruefen')
    expect(laufFuer('simap')).toBe('amtsblatt/pruefen')
  })

  it('gibt einem unbekannten Typ lieber keinen Knopf als einen falschen', () => {
    expect(laufFuer('was-neues')).toBeNull()
  })

  // Die Allowlist prueft, was als Zeichenkette im Code steht — dieser Knopf
  // baut seinen Pfad erst zur Laufzeit und waere dort unsichtbar. Genau so
  // sind am 18. September 2026 zwei fertige Funktionen mit «Unbekannte
  // Aktion» in der Produktion gelandet.
  it('nennt nur Pfade, die der Proxy auch weiterleitet', () => {
    for (const typ of ['agenda', 'ods', 'statbl', 'euroairport', 'amtsblatt', 'simap']) {
      const lauf = laufFuer(typ)
      expect(lauf).not.toBeNull()
      expect(darfSchreiben(lauf as string)).toBe(true)
    }
  })
})

describe('kannVonHand', () => {
  // Ein Agenda-Eintrag ist ein Satz zum Abtippen. Die Monatszahlen des
  // EuroAirports sind es nicht.
  it('bietet das Abtippen nur dort an, wo es etwas zum Abtippen gibt', () => {
    expect(kannVonHand('agenda')).toBe(true)
    expect(kannVonHand('euroairport')).toBe(false)
    expect(kannVonHand('ods')).toBe(false)
  })
})
