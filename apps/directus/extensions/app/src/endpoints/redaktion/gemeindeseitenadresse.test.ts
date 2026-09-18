import { describe, expect, it, vi } from 'vitest'
import {
  ADRESSFELDER,
  speichereAdresse,
  type AdressErgebnis
} from './gemeindeseitenadresse'

function dienst(): {
  updateOne: (key: string, payload: Record<string, unknown>) => Promise<unknown>
} {
  return {
    updateOne: vi.fn(
      async (_key: string, _payload: Record<string, unknown>) => undefined
    )
  }
}

async function lauf(
  art: 'nachricht' | 'termin',
  roh: unknown,
  liesSeite = vi.fn(async () => 7)
): Promise<{
  ergebnis: AdressErgebnis
  gemeinden: ReturnType<typeof dienst>
  liesSeite: typeof liesSeite
}> {
  const gemeinden = dienst()
  const ergebnis = await speichereAdresse({
    art,
    roh,
    id: 'g1',
    gemeinden,
    liesSeite
  })
  return { ergebnis, gemeinden, liesSeite }
}

describe('ADRESSFELDER', () => {
  it('names one column per kind of page', () => {
    expect(ADRESSFELDER.nachricht.spalte).toBe('news_url')
    expect(ADRESSFELDER.termin.spalte).toBe('veranstaltungen_url')
  })
})

describe('speichereAdresse', () => {
  it('clears the events address without reading anything', async () => {
    const { ergebnis, gemeinden, liesSeite } = await lauf('termin', '   ')
    expect(ergebnis).toEqual({ status: 'geleert' })
    expect(liesSeite).not.toHaveBeenCalled()
    expect(gemeinden.updateOne).toHaveBeenCalledWith('g1', {
      veranstaltungen_url: null
    })
  })

  it('clears the news address and its error line together', async () => {
    const { gemeinden } = await lauf('nachricht', '')
    expect(gemeinden.updateOne).toHaveBeenCalledWith('g1', {
      news_url: null,
      news_letzter_fehler: null
    })
  })

  it('refuses something that is not a web address, before reading', async () => {
    const { ergebnis, liesSeite } = await lauf('termin', 'riehen.ch/anlaesse')
    expect(ergebnis).toEqual({
      status: 'ungueltig',
      grund: 'Das ist keine Web-Adresse (https://…).'
    })
    expect(liesSeite).not.toHaveBeenCalled()
  })

  it('reads the page BEFORE it writes, and writes nothing when the read fails', async () => {
    const liesSeite = vi.fn(async () => {
      throw new Error('Seitenaufbau nicht erkannt')
    })
    const { ergebnis, gemeinden } = await lauf(
      'termin',
      'https://www.arlesheim.ch/de/veranstaltungen/',
      liesSeite
    )
    expect(ergebnis).toEqual({
      status: 'nicht_lesbar',
      grund: 'Seitenaufbau nicht erkannt'
    })
    expect(gemeinden.updateOne).not.toHaveBeenCalled()
  })

  it('stores the events address once the page answered, and says what it found', async () => {
    const { ergebnis, gemeinden, liesSeite } = await lauf(
      'termin',
      '  https://www.arlesheim.ch/de/veranstaltungen/  '
    )
    expect(ergebnis).toEqual({
      status: 'gesetzt',
      adresse: 'https://www.arlesheim.ch/de/veranstaltungen/',
      gefunden: 7
    })
    expect(liesSeite).toHaveBeenCalledWith(
      'https://www.arlesheim.ch/de/veranstaltungen/',
      'termin'
    )
    expect(gemeinden.updateOne).toHaveBeenCalledWith('g1', {
      veranstaltungen_url: 'https://www.arlesheim.ch/de/veranstaltungen/'
    })
  })

  it('clears the shared error line when a news address is stored', async () => {
    const { gemeinden } = await lauf(
      'nachricht',
      'https://www.riehen.ch/aktuelles/'
    )
    expect(gemeinden.updateOne).toHaveBeenCalledWith('g1', {
      news_url: 'https://www.riehen.ch/aktuelles/',
      news_letzter_fehler: null
    })
  })
})
