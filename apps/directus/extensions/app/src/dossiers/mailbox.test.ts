import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import {
  createMailboxFetcher,
  type ImapClientLike,
  type MailboxConfig
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

const NONE = new Set<string>()

const RAW_MESSAGE_WITH_PDF = [
  'From: SMD <smd@example.com>',
  'To: dossier@example.com',
  'Subject: Dossier vom 17.08.2026',
  'Message-ID: <test123@example.com>',
  'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="BOUNDARY"',
  '',
  '--BOUNDARY',
  'Content-Type: text/plain',
  '',
  'Siehe Anhang.',
  '',
  '--BOUNDARY',
  'Content-Type: application/pdf; name="Dossier.pdf"',
  'Content-Disposition: attachment; filename="Dossier.pdf"',
  'Content-Transfer-Encoding: base64',
  '',
  Buffer.from('%PDF-1.4 fake content').toString('base64'),
  '',
  '--BOUNDARY--',
  ''
].join('\r\n')

const RAW_MESSAGE_WITHOUT_ATTACHMENT = [
  'From: a@example.com',
  'Subject: no attachment',
  'Content-Type: text/plain',
  '',
  'Hello',
  ''
].join('\r\n')

function fakeClient(overrides: Partial<ImapClientLike> = {}): ImapClientLike {
  return {
    connect: vi.fn().mockResolvedValue(undefined),
    getMailboxLock: vi.fn().mockResolvedValue({ release: vi.fn() }),
    search: vi.fn().mockResolvedValue([1]),
    fetch: vi.fn().mockImplementation(async function* () {
      yield {
        uid: 1,
        envelope: { subject: 'Dossier vom 17.08.2026' },
        bodyStructure: {
          type: 'multipart/mixed',
          childNodes: [
            { type: 'text/plain' },
            {
              type: 'application/pdf',
              disposition: 'attachment',
              dispositionParameters: { filename: 'Dossier.pdf' }
            }
          ]
        }
      }
    }),
    download: vi.fn().mockResolvedValue({
      content: Readable.from([Buffer.from(RAW_MESSAGE_WITH_PDF)])
    }),
    messageFlagsAdd: vi.fn().mockResolvedValue(true),
    logout: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    ...overrides
  }
}

describe('createMailboxFetcher', () => {
  it('downloads and parses the PDF attachment of a selected message', async () => {
    const client = fakeClient()
    const fetcher = createMailboxFetcher(() => client)
    const { messages } = await fetcher(CONFIG, 5, NONE)

    expect(messages).toHaveLength(1)
    expect(messages[0]!.subject).toBe('Dossier vom 17.08.2026')
    expect(messages[0]!.attachmentFilename).toBe('Dossier.pdf')
    expect(messages[0]!.attachmentBuffer.toString()).toContain('%PDF-1.4')
    expect(client.connect).toHaveBeenCalled()
    expect(client.getMailboxLock).toHaveBeenCalledWith('INBOX')
    expect(client.search).toHaveBeenCalledWith({}, { uid: true })
  })

  it('does not log out on its own after a successful fetch - markSeen still needs the connection', async () => {
    const client = fakeClient()
    const fetcher = createMailboxFetcher(() => client)
    await fetcher(CONFIG, 5, NONE)

    expect(client.logout).not.toHaveBeenCalled()
  })

  it('marks the message \\Seen only when markSeen is actually invoked, and close() releases the lock and logs out', async () => {
    const release = vi.fn()
    const client = fakeClient({
      getMailboxLock: vi.fn().mockResolvedValue({ release })
    })
    const fetcher = createMailboxFetcher(() => client)
    const { messages, close } = await fetcher(CONFIG, 5, NONE)

    expect(client.messageFlagsAdd).not.toHaveBeenCalled()
    await messages[0]!.markSeen()
    expect(client.messageFlagsAdd).toHaveBeenCalledWith('1', ['\\Seen'], {
      uid: true
    })

    await close()
    expect(release).toHaveBeenCalled()
    expect(client.logout).toHaveBeenCalled()
  })

  it('skips a subject already known to this Directus instance, regardless of its \\Seen state', async () => {
    const client = fakeClient()
    const fetcher = createMailboxFetcher(() => client)

    const { messages } = await fetcher(
      CONFIG,
      5,
      new Set(['Dossier vom 17.08.2026'])
    )
    expect(messages).toEqual([])
    expect(client.download).not.toHaveBeenCalled()
  })

  it('returns nothing, without downloading, when the search finds no messages', async () => {
    const client = fakeClient({ search: vi.fn().mockResolvedValue([]) })
    const fetcher = createMailboxFetcher(() => client)

    const { messages } = await fetcher(CONFIG, 5, NONE)
    expect(messages).toEqual([])
    expect(client.download).not.toHaveBeenCalled()
  })

  it('logs out on its own when something in the fetch phase throws', async () => {
    const client = fakeClient({
      getMailboxLock: vi.fn().mockRejectedValue(new Error('boom'))
    })
    const fetcher = createMailboxFetcher(() => client)

    await expect(fetcher(CONFIG, 5, NONE)).rejects.toThrow('boom')
    expect(client.logout).toHaveBeenCalled()
  })

  it('releases the lock and logs out when something after locking throws', async () => {
    const release = vi.fn()
    const client = fakeClient({
      getMailboxLock: vi.fn().mockResolvedValue({ release }),
      search: vi.fn().mockRejectedValue(new Error('search failed'))
    })
    const fetcher = createMailboxFetcher(() => client)

    await expect(fetcher(CONFIG, 5, NONE)).rejects.toThrow('search failed')
    expect(release).toHaveBeenCalled()
    expect(client.logout).toHaveBeenCalled()
  })

  it('skips a message whose bodyStructure claimed a PDF but the parsed message has none', async () => {
    const client = fakeClient({
      download: vi.fn().mockResolvedValue({
        content: Readable.from([Buffer.from(RAW_MESSAGE_WITHOUT_ATTACHMENT)])
      })
    })
    const fetcher = createMailboxFetcher(() => client)

    const { messages } = await fetcher(CONFIG, 5, NONE)
    expect(messages).toEqual([])
  })

  it('respects the subject filter passed through to selectDossierMessages', async () => {
    const client = fakeClient()
    const fetcher = createMailboxFetcher(() => client)

    const { messages } = await fetcher(
      { ...CONFIG, subjectFilter: 'newsletter' },
      5,
      NONE
    )
    expect(messages).toEqual([])
    expect(client.download).not.toHaveBeenCalled()
  })
})
