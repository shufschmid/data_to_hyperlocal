import { ImapFlow, type MessageStructureObject } from 'imapflow'
import { simpleParser } from 'mailparser'
import type { Readable } from 'node:stream'
import { envFlag, optionalEnv, requireEnv } from '../shared/env'
import { selectDossierMessages, type MessageSummary } from './select-messages'

// Fetches dossier-PDF emails from a mailbox via IMAP and turns each into an
// in-memory attachment buffer, ready to be uploaded to Directus Files. Shared by
// the scheduled dossiers-ingest-imap operation and the manual dossiers-ingest
// endpoint - same reasoning as process-dossier.ts being reused by the manual
// dossier-process endpoint and the scheduled dossiers-process-pending operation.
//
// NOT verifiable end-to-end in this build - there is no real mailbox or
// credentials available yet (see HANDOFF.md / the plan this was built from).
// select-messages.ts (what counts as a dossier message) is fully unit-tested
// without any IMAP connection; createMailboxFetcher's own orchestration is
// tested with a stubbed ImapClientLike (mailbox.test.ts), same seam pattern as
// shared/claude.ts's MessageSender. Only the real ImapFlow wiring itself (the
// default client factory below) needs a live smoke test once real IMAP_*
// credentials exist.

export interface DossierMessage {
  messageId: string
  subject: string
  attachmentFilename: string
  attachmentBuffer: Buffer
  markSeen: () => Promise<void>
}

export interface MailboxConfig {
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  mailbox: string
  subjectFilter: string | null
}

export interface MailboxFetchResult {
  messages: DossierMessage[]
  /** Closes the IMAP connection. Call once done with `messages` - each one's
   * `markSeen()` needs the connection to still be open, so the fetcher cannot
   * close it itself before returning. */
  close: () => Promise<void>
}

export type MailboxFetcher = (
  config: MailboxConfig,
  limit: number,
  knownSubjects: ReadonlySet<string>
) => Promise<MailboxFetchResult>

export function imapConfigFromEnv(): MailboxConfig {
  const subjectFilter = optionalEnv('IMAP_SUBJECT_FILTER', '')
  return {
    host: requireEnv('IMAP_HOST'),
    port: Number(optionalEnv('IMAP_PORT', '993')),
    secure: envFlag('IMAP_SECURE', true),
    user: requireEnv('IMAP_USER'),
    password: requireEnv('IMAP_PASSWORD'),
    mailbox: optionalEnv('IMAP_MAILBOX', 'INBOX'),
    subjectFilter: subjectFilter === '' ? null : subjectFilter
  }
}

/** The minimal slice of imapflow's ImapFlow this module needs - satisfied
 * structurally by the real client, and trivially fakeable in tests. */
export interface ImapClientLike {
  connect(): Promise<void>
  /** Not mailboxOpen() - a bare SELECT is not enough to keep later commands
   * (messageFlagsAdd in particular) working once real network latency and
   * interleaved async work sit between them. getMailboxLock is imapflow's own
   * recommended way to hold a mailbox selected for a whole unit of work. */
  getMailboxLock(path: string): Promise<{ release: () => void }>
  search(
    query: Record<string, never>,
    options: { uid: boolean }
  ): Promise<number[] | false>
  fetch(
    range: number[],
    query: { envelope: boolean; bodyStructure: boolean },
    options: { uid: boolean }
  ): AsyncIterableIterator<{
    uid: number
    envelope?: { subject?: string }
    bodyStructure?: MessageStructureObject
  }>
  download(
    range: string,
    part: string | undefined,
    options: { uid: boolean }
  ): Promise<{ content: Readable }>
  messageFlagsAdd(
    range: string,
    flags: string[],
    options: { uid: boolean }
  ): Promise<boolean>
  logout(): Promise<void>
  close(): void
}

export type ImapClientFactory = (config: MailboxConfig) => ImapClientLike

const defaultClientFactory: ImapClientFactory = (config) =>
  new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false
  }) as unknown as ImapClientLike

function isPdfNode(node: MessageStructureObject): boolean {
  const type = node.type.toLowerCase()
  const filename = (
    node.dispositionParameters?.['filename'] ??
    node.parameters?.['name'] ??
    ''
  ).toLowerCase()
  return type === 'application/pdf' || filename.endsWith('.pdf')
}

function hasPdfAttachment(node: MessageStructureObject | undefined): boolean {
  if (!node) return false
  if (isPdfNode(node)) return true
  return (node.childNodes ?? []).some(hasPdfAttachment)
}

export function createMailboxFetcher(
  clientFactory: ImapClientFactory = defaultClientFactory
): MailboxFetcher {
  return async (config, limit, knownSubjects) => {
    const client = clientFactory(config)
    const closeConnection = () => client.logout().catch(() => client.close())

    await client.connect()

    let lock: { release: () => void } | undefined
    try {
      lock = await client.getMailboxLock(config.mailbox)
      const close = async () => {
        lock!.release()
        await closeConnection()
      }

      // All messages, not just unseen - see select-messages.ts for why \Seen is
      // not the dedup mechanism.
      const uids = await client.search({}, { uid: true })
      if (!uids || uids.length === 0) return { messages: [], close }

      const summaries: MessageSummary[] = []
      const subjectByUid = new Map<number, string>()
      for await (const message of client.fetch(
        uids,
        { envelope: true, bodyStructure: true },
        { uid: true }
      )) {
        const subject = message.envelope?.subject ?? '(kein Betreff)'
        subjectByUid.set(message.uid, subject)
        summaries.push({
          uid: message.uid,
          subject,
          hasPdfAttachment: hasPdfAttachment(message.bodyStructure)
        })
      }

      const selected = selectDossierMessages(summaries, {
        limit,
        subjectFilter: config.subjectFilter,
        knownSubjects
      })

      const results: DossierMessage[] = []
      for (const summary of selected) {
        const { content } = await client.download(
          String(summary.uid),
          undefined,
          { uid: true }
        )
        const parsed = await simpleParser(content)
        const pdfAttachment = parsed.attachments.find(
          (a) =>
            a.contentType === 'application/pdf' ||
            a.filename?.toLowerCase().endsWith('.pdf')
        )
        if (!pdfAttachment) continue // bodyStructure said PDF, the parsed message disagrees - skip defensively

        results.push({
          messageId: parsed.messageId ?? `uid-${summary.uid}`,
          subject: subjectByUid.get(summary.uid) ?? summary.subject,
          attachmentFilename:
            pdfAttachment.filename ?? `dossier-${summary.uid}.pdf`,
          attachmentBuffer: pdfAttachment.content,
          markSeen: async () => {
            await client.messageFlagsAdd(String(summary.uid), ['\\Seen'], {
              uid: true
            })
          }
        })
      }

      return { messages: results, close }
    } catch (error) {
      // Only the setup/fetch phase cleans up on its own failure - the success
      // path hands `close` to the caller instead, because each result's
      // markSeen() still needs the lock and connection open.
      lock?.release()
      await closeConnection()
      throw error
    }
  }
}

export const fetchDossierMessages: MailboxFetcher = createMailboxFetcher()
