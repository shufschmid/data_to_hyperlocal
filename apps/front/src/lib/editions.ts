// Pure presentation helpers for editions - anything with a rule in it goes here
// so it's testable without rendering a component.

export interface BroadcastDateInput {
  broadcast_date: string
  broadcast_at: string | null
}

/** Prefers the exact SRGSSR timestamp (broadcast_at); falls back to the PDF's
 * own date-only field when audio hasn't been resolved yet. */
export function formatBroadcastDate(edition: BroadcastDateInput): string {
  const source = edition.broadcast_at ?? `${edition.broadcast_date}T00:00:00`
  const parsed = new Date(source)
  if (Number.isNaN(parsed.getTime())) return edition.broadcast_date

  return parsed.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
