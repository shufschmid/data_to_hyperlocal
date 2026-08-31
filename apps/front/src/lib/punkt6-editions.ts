// Pure presentation helpers for Punkt6 editions - mirrors lib/editions.ts.
// Punkt6 has no SRGSSR-exact-timestamp equivalent (no `broadcast_at`), so this is
// a plain date-only formatter rather than a "prefer the precise field" fallback.

export function formatPunkt6BroadcastDate(broadcastDate: string): string {
  const parsed = new Date(`${broadcastDate}T00:00:00`)
  if (Number.isNaN(parsed.getTime())) return broadcastDate

  return parsed.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

/** "00:02:06" from a seconds offset - matches the PDF/telebasel.ch's own HH:MM:SS convention. */
export function formatSeconds(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = Math.floor(totalSeconds % 60)
  return [h, m, s].map((n) => String(n).padStart(2, '0')).join(':')
}
