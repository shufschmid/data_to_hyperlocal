import { describe, expect, it } from 'vitest'
import {
  erkenneRhythmus,
  monatsmusterAus,
  ordinalImMonat,
  passtInsMonatsmuster,
  verschiebeTage,
  wochentagVon
} from './rhythmus'

describe('Kalenderhelfer', () => {
  it('rechnet Wochentag, Ordinal und Verschiebung in UTC', () => {
    expect(wochentagVon('2026-09-21')).toBe(1) // Montag
    expect(ordinalImMonat('2026-09-30')).toEqual({ n: 5, letzter: true })
    expect(ordinalImMonat('2026-09-23')).toEqual({ n: 4, letzter: false })
    expect(verschiebeTage('2026-09-28', 7)).toBe('2026-10-05')
    expect(verschiebeTage('2026-01-01', -1)).toBe('2025-12-31')
  })

  it('liest ein Monatsmuster aus Worten und prueft Daten dagegen', () => {
    const muster = monatsmusterAus(
      'Jeweils am letzten Mittwoch im Monat, 15–18 Uhr'
    )
    expect(muster).toEqual({ ordinal: -1, wochentag: 3 })
    expect(passtInsMonatsmuster('2026-09-30', muster!)).toBe(true)
    expect(passtInsMonatsmuster('2026-09-23', muster!)).toBe(false)
    expect(monatsmusterAus('jeden ersten Freitag')).toEqual({
      ordinal: 1,
      wochentag: 5
    })
    expect(monatsmusterAus('am Freitag, 25. September')).toBeNull()
  })
})

describe('erkenneRhythmus aus den Terminen', () => {
  it('ein Termin ist einmalig, es sei denn die Site datiert die Serie weit zurueck', () => {
    expect(
      erkenneRhythmus({ termine: ['2026-09-25'], text: '' }).rhythmus
    ).toBe('einmalig')
    expect(
      erkenneRhythmus({
        termine: ['2026-09-21'],
        text: '',
        serieSeit: '2022-04-04'
      }).rhythmus
    ).toBe('seltener')
  })

  it('lueckenlose Tage sind laufend, zwei oder drei Tage bleiben einmalig', () => {
    const tage = [
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26'
    ]
    expect(erkenneRhythmus({ termine: tage, text: '' }).rhythmus).toBe(
      'laufend'
    )
    expect(
      erkenneRhythmus({ termine: tage.slice(0, 2), text: '' }).rhythmus
    ).toBe('einmalig')
    expect(
      erkenneRhythmus({
        termine: ['2026-08-10', '2027-03-21'],
        text: '',
        spanne: true
      }).rhythmus
    ).toBe('laufend')
    expect(
      erkenneRhythmus({
        termine: ['2026-11-27', '2026-11-29'],
        text: '',
        spanne: true
      }).rhythmus
    ).toBe('einmalig')
  })

  it('woechentlich mit Ferienluecke, 14-taeglich ebenfalls, und der fehlende Termin wird genannt', () => {
    // Reinach: every Tuesday with the autumn holidays in between.
    const palais = [
      '2026-09-22',
      '2026-10-13',
      '2026-10-20',
      '2026-10-27',
      '2026-11-03'
    ]
    expect(erkenneRhythmus({ termine: palais, text: '' }).rhythmus).toBe(
      'woechentlich'
    )
    // Binningen: Meditation every second Monday.
    const meditation = [
      '2026-09-21',
      '2026-10-12',
      '2026-10-26',
      '2026-11-09',
      '2026-11-23'
    ]
    expect(erkenneRhythmus({ termine: meditation, text: '' }).rhythmus).toBe(
      'woechentlich'
    )
    // A weekly series with exactly one beat missing names it.
    const befund = erkenneRhythmus({
      termine: ['2026-09-21', '2026-09-28', '2026-10-12', '2026-10-19'],
      text: ''
    })
    expect(befund).toMatchObject({
      rhythmus: 'woechentlich',
      fehlend: '2026-10-05'
    })
  })

  it('monatlich vor woechentlich: alle vier Wochen ist monatlich', () => {
    const vaersli = ['2026-09-22', '2026-10-20', '2026-11-17', '2026-12-15']
    expect(erkenneRhythmus({ termine: vaersli, text: '' }).rhythmus).toBe(
      'monatlich'
    )
    const mittagstisch = [
      '2026-09-24',
      '2026-10-29',
      '2026-11-26',
      '2026-12-17'
    ]
    expect(erkenneRhythmus({ termine: mittagstisch, text: '' }).rhythmus).toBe(
      'monatlich'
    )
  })

  it('Einwohnerrat alle sechs Wochen ist seltener', () => {
    const er = [
      '2026-09-21',
      '2026-11-02',
      '2026-12-14',
      '2027-01-25',
      '2027-03-15'
    ]
    expect(erkenneRhythmus({ termine: er, text: '' }).rhythmus).toBe('seltener')
  })

  it('nennt den Termin, der aus dem Wochentagsmuster faellt', () => {
    const befund = erkenneRhythmus({
      termine: ['2026-09-21', '2026-09-28', '2026-10-05', '2026-10-13'],
      text: ''
    })
    expect(befund.abweichung).toBe('2026-10-13')
  })
})

describe('erkenneRhythmus aus dem Text', () => {
  it('Worte schlagen einen einzelnen Termin', () => {
    expect(
      erkenneRhythmus({
        termine: ['2026-09-25'],
        text: 'Freitags-Treff. Jeden Freitag von 9 bis 11 Uhr im BOZ.'
      })
    ).toMatchObject({ rhythmus: 'woechentlich', ausText: true })
    expect(
      erkenneRhythmus({
        termine: ['2026-09-24'],
        text: 'Einmal im Monat besucht uns die Beraterin.'
      })
    ).toMatchObject({ rhythmus: 'monatlich', ausText: true })
    expect(
      erkenneRhythmus({
        termine: ['2026-09-25'],
        text: 'Jeweils am letzten Freitag im Monat wird musiziert.'
      })
    ).toMatchObject({ rhythmus: 'monatlich', ausText: true })
    expect(
      erkenneRhythmus({
        termine: ['2026-09-23'],
        text: 'findet jeden zweiten Donnerstag statt'
      })
    ).toMatchObject({ rhythmus: 'woechentlich' })
  })

  it('eine Spanne, die der Text woechentlich nennt, ist keine Ausstellung', () => {
    const befund = erkenneRhythmus({
      termine: ['2026-05-07', '2026-12-17'],
      spanne: true,
      text: 'Wir treffen uns jeden Donnerstag um 9.30 Uhr.'
    })
    expect(befund.rhythmus).toBe('woechentlich')
  })

  it('merkt sich «das ganze Jahr ueber» und prueft ein Monatsmuster gegen die Daten', () => {
    expect(
      erkenneRhythmus({
        termine: ['2026-09-25'],
        text: 'Jeden Freitagnachmittag, das ganze Jahr über.'
      }).ganzjaehrig
    ).toBe(true)
    const befund = erkenneRhythmus({
      termine: ['2026-08-26', '2026-09-23', '2026-10-28'],
      text: 'Jeweils am letzten Mittwoch des Monats.'
    })
    expect(befund).toMatchObject({
      rhythmus: 'monatlich',
      abweichung: '2026-09-23'
    })
  })
})

describe('ein laufendes Angebot mit einem Ruhetag', () => {
  // Gemessen am ersten Lauf ueber die zehn Kalender (20.09.2026): Arlesheim
  // druckt die Ausstellung «HAP Grieshaber» als eine Zeile je Oeffnungstag,
  // 52 Tage lang, montags geschlossen. Die strenge Fassung («jeder Abstand
  // ist 1») liess sie als „seltener" durchfallen — und ihr letzter Tag waere
  // damit nie als letzte Gelegenheit erkannt worden, die Regel, auf der die
  // Redaktion ausdruecklich besteht.
  const ausstellung: string[] = []
  for (let t = 0; t < 50; t += 1) {
    const tag = new Date(Date.UTC(2026, 8, 20) + t * 86_400_000)
    if (tag.getUTCDay() === 1) continue
    ausstellung.push(tag.toISOString().slice(0, 10))
  }

  it('bleibt laufend', () => {
    const befund = erkenneRhythmus({ termine: ausstellung, text: '' })
    expect(befund.rhythmus).toBe('laufend')
  })

  it('macht aus zwei Tagen am Stueck trotzdem einen einmaligen Anlass', () => {
    expect(
      erkenneRhythmus({ termine: ['2026-10-20', '2026-10-21'], text: '' })
        .rhythmus
    ).toBe('einmalig')
  })

  it('ruehrt eine woechentliche Reihe nicht an', () => {
    expect(
      erkenneRhythmus({
        termine: ['2026-09-22', '2026-09-29', '2026-10-06'],
        text: ''
      }).rhythmus
    ).toBe('woechentlich')
  })
})
