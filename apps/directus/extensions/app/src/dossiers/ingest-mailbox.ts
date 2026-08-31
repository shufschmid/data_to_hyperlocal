import type { DossierLogger, ItemsServiceLike } from './process-dossier'
import type { MailboxConfig, MailboxFetcher } from './mailbox'
import type { Dossier } from '../types/schema'

// Turns unfetched mailbox messages into `dossiers` rows (status='pending').
// Shared by the manual dossiers-ingest endpoint and the scheduled
// dossiers-ingest-imap operation - same reasoning as process-dossier.ts being
// shared by dossier-process and dossiers-process-pending.
//
// Deliberately does not process the new dossiers itself (PDF parsing, SRGSSR,
// Claude) - that stays a separate step (dossier-process / dossiers-process-pending),
// same split as before. Ingesting is fast (a mailbox fetch + file upload per
// message); processing one dossier can take 15-35s of real API calls, and
// chaining several of those into one HTTP request risks a reverse-proxy timeout
// on a real deployment - keeping them separate means the caller decides how many
// processing calls to make and how to pace them.
//
// Generic over the target "dossier" row type (T): the Punkt6 pipeline reuses this
// exact orchestration unchanged (punkt6/ingest-mailbox.ts), since a mailbox-sourced
// "pending row to process later" is the same shape for both shows. Defaults to
// Dossier so every existing caller/type reference here needs no change.

export interface IngestMailboxDeps<T = Dossier> {
  dossiers: ItemsServiceLike<T>
  /** Uploads a PDF to Directus Files, returning its file id. */
  uploadFile: (buffer: Buffer, filename: string) => Promise<string>
  fetchMessages: MailboxFetcher
  mailboxConfig: MailboxConfig
  logger: DossierLogger
}

export interface IngestMailboxResult {
  fetched: number
  created: number
  dossierIds: string[]
}

export async function ingestDossiersFromMailbox<
  T extends {
    status: string
    source_file: string
    source_message_id: string | null
    source_subject: string | null
  }
>(limit: number, deps: IngestMailboxDeps<T>): Promise<IngestMailboxResult> {
  const existing = (await deps.dossiers.readByQuery({
    fields: ['source_subject'],
    limit: -1
  })) as {
    source_subject: string | null
  }[]
  const knownSubjects = new Set(
    existing.map((d) => d.source_subject).filter((s): s is string => s !== null)
  )

  const { messages, close } = await deps.fetchMessages(
    deps.mailboxConfig,
    limit,
    knownSubjects
  )

  try {
    const dossierIds: string[] = []
    for (const message of messages) {
      try {
        const fileId = await deps.uploadFile(
          message.attachmentBuffer,
          message.attachmentFilename
        )
        const dossierId = await deps.dossiers.createOne({
          status: 'pending',
          source_file: fileId,
          source_message_id: message.messageId,
          source_subject: message.subject
        } as Partial<T>)

        // Only after the dossier row exists - a message that failed to ingest
        // stays unmarked and is retried on the next run (see mailbox.ts for why
        // \Seen itself is not the dedup mechanism). Needs the connection
        // fetchMessages left open for exactly this.
        await message.markSeen()
        dossierIds.push(dossierId)
      } catch (error) {
        deps.logger.warn(
          error,
          `ingest-mailbox: skipped message ${message.messageId}`
        )
      }
    }

    return { fetched: messages.length, created: dossierIds.length, dossierIds }
  } finally {
    await close()
  }
}
