import { formatPunkt6BroadcastDate, formatSeconds } from './punkt6-editions'

describe('formatPunkt6BroadcastDate', () => {
  it('formats an ISO date as de-CH', () => {
    expect(formatPunkt6BroadcastDate('2026-08-25')).toBe('25.08.2026')
  })

  it('falls back to the raw string for an unparseable date', () => {
    expect(formatPunkt6BroadcastDate('not-a-date')).toBe('not-a-date')
  })
})

describe('formatSeconds', () => {
  it('formats a seconds offset as HH:MM:SS', () => {
    expect(formatSeconds(49)).toBe('00:00:49')
    expect(formatSeconds(126)).toBe('00:02:06')
    expect(formatSeconds(3661)).toBe('01:01:01')
  })
})
