import { envFlag, optionalEnv, requireEnv } from '../shared/env'
import {
  ingestDossiersFromMailbox,
  type IngestMailboxDeps,
  type IngestMailboxResult
} from '../dossiers/ingest-mailbox'
import type { MailboxConfig } from '../dossiers/mailbox'
import type { Punkt6Dossier } from '../types/schema'

// Punkt6 dossier-PDF mail arrives in the SAME mailbox as the Regionaljournal
// dossiers (confirmed with the editor) under a different subject/filename
// pattern - so this reuses dossiers/mailbox.ts's IMAP client and
// dossiers/ingest-mailbox.ts's orchestration unchanged (both are already
// parameterized by MailboxConfig.subjectFilter and, since ingestDossiersFromMailbox
// was made generic for exactly this reuse, by the target dossier row type), and
// only builds a second MailboxConfig with PUNKT6_IMAP_SUBJECT_FILTER instead of
// IMAP_SUBJECT_FILTER. Dedup runs against `punkt6_dossiers.source_subject`
// independently of the Regionaljournal dossiers' own dedup set, so the two
// ingestion runs never interfere with each other.

export function punkt6ImapConfigFromEnv(): MailboxConfig {
  return {
    host: requireEnv('IMAP_HOST'),
    port: Number(optionalEnv('IMAP_PORT', '993')),
    secure: envFlag('IMAP_SECURE', true),
    user: requireEnv('IMAP_USER'),
    password: requireEnv('IMAP_PASSWORD'),
    mailbox: optionalEnv('IMAP_MAILBOX', 'INBOX'),
    // REQUIRED, never null: this mailbox is shared between several saved
    // searches, so "no filter" does not mean "everything here is punkt6" - it
    // means ingesting the other feeds' mails wholesale. Measured 2026-09-01: a
    // Directus process whose environment predated this variable ran with a null
    // filter and turned 14 Regionaljournal/Gemeinden mails into punkt6 dossiers,
    // every one failing at the PDF parser. Refuse loudly, naming the variable.
    subjectFilter: requireEnv('PUNKT6_IMAP_SUBJECT_FILTER')
  }
}

export type IngestPunkt6MailboxDeps = IngestMailboxDeps<Punkt6Dossier>

export function ingestPunkt6DossiersFromMailbox(
  limit: number,
  deps: IngestPunkt6MailboxDeps
): Promise<IngestMailboxResult> {
  return ingestDossiersFromMailbox(limit, deps)
}
