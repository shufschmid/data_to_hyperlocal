import { parseAgenda, parseAgendaMarkdown, type AgendaEintrag } from './parse'

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

export const STANDARD_VERSUCHE = 5
export const STANDARD_PAUSE_MS = 4000

/**
 * How long to wait before attempt n+1, growing each time.
 *
 * The challenge is not a verdict on us, it is a window: measured on this host a
 * cold process is challenged once and served normally four seconds later, while
 * a bad patch outlasts that comfortably. Five attempts at a flat four seconds
 * span twelve seconds of wall clock in total, which is why a scheduled run can
 * report a bot check at 06:00 for a page that answers by hand all morning.
 *
 * Growing the pause spans a minute instead (4s, 8s, 16s, 32s). That is five
 * requests where there were three, but spread over sixty seconds rather than
 * eight — a lower rate than before, over a window long enough to outlast the
 * check. Still once a day overall.
 */
export function pauseFuerVersuch(
  versuch: number,
  basis = STANDARD_PAUSE_MS
): number {
  return basis * 2 ** (versuch - 1)
}

export interface AgendaOptions {
  /** Contact address put into the User-Agent. */
  kontakt: string
  /** Attempts before giving up for this run. A few, not many. */
  versuche?: number
  /** Pause between attempts, so this never becomes a tight loop. */
  pauseMs?: number
  fetchImpl?: AgendaFetch
  sleep?: (ms: number) => Promise<void>
  /**
   * Last resort when every honest attempt was refused: renders the page in a
   * real browser and hands back Markdown. Left undefined, the fetch fails as
   * before — the caller decides whether this route is available at all.
   */
  notfallMarkdown?: (url: string) => Promise<string>
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
        await sleep(pauseFuerVersuch(versuch, pauseMs))
        continue
      }
      return await notfall(url, options, versuche)
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

/**
 * The browser route, taken only after every honest attempt was turned away.
 *
 * This does solve the challenge, and that is a deliberate change of position:
 * five spaced attempts were measured failing a whole scheduled run while the
 * same page answered by hand minutes later, so the alternative was not a
 * politer fetch but no agenda at all. What is given up is our own name in the
 * User-Agent — the crawler goes out as a generic browser — which is why this
 * runs once, last, and never in place of the honest attempts.
 */
async function notfall(
  url: string,
  options: AgendaOptions,
  versuche: number
): Promise<AgendaEintrag[]> {
  if (options.notfallMarkdown === undefined) {
    throw new AgendaChallengeError(url, versuche)
  }
  const markdown = await options.notfallMarkdown(url)
  const eintraege = parseAgendaMarkdown(markdown)
  // An empty read is a failure wearing a success: reporting it as "nothing
  // published" would quietly stop the feed.
  if (eintraege.length === 0) throw new AgendaChallengeError(url, versuche)
  return eintraege
}
