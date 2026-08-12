import { parseAgenda, type AgendaEintrag } from './parse'

// Fetching the statistics office's publication agenda.
//
// This host sits behind a Cloudflare Managed Challenge, and the rules below are
// what make a scheduled fetch defensible rather than an attempt to defeat it:
//
//   1. We identify honestly. The User-Agent says what this is and who to
//      contact. We never claim to be a browser, and we never touch the TLS
//      handshake — Cloudflare fingerprints it (JA3/JA4), which is exactly why
//      Node's undici is challenged where curl is not. Faking that fingerprint
//      would be circumvention at the protocol level, worse than a fake
//      User-Agent. If we cannot get in as ourselves, we do not get in.
//   2. A handful of attempts per scheduled run, spaced out — the check is
//      probabilistic, so asking again is fair. Never a tight loop, and never
//      more than once a day overall.
//   3. No JavaScript is executed and no challenge is solved. If the page comes
//      back as an interstitial we treat it as unavailable, full stop, and the
//      operation reports it so a human can look instead.
//
// The page also carries `<meta name="robots" content="index, follow">`, so
// machine reading is intended; the challenge filters unknown automation rather
// than forbidding it.

export * from './parse'

export type AgendaFetch = (
  url: string,
  init: { headers: Record<string, string> }
) => Promise<Response>

export const defaultAgendaFetch: AgendaFetch = (url, init) => fetch(url, init)

/**
 * Identifies this application. Deliberately not browser-shaped.
 *
 * `AGENDA_KONTAKT` should be a mailbox someone reads — it is how the site
 * operator reaches us if our polling ever bothers them.
 */
export function buildUserAgent(kontakt: string): string {
  return `DieRedaktion/1.0 (redaktioneller Monitor; Kontakt ${kontakt})`
}

/** The site answered with a bot interstitial instead of the page. */
export class AgendaChallengeError extends Error {
  constructor(
    readonly url: string,
    readonly versuche: number
  ) {
    super(
      `Die Agenda-Seite hat nach ${versuche} Versuchen eine Bot-Pruefung ausgeliefert ` +
        'statt des Inhalts. Bitte die Seite von Hand oeffnen und den Eintrag ' +
        'unter "Ankuendigungen" nachtragen.'
    )
    this.name = 'AgendaChallengeError'
  }
}

export class AgendaRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly url: string
  ) {
    super(message)
    this.name = 'AgendaRequestError'
  }
}

/** Markers Cloudflare puts in the interstitial it serves instead of the page. */
const CHALLENGE_MARKER = [
  'Just a moment',
  '_cf_chl_opt',
  'cf-browser-verification'
]

export function istChallenge(html: string): boolean {
  return CHALLENGE_MARKER.some((marker) => html.includes(marker))
}

export const STANDARD_VERSUCHE = 3
export const STANDARD_PAUSE_MS = 4000

export interface AgendaOptions {
  /** Contact address put into the User-Agent. */
  kontakt: string
  /** Attempts before giving up for this run. A few, not many. */
  versuche?: number
  /** Pause between attempts, so this never becomes a tight loop. */
  pauseMs?: number
  fetchImpl?: AgendaFetch
  sleep?: (ms: number) => Promise<void>
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

export async function fetchAgenda(
  url: string,
  options: AgendaOptions
): Promise<AgendaEintrag[]> {
  const doFetch = options.fetchImpl ?? defaultAgendaFetch
  const sleep = options.sleep ?? defaultSleep
  const versuche = Math.max(options.versuche ?? STANDARD_VERSUCHE, 1)
  const pauseMs = options.pauseMs ?? STANDARD_PAUSE_MS

  for (let versuch = 1; versuch <= versuche; versuch += 1) {
    let response: Response
    try {
      response = await doFetch(url, {
        headers: {
          'User-Agent': buildUserAgent(options.kontakt),
          Accept: 'text/html',
          'Accept-Language': 'de-CH,de;q=0.9'
        }
      })
    } catch (cause) {
      // A dead connection is a fault, not a refusal — no point asking again in
      // the same run.
      throw new AgendaRequestError(
        0,
        `Agenda-Seite nicht erreichbar: ${cause instanceof Error ? cause.message : String(cause)}`,
        url
      )
    }

    const html = await response.text().catch(() => '')

    // Cloudflare answers the challenge with 403, but has also been observed
    // serving it with 200 — so the body decides, not the status code.
    if (istChallenge(html)) {
      if (versuch < versuche) {
        await sleep(pauseMs)
        continue
      }
      throw new AgendaChallengeError(url, versuche)
    }

    if (!response.ok) {
      throw new AgendaRequestError(
        response.status,
        `Agenda-Seite antwortete mit HTTP ${response.status}`,
        url
      )
    }

    return parseAgenda(html, new URL(url).origin)
  }

  // Unreachable: the loop either returns or throws.
  throw new AgendaChallengeError(url, versuche)
}
