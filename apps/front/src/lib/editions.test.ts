import { formatBroadcastDate } from './editions'

describe('formatBroadcastDate', () => {
  it('prefers the exact broadcast_at timestamp', () => {
    expect(
      formatBroadcastDate({ broadcast_date: '2026-08-17', broadcast_at: '2026-08-17T12:03:00+02:00' })
    ).toBe('17.08.2026')
  })

  it('falls back to the date-only field when broadcast_at is null', () => {
    expect(formatBroadcastDate({ broadcast_date: '2026-08-17', broadcast_at: null })).toBe('17.08.2026')
  })

  it('falls back to the raw string for an unparseable date', () => {
    expect(formatBroadcastDate({ broadcast_date: 'not-a-date', broadcast_at: null })).toBe('not-a-date')
  })
})
