// Reading Swiss Basketball — the network half.
//
// Why this host and not the other one. `basketplan.ch` is where these data are
// produced, and it turns us away: `robots.txt` is a blanket `Disallow: /` on
// both of its hosts (measured 17 September 2026, `Last-Modified` 2022), and it
// publishes no documented API that would make the amtsblattportal exception
// apply. A refusal is accepted here, so that door stays shut for good.
//
// The association publishes the same data under its own origin.
// `https://swiss.basketball/robots.txt` is `User-agent: * / Disallow:` — an
// empty Disallow allows everything — and `/basketplan/showLeagueSchedule.do`
// answers `text/xml` with one `<GameRSS>` per match. Swiss Basketball is the
// publisher of its own championship; reading it there is not a way around the
// other host's rule, it is a different publisher's own permission. The
// newsroom decided this on 17 September 2026 (F8).
//
// Two limits are enforced in code rather than remembered:
//
//   * nothing on `basketplan.ch` is ever fetched, whatever address an editor
//     pastes into `vereine.ergebnis_url`, and
//   * `findTeamById.do` is never fetched at all — its answer hands over a club
//     official's name, three private mobile numbers and a private address,
//     unasked. We do not need it.
//
// No second door: this is a data endpoint, and the crawler returns XML wrapped
// in a rendered page. `fuerZweiteTuer` draws that line for every other reader
// too — a refusal here is a refusal, and the run says so.

import { buildUserAgent } from '../agenda'
import {
  istErlaubteQuelle,
  parseSpielplan,
  type Basketballspielplan
} from './parse'

export {
  istErlaubteQuelle,
  oeffentlicheLigaseite,
  ordneBasketballZu,
  parseSpielplan,
  type BasketballBegegnung,
  type Basketballspielplan,
  type BasketballZuordnung,
  type BasketballZuordnungen
} from './parse'

export class BasketplanFehler extends Error {
  constructor(
    message: string,
    readonly url: string
  ) {
    super(message)
    this.name = 'BasketplanFehler'
  }
}

export interface AbrufOptionen {
  kontakt: string
  fetchImpl?: typeof fetch
  /** Injected so the played/unplayed decision is testable. */
  jetzt?: Date
}

export interface Spielplanabruf extends Basketballspielplan {
  /**
   * True when the answer holds as many matches as `totalGames` asked for.
   *
   * The cap lives in the address the editor stored, so it is not ours to
   * raise — but a cap that bites silently reads as «no more matches», and the
   * newsroom's rule is that it has to be audible. Same shape as simap's.
   */
  abgeschnitten: boolean
}

/**
 * One request per GROUP, not per team.
 *
 * A group request carries every club in it, which is the point: BC
 * Allschwil-Algon and Liestal Basket 44 play in the same NL1 Men group as BC
 * Arlesheim's men, so one request serves three municipalities. Two clubs of one
 * group therefore share one address, and the run fetches it once — the football
 * pattern («one request for all»), not the volleyball one.
 */
export async function holeSpielplan(
  url: string,
  optionen: AbrufOptionen
): Promise<Spielplanabruf> {
  if (!istErlaubteQuelle(url)) {
    throw new BasketplanFehler(
      'Nur der Spielplan von swiss.basketball wird gelesen ' +
        '(…/basketplan/showLeagueSchedule.do). basketplan.ch sperrt uns aus, ' +
        'und findTeamById.do traegt private Kontaktdaten.',
      url
    )
  }

  const fetchImpl = optionen.fetchImpl ?? fetch
  let antwort: Response
  try {
    antwort = await fetchImpl(url, {
      headers: {
        'User-Agent': buildUserAgent(optionen.kontakt),
        Accept: 'text/xml, application/xml;q=0.9',
        'Accept-Language': 'de-CH,de;q=0.9'
      },
      redirect: 'follow',
      signal: AbortSignal.timeout(60_000)
    })
  } catch (cause) {
    throw new BasketplanFehler(
      `swiss.basketball nicht erreichbar: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
      url
    )
  }

  if (!antwort.ok) {
    throw new BasketplanFehler(
      `swiss.basketball antwortete mit ${antwort.status}.`,
      url
    )
  }

  const plan = parseSpielplan(
    await antwort.text(),
    optionen.jetzt ?? new Date()
  )
  return { ...plan, abgeschnitten: erreichtDeckel(url, plan.spiele.length) }
}

function erreichtDeckel(url: string, gelesen: number): boolean {
  let deckel: number
  try {
    deckel = Number.parseInt(
      new URL(url).searchParams.get('totalGames') ?? '',
      10
    )
  } catch {
    return false
  }
  return Number.isFinite(deckel) && deckel > 0 && gelesen >= deckel
}
