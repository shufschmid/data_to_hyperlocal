import { formatDateTime, statusLabel } from './notes'

describe('formatDateTime', () => {
  it('formats a timestamp', () => {
    expect(formatDateTime('2026-07-29T08:30:00Z')).toMatch(/2026/)
  })

  it('never renders Invalid Date', () => {
    expect(formatDateTime(null)).toBe('—')
    expect(formatDateTime('keine Zeit')).toBe('—')
  })
})

describe('statusLabel', () => {
  it('translates known statuses and passes through unknown ones', () => {
    expect(statusLabel('draft')).toBe('Entwurf')
    expect(statusLabel('irgendwas')).toBe('irgendwas')
  })
})
