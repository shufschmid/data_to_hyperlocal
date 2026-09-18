import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { OdsFetch } from '../ods'
import {
  liesAbstimmungen,
  liesGemeindezahlen,
  liesVorherigesDatum
} from './index'

const OFFEN = JSON.parse(
  readFileSync(
    join(__dirname, 'fixtures', '11990-2026-09-27-drei-gemeinden.json'),
    'utf8'
  )
) as unknown[]

function antwort(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body
  } as unknown as Response
}

describe('liesAbstimmungen', () => {
  it('holt ein Datum in EINEM Abruf ueber alle Gemeinden', async () => {
    const doFetch = vi.fn<OdsFetch>().mockResolvedValue(antwort(OFFEN))

    const ergebnis = await liesAbstimmungen(
      'https://data.bl.ch',
      '11990',
      '2026-09-27',
      doFetch
    )

    expect(doFetch).toHaveBeenCalledTimes(1)
    const url = doFetch.mock.calls[0]?.[0] ?? ''
    expect(url).toContain('/datasets/11990/exports/json')
    expect(decodeURIComponent(url)).toContain("date=date'2026-09-27'")
    expect(ergebnis.zeilen).toHaveLength(15)
  })

  it('antwortet leer, wenn es fuer diesen Tag keine Zeilen gibt', async () => {
    const doFetch = vi.fn<OdsFetch>().mockResolvedValue(antwort([]))

    const ergebnis = await liesAbstimmungen(
      'https://data.bl.ch',
      '11990',
      '2026-09-20',
      doFetch
    )

    expect(ergebnis.zeilen).toEqual([])
    expect(ergebnis.verworfen).toEqual([])
  })
})

describe('liesVorherigesDatum', () => {
  it('fragt nach dem juengsten Abstimmungstag VOR diesem', async () => {
    const doFetch = vi
      .fn<OdsFetch>()
      .mockResolvedValue(
        antwort({ results: [{ date: '2026-06-14T00:00:00+00:00' }] })
      )

    const datum = await liesVorherigesDatum(
      'https://data.bl.ch',
      '11990',
      '2026-09-27',
      doFetch
    )

    const url = decodeURIComponent(doFetch.mock.calls[0]?.[0] ?? '')
    expect(url).toContain("date<date'2026-09-27'")
    expect(url).toContain('group_by=date')
    expect(datum).toBe('2026-06-14')
  })

  it('antwortet null, wenn es keinen frueheren Tag gibt', async () => {
    const doFetch = vi
      .fn<OdsFetch>()
      .mockResolvedValue(antwort({ results: [] }))

    expect(
      await liesVorherigesDatum(
        'https://data.bl.ch',
        '11990',
        '2003-01-01',
        doFetch
      )
    ).toBeNull()
  })
})

describe('liesGemeindezahlen', () => {
  it('fragt nur die genannten Gemeinden ab', async () => {
    const doFetch = vi
      .fn<OdsFetch>()
      .mockResolvedValue(antwort({ results: OFFEN }))

    await liesGemeindezahlen(
      'https://data.bl.ch',
      '11990',
      '2026-06-14',
      ['2761', '2765'],
      doFetch
    )

    const url = decodeURIComponent(doFetch.mock.calls[0]?.[0] ?? '')
    expect(url).toContain("date=date'2026-06-14'")
    expect(url).toContain('entity_id="2761"')
    expect(url).toContain('entity_id="2765"')
  })

  it('macht keinen Abruf, wenn keine Gemeinde genannt ist', async () => {
    const doFetch = vi.fn<OdsFetch>()

    const ergebnis = await liesGemeindezahlen(
      'https://data.bl.ch',
      '11990',
      '2026-06-14',
      [],
      doFetch
    )

    expect(doFetch).not.toHaveBeenCalled()
    expect(ergebnis.zeilen).toEqual([])
  })
})
