import { describe, expect, it, vi } from 'vitest'
import {
  ingestDossiersFromMailbox,
  type IngestMailboxDeps
} from './ingest-mailbox'
import type {
  DossierMessage,
  MailboxConfig,
  MailboxFetchResult
} from './mailbox'

const CONFIG: MailboxConfig = {
  host: 'imap.example.com',
  port: 993,
  secure: true,
  user: 'user',
  password: 'pass',
  mailbox: 'INBOX',
  subjectFilter: null
}

function message(overrides: Partial<DossierMessage> = {}): DossierMessage {
  return {
    messageId: '<abc@example.com>',
    subject: 'Dossier vom 17.08.2026',
    attachmentFilename: 'Dossier.pdf',
    attachmentBuffer: Buffer.from('%PDF-1.4'),
    markSeen: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

function fetchResult(
  messages: DossierMessage[],
  close = vi.fn().mockResolvedValue(undefined)
): MailboxFetchResult {
  return { messages, close }
}

function deps(overrides: Partial<IngestMailboxDeps> = {}): IngestMailboxDeps {
  return {
    dossiers: {
      readOne: vi.fn(),
      createOne: vi.fn().mockResolvedValue('new-dossier-id'),
      updateOne: vi.fn(),
      readByQuery: vi.fn().mockResolvedValue([])
    },
    uploadFile: vi.fn().mockResolvedValue('file-id'),
    fetchMessages: vi.fn().mockResolvedValue(fetchResult([message()])),
    mailboxConfig: CONFIG,
    logger: { warn: vi.fn(), error: vi.fn() },
    ...overrides
  }
}

describe('ingestDossiersFromMailbox', () => {
  it('creates a pending dossier per fetched message and marks it seen', async () => {
    const d = deps()
    const result = await ingestDossiersFromMailbox(5, d)

    expect(result).toEqual({
      fetched: 1,
      created: 1,
      dossierIds: ['new-dossier-id']
    })
    expect(d.dossiers.createOne).toHaveBeenCalledWith({
      status: 'pending',
      source_file: 'file-id',
      source_message_id: '<abc@example.com>',
      source_subject: 'Dossier vom 17.08.2026'
    })
  })

  it('closes the mailbox connection after processing every message, not before', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    const msg = message()
    const d = deps({
      fetchMessages: vi.fn().mockResolvedValue(fetchResult([msg], close))
    })

    await ingestDossiersFromMailbox(5, d)

    // markSeen() (which needs the connection) must have happened before close().
    const markSeenOrder = (msg.markSeen as ReturnType<typeof vi.fn>).mock
      .invocationCallOrder[0]!
    const closeOrder = close.mock.invocationCallOrder[0]!
    expect(markSeenOrder).toBeLessThan(closeOrder)
  })

  it('still closes the connection even if a message fails to ingest', async () => {
    const close = vi.fn().mockResolvedValue(undefined)
    const d = deps({
      fetchMessages: vi.fn().mockResolvedValue(fetchResult([message()], close)),
      uploadFile: vi.fn().mockRejectedValue(new Error('boom'))
    })

    await ingestDossiersFromMailbox(5, d)
    expect(close).toHaveBeenCalled()
  })

  it("passes the existing dossiers' subjects as knownSubjects to the fetcher", async () => {
    const d = deps({
      dossiers: {
        readOne: vi.fn(),
        createOne: vi.fn().mockResolvedValue('new-dossier-id'),
        updateOne: vi.fn(),
        readByQuery: vi
          .fn()
          .mockResolvedValue([
            { source_subject: 'Already there' },
            { source_subject: null }
          ])
      }
    })

    await ingestDossiersFromMailbox(5, d)

    expect(d.fetchMessages).toHaveBeenCalledWith(
      CONFIG,
      5,
      new Set(['Already there'])
    )
  })

  it('skips a message whose upload or create fails, without marking it seen, and continues with the rest', async () => {
    const failing = message({ subject: 'Broken', markSeen: vi.fn() })
    const ok = message({
      subject: 'Fine',
      markSeen: vi.fn().mockResolvedValue(undefined)
    })
    const d = deps({
      fetchMessages: vi.fn().mockResolvedValue(fetchResult([failing, ok])),
      uploadFile: vi
        .fn()
        .mockRejectedValueOnce(new Error('upload failed'))
        .mockResolvedValueOnce('file-id-2')
    })

    const result = await ingestDossiersFromMailbox(5, d)

    expect(result).toEqual({
      fetched: 2,
      created: 1,
      dossierIds: ['new-dossier-id']
    })
    expect(failing.markSeen).not.toHaveBeenCalled()
    expect(ok.markSeen).toHaveBeenCalled()
    expect(d.logger.warn).toHaveBeenCalled()
  })

  it('returns an empty result when nothing new is found', async () => {
    const d = deps({
      fetchMessages: vi.fn().mockResolvedValue(fetchResult([]))
    })
    await expect(ingestDossiersFromMailbox(5, d)).resolves.toEqual({
      fetched: 0,
      created: 0,
      dossierIds: []
    })
    expect(d.dossiers.createOne).not.toHaveBeenCalled()
  })
})
