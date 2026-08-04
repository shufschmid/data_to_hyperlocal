// Pure presentation helpers. Anything with a rule in it goes here so it can be
// tested without rendering a component — see notes.test.ts.
//
// There is deliberately nothing here that takes a derived value apart again: the
// backend writes the summary and its tags into their own fields, so the UI reads
// them as they are. A parser here would be the storage format implemented a
// second time, and the second copy always drifts.

/** German date/time for display. Falls back to an em dash rather than "Invalid Date". */
export function formatDateTime(value: string | null): string {
  if (value === null) return '—'

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'

  return new Intl.DateTimeFormat('de-CH', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    draft: 'Entwurf',
    published: 'Veroeffentlicht',
    archived: 'Archiviert'
  }

  return labels[status] ?? status
}
