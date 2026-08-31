export interface MessageSummary {
  uid: number
  subject: string
  hasPdfAttachment: boolean
}

export interface SelectMessagesOptions {
  limit: number
  subjectFilter: string | null
  /** Subjects already present as `dossiers.source_subject` - skip these. */
  knownSubjects: ReadonlySet<string>
}

/**
 * Picks which mailbox messages a run should download and turn into dossiers:
 * a PDF attachment, optionally matching a subject filter, not already ingested,
 * most recent first, capped at `limit`. Kept pure and separate from the actual
 * IMAP connection (mailbox.ts) so "what counts as a new dossier message" is
 * testable without a mailbox.
 *
 * Deliberately not filtered by the IMAP \Seen flag - the flag lives on the
 * mailbox, shared across every Directus instance that ever connects to it (a
 * fresh server deployment, a colleague's local setup), so "already seen" does
 * not mean "already in this Directus". `knownSubjects`, sourced from this
 * instance's own `dossiers` collection, is the real source of truth for
 * dedup. The message is still marked \Seen after a successful ingest, purely
 * for mailbox hygiene - never relied on for correctness.
 */
export function selectDossierMessages(
  summaries: MessageSummary[],
  options: SelectMessagesOptions
): MessageSummary[] {
  const safeLimit =
    Number.isFinite(options.limit) && options.limit > 0
      ? Math.floor(options.limit)
      : 5
  const filter = options.subjectFilter?.trim().toLowerCase() || null

  return summaries
    .filter((m) => m.hasPdfAttachment)
    .filter((m) => filter === null || m.subject.toLowerCase().includes(filter))
    .filter((m) => !options.knownSubjects.has(m.subject))
    .sort((a, b) => b.uid - a.uid) // most recent first - uid increases monotonically within a mailbox
    .slice(0, safeLimit)
}
