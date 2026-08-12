import { describe, expect, it, vi } from 'vitest'
import {
  AgendaChallengeError,
  AgendaRequestError,
  buildUserAgent,
  fetchAgenda,
  istChallenge,
  type AgendaFetch
} from './index'

const URL_AGENDA =
  'https://www.baselland.ch/politik-und-behorden/direktionen/finanz-und-kirchendirektion/daten-statistik/abteilung-statistik/agenda-2026/'

const SEITE = `<span class="text-nowrap">
<br>07.07.2026 <a href="https://statistik.bl.ch/web_portal/2_9">Abfallstatistik 2025</a>
<br>
</span>`

const CHALLENGE = `<!DOCTYPE html><html><head><title>Just a moment...</title></head>
<body><script>window._cf_chl_opt={cRay:'abc'};</script></body></html>`

function antwort(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body
  } as unknown as Response
}

describe('buildUserAgent', () => {
  // The whole ethical footing of this connector: we say what we are. A
  // browser-shaped UA would be spoofing the exact signal the challenge reads.
  it('identifiziert die Anwendung und nennt einen Kontakt', () => {
    const ua = buildUserAgent('it@bajour.ch')

    expect(ua).toContain('DieRedaktion')
    expect(ua).toContain('it@bajour.ch')
  })

  it('gibt sich nicht als Browser aus', () => {
    const ua = buildUserAgent('it@bajour.ch')

    for (const getarnt of [
      'Mozilla',
      'Chrome',
      'Safari',
      'AppleWebKit',
      'Gecko'
    ]) {
      expect(ua).not.toContain(getarnt)
    }
  })
})

describe('istChallenge', () => {
  it('erkennt die Cloudflare-Zwischenseite', () => {
    expect(istChallenge(CHALLENGE)).toBe(true)
  })

  it('haelt echten Inhalt nicht faelschlich fuer eine Pruefung', () => {
    expect(istChallenge(SEITE)).toBe(false)
  })
})

describe('fetchAgenda', () => {
  it('schickt den ehrlichen User-Agent mit', async () => {
    const fetchImpl = vi.fn<AgendaFetch>().mockResolvedValue(antwort(SEITE))

    await fetchAgenda(URL_AGENDA, { kontakt: 'it@bajour.ch', fetchImpl })

    const headers = fetchImpl.mock.calls[0]?.[1].headers ?? {}
    expect(headers['User-Agent']).toContain('DieRedaktion')
    expect(headers['User-Agent']).not.toContain('Mozilla')
  })

  it('liefert die geparsten Eintraege', async () => {
    const fetchImpl = vi.fn<AgendaFetch>().mockResolvedValue(antwort(SEITE))

    const eintraege = await fetchAgenda(URL_AGENDA, {
      kontakt: 'it@bajour.ch',
      fetchImpl
    })

    expect(eintraege).toHaveLength(1)
    expect(eintraege[0]?.titel).toBe('Abfallstatistik 2025')
  })

  // The site has been seen serving the interstitial with a 200, so the status
  // code alone is not a usable signal.
  it('erkennt die Pruefung auch bei HTTP 200', async () => {
    const fetchImpl = vi
      .fn<AgendaFetch>()
      .mockResolvedValue(antwort(CHALLENGE, 200))

    await expect(
      fetchAgenda(URL_AGENDA, {
        kontakt: 'it@bajour.ch',
        fetchImpl,
        versuche: 1
      })
    ).rejects.toBeInstanceOf(AgendaChallengeError)
  })

  it('erkennt die Pruefung bei HTTP 403', async () => {
    const fetchImpl = vi
      .fn<AgendaFetch>()
      .mockResolvedValue(antwort(CHALLENGE, 403))

    await expect(
      fetchAgenda(URL_AGENDA, {
        kontakt: 'it@bajour.ch',
        fetchImpl,
        versuche: 1
      })
    ).rejects.toBeInstanceOf(AgendaChallengeError)
  })

  // The check is probabilistic, so asking again within one run is fair — but a
  // bounded number of times, with a pause, and never in a tight loop.
  it('versucht es mehrmals, bevor es aufgibt', async () => {
    const fetchImpl = vi
      .fn<AgendaFetch>()
      .mockResolvedValue(antwort(CHALLENGE, 403))
    const sleep = vi.fn().mockResolvedValue(undefined)

    await fetchAgenda(URL_AGENDA, {
      kontakt: 'it@bajour.ch',
      fetchImpl,
      sleep,
      versuche: 3,
      pauseMs: 4000
    }).catch(() => undefined)

    expect(fetchImpl).toHaveBeenCalledTimes(3)
    // Pauses between attempts, not after the last one.
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalledWith(4000)
  })

  it('hoert sofort auf, sobald ein Versuch durchkommt', async () => {
    const fetchImpl = vi
      .fn<AgendaFetch>()
      .mockResolvedValueOnce(antwort(CHALLENGE, 403))
      .mockResolvedValueOnce(antwort(SEITE))
    const sleep = vi.fn().mockResolvedValue(undefined)

    const eintraege = await fetchAgenda(URL_AGENDA, {
      kontakt: 'it@bajour.ch',
      fetchImpl,
      sleep,
      versuche: 3
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(eintraege[0]?.titel).toBe('Abfallstatistik 2025')
  })

  it('nennt im Fehler die Zahl der Versuche und was zu tun ist', async () => {
    const fetchImpl = vi
      .fn<AgendaFetch>()
      .mockResolvedValue(antwort(CHALLENGE, 403))
    const sleep = vi.fn().mockResolvedValue(undefined)

    const fehler = await fetchAgenda(URL_AGENDA, {
      kontakt: 'it@bajour.ch',
      fetchImpl,
      sleep,
      versuche: 3
    }).catch((e: unknown) => e)

    expect(fehler).toBeInstanceOf(AgendaChallengeError)
    expect((fehler as AgendaChallengeError).versuche).toBe(3)
    expect((fehler as AgendaChallengeError).message).toContain('3 Versuchen')
    expect((fehler as AgendaChallengeError).message).toContain('von Hand')
  })

  // A dead socket is a fault, not a refusal — repeating it in the same run
  // would just be noise.
  it('wiederholt einen Verbindungsabbruch nicht', async () => {
    const fetchImpl = vi
      .fn<AgendaFetch>()
      .mockRejectedValue(new Error('ETIMEDOUT'))

    await fetchAgenda(URL_AGENDA, {
      kontakt: 'it@bajour.ch',
      fetchImpl,
      versuche: 3
    }).catch(() => undefined)

    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('meldet einen echten Serverfehler getrennt von der Pruefung', async () => {
    const fetchImpl = vi
      .fn<AgendaFetch>()
      .mockResolvedValue(antwort('<h1>Boom</h1>', 500))

    const fehler = await fetchAgenda(URL_AGENDA, {
      kontakt: 'it@bajour.ch',
      fetchImpl
    }).catch((e: unknown) => e)

    expect(fehler).toBeInstanceOf(AgendaRequestError)
    expect((fehler as AgendaRequestError).status).toBe(500)
  })

  it('meldet einen Verbindungsabbruch als Anfragefehler', async () => {
    const fetchImpl = vi
      .fn<AgendaFetch>()
      .mockRejectedValue(new Error('ETIMEDOUT'))

    const fehler = await fetchAgenda(URL_AGENDA, {
      kontakt: 'it@bajour.ch',
      fetchImpl
    }).catch((e: unknown) => e)

    expect(fehler).toBeInstanceOf(AgendaRequestError)
    expect((fehler as AgendaRequestError).status).toBe(0)
  })
})
