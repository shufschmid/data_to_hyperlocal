import { describe, expect, it, vi } from 'vitest'
import {
  autoHinweis,
  haltegrund,
  istAutoTisch,
  ladeAutoPublizieren,
  publiziereAutomatisch
} from './autopublish'

const logger = { warn: vi.fn() }

function dienste(
  an: unknown,
  zeilen: Array<{
    id: string
    status: string
    zeit_warnungen: string[] | null
  }>,
  verweigert: string[] = []
) {
  const updateOne = vi.fn(async (id: string) => {
    if (verweigert.includes(id)) throw new Error('Der Link fehlt.')
    return id
  })
  return {
    updateOne,
    dienste: {
      einstellungen: {
        readByQuery: vi.fn(async () =>
          an === undefined ? [] : [{ auto_publizieren: an }]
        )
      },
      meldungen: { readByQuery: vi.fn(async () => zeilen), updateOne },
      logger
    }
  }
}

describe('ladeAutoPublizieren', () => {
  it('is on only for a stored true', async () => {
    for (const [wert, erwartet] of [
      [true, true],
      [false, false],
      [null, false],
      ['true', false],
      [undefined, false]
    ] as const) {
      const { dienste: d } = dienste(wert, [])
      expect(await ladeAutoPublizieren(d.einstellungen, 'kanton', logger)).toBe(
        erwartet
      )
    }
  })

  it('stays off when the setting cannot be read', async () => {
    const einstellungen = {
      readByQuery: vi.fn(async () => {
        throw new Error('kein Feld')
      })
    }
    expect(await ladeAutoPublizieren(einstellungen, 'sport', logger)).toBe(
      false
    )
  })
})

describe('haltegrund', () => {
  it('lets a clean draft through and holds everything else', () => {
    expect(
      haltegrund({ id: 'a', status: 'entwurf', zeit_warnungen: null })
    ).toBeNull()
    expect(
      haltegrund({ id: 'a', status: 'entwurf', zeit_warnungen: [] })
    ).toBeNull()
    expect(
      haltegrund({ id: 'a', status: 'entwurf', zeit_warnungen: ['x'] })
    ).toBe('1 Warnung')
    expect(
      haltegrund({ id: 'a', status: 'in_pruefung', zeit_warnungen: null })
    ).toBe('Status in_pruefung')
  })
})

describe('publiziereAutomatisch', () => {
  const zeilen = [
    { id: 'sauber', status: 'entwurf', zeit_warnungen: null },
    { id: 'warnung', status: 'entwurf', zeit_warnungen: ['Zahl 7'] },
    { id: 'abgewiesen', status: 'entwurf', zeit_warnungen: null }
  ]

  it('publishes nothing while the desk is switched off', async () => {
    const { dienste: d, updateOne } = dienste(false, zeilen)
    const ergebnis = await publiziereAutomatisch(d, 'gemeinde', ['sauber'])
    expect(ergebnis).toEqual({ publiziert: [], zurueckgehalten: [] })
    expect(updateOne).not.toHaveBeenCalled()
    expect(d.meldungen.readByQuery).not.toHaveBeenCalled()
  })

  it('asks nothing when the run wrote nothing', async () => {
    const { dienste: d } = dienste(true, zeilen)
    await publiziereAutomatisch(d, 'gemeinde', [])
    expect(d.einstellungen.readByQuery).not.toHaveBeenCalled()
  })

  it('publishes clean drafts signed as automatik and names the rest', async () => {
    const { dienste: d, updateOne } = dienste(true, zeilen, ['abgewiesen'])
    const ergebnis = await publiziereAutomatisch(d, 'gemeinde', [
      'sauber',
      'warnung',
      'abgewiesen'
    ])
    expect(ergebnis.publiziert).toEqual(['sauber'])
    expect(ergebnis.zurueckgehalten).toEqual([
      { id: 'warnung', grund: '1 Warnung' },
      { id: 'abgewiesen', grund: 'Der Link fehlt.' }
    ])
    expect(updateOne).toHaveBeenCalledWith('sauber', {
      status: 'publiziert',
      publiziert_durch: 'automatik'
    })
    expect(updateOne).not.toHaveBeenCalledWith('warnung', expect.anything())
  })
})

describe('autoHinweis and istAutoTisch', () => {
  it('says nothing when nothing happened, and counts otherwise', () => {
    expect(autoHinweis({ publiziert: [], zurueckgehalten: [] })).toBeNull()
    expect(
      autoHinweis({
        publiziert: ['a', 'b'],
        zurueckgehalten: [{ id: 'c', grund: '1 Warnung' }]
      })
    ).toBe(
      'Auto-Publish: 2 Meldungen publiziert, 1 bleibt als Entwurf (Warnung oder abgewiesen).'
    )
  })

  it('knows the desks whose run writes drafts', () => {
    expect(istAutoTisch('sport')).toBe(true)
    expect(istAutoTisch('veranstaltung')).toBe(false)
    expect(istAutoTisch('amtsblatt')).toBe(false)
  })
})
