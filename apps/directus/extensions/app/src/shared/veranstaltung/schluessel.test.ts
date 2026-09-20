import { describe, expect, it } from 'vitest'
import { normalisiereTitel, serienSchluessel, startZeit } from './schluessel'

describe('normalisiereTitel', () => {
  it('nimmt Datum, Zeit, Wochentag, Jahr und Absage-Marker heraus', () => {
    expect(normalisiereTitel('Kinderkleiderbörse ist leider abgesagt')).toBe(
      'kinderkleiderbörse'
    )
    expect(normalisiereTitel('Abstimmungen vom 27.09.2026')).toBe(
      'abstimmungen vom'
    )
    expect(normalisiereTitel('Chorprojekte Herbst 2026')).toBe(
      'chorprojekte herbst'
    )
    expect(normalisiereTitel('Freitags Treff, 09:00 Uhr')).toBe(
      'freitags treff'
    )
    expect(normalisiereTitel('Meditation am Montag')).toBe(
      'meditation am montag'
    )
  })

  it('haelt Umlaute und bringt Satzzeichen auf ein Leerzeichen', () => {
    expect(normalisiereTitel('Alder & Bahn - eine Ausstellung')).toBe(
      'alder bahn eine ausstellung'
    )
  })
})

describe('serienSchluessel', () => {
  it('ist Titel plus Lokalitaet, ohne Zeit — die Zeit nur auf Verlangen', () => {
    const e = {
      titel: 'Markt des Alterns',
      lokalitaet: 'Kultur- und Sportzentrum',
      zeit: '13:00–18:00',
      serie: null
    }
    expect(serienSchluessel(e)).toBe(
      'markt des alterns|kultur und sportzentrum'
    )
    expect(serienSchluessel(e, true)).toBe(
      'markt des alterns|kultur und sportzentrum|13:00'
    )
  })

  it('nimmt die Serien-Id der Site, wo sie eine druckt', () => {
    expect(
      serienSchluessel({
        titel: 'Einwohnerratssitzung',
        lokalitaet: null,
        zeit: null,
        serie: '2648'
      })
    ).toBe('serie:2648')
  })

  it('faltet Absage und Datum im Titel auf dieselbe Serie', () => {
    const a = serienSchluessel({
      titel: 'Kinderkleiderbörse',
      lokalitaet: 'BOZ',
      zeit: null,
      serie: null
    })
    const b = serienSchluessel({
      titel: 'Kinderkleiderbörse ist leider abgesagt',
      lokalitaet: 'BOZ',
      zeit: null,
      serie: null
    })
    expect(a).toBe(b)
  })

  it('startZeit liest den Beginn', () => {
    expect(startZeit('18:00–21:00')).toBe('18:00')
    expect(startZeit(null)).toBe('')
  })
})
