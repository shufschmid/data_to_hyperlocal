import { describe, expect, it, vi } from 'vitest'
import { holeQuelle, QuelleNichtLadbar } from './quelle'

const OPTIONEN = { kontakt: 'it@example.ch' }

function antwort(text: string, init: ResponseInit = {}): Response {
  return new Response(text, { status: 200, ...init })
}

describe('holeQuelle', () => {
  it('identifies itself and gives up after half a minute', async () => {
    const gefragt = vi.fn().mockResolvedValue(antwort('BEGIN:VCALENDAR'))

    await holeQuelle('https://gemeinde.example.ch/abfall.ics', {
      ...OPTIONEN,
      fetchImpl: gefragt as never
    })

    const [url, init] = gefragt.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://gemeinde.example.ch/abfall.ics')
    const headers = new Headers(init.headers)
    expect(headers.get('User-Agent')).toContain('it@example.ch')
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })

  it('reads only http and https, and only an address somebody typed', async () => {
    const gefragt = vi.fn()

    // Nothing on a municipal website is discovered or followed. A `file://` or
    // a `data:` address in this field is a mistake or an attack, never a source.
    await expect(
      holeQuelle('file:///etc/passwd', {
        ...OPTIONEN,
        fetchImpl: gefragt as never
      })
    ).rejects.toThrow(QuelleNichtLadbar)
    expect(gefragt).not.toHaveBeenCalled()
  })

  it('turns a refusal into a QuelleNichtLadbar that names the status', async () => {
    const gefragt = vi
      .fn()
      .mockResolvedValue(new Response('weg', { status: 404 }))

    await expect(
      holeQuelle('https://gemeinde.example.ch/abfall.ics', {
        ...OPTIONEN,
        fetchImpl: gefragt as never
      })
    ).rejects.toThrow(/404/)
  })

  it('turns an unreachable host into a QuelleNichtLadbar', async () => {
    const gefragt = vi.fn().mockRejectedValue(new Error('ENOTFOUND'))

    await expect(
      holeQuelle('https://gemeinde.example.ch/abfall.ics', {
        ...OPTIONEN,
        fetchImpl: gefragt as never
      })
    ).rejects.toThrow(QuelleNichtLadbar)
  })

  it('refuses an answer too large to be a calendar', async () => {
    const gefragt = vi.fn().mockResolvedValue(antwort('x'.repeat(5_000_001)))

    // A calendar is a few hundred kilobytes. Five megabytes of text is a
    // redirect into something else, and reading it costs memory for nothing.
    await expect(
      holeQuelle('https://gemeinde.example.ch/abfall.ics', {
        ...OPTIONEN,
        fetchImpl: gefragt as never
      })
    ).rejects.toThrow(/gross/)
  })

  it('takes an empty answer as unreadable, not as a year without collections', async () => {
    const gefragt = vi.fn().mockResolvedValue(antwort(''))

    // An empty body is a broken source. Read as "no dates" it would delete a
    // whole year of Termine on the next run.
    await expect(
      holeQuelle('https://gemeinde.example.ch/abfall.ics', {
        ...OPTIONEN,
        fetchImpl: gefragt as never
      })
    ).rejects.toThrow(QuelleNichtLadbar)
  })
})
