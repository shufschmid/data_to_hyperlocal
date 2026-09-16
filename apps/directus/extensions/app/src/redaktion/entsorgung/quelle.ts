// Fetching the machine-readable calendar of a municipality.
//
// Only ever an address a person registered — the same rule as `shared/statbl`
// and as the PDF upload next to it. Nothing on a municipal website is
// discovered, followed or crawled: 87 municipalities are 87 unrelated websites,
// and guessing at them is how a newsroom tool turns into a nuisance.
//
// One request, no retries. The calendar is read when an editor asks for it, and
// a source that is down stays down for the minute it takes to ask again.

/** The source could not be read. The reason is in the message, for the row. */
export class QuelleNichtLadbar extends Error {
  constructor(
    message: string,
    readonly url: string
  ) {
    super(message)
    this.name = 'QuelleNichtLadbar'
  }
}

/** How long an editor waits for a municipality's server. */
const ZEITGRENZE_MS = 30_000

/**
 * A calendar is a few hundred kilobytes. Five megabytes of text is a redirect
 * into something else, and reading it costs memory for nothing.
 */
const MAX_ZEICHEN = 5_000_000

export interface QuelleOptionen {
  /** Goes into the User-Agent, so a municipality can see who is asking. */
  kontakt: string
  fetchImpl?: typeof fetch
}

/** The text behind an address, or a `QuelleNichtLadbar` saying why not. */
export async function holeQuelle(
  url: string,
  optionen: QuelleOptionen
): Promise<string> {
  let adresse: URL
  try {
    adresse = new URL(url)
  } catch {
    throw new QuelleNichtLadbar('Die Quelladresse ist keine Adresse.', url)
  }
  if (adresse.protocol !== 'http:' && adresse.protocol !== 'https:') {
    throw new QuelleNichtLadbar(
      `Nur http und https werden gelesen, nicht ${adresse.protocol}`,
      url
    )
  }

  const fetchImpl = optionen.fetchImpl ?? fetch
  let antwort: Response
  try {
    antwort = await fetchImpl(url, {
      headers: { 'User-Agent': `Die Redaktion (${optionen.kontakt})` },
      signal: AbortSignal.timeout(ZEITGRENZE_MS)
    })
  } catch (cause) {
    throw new QuelleNichtLadbar(
      `Nicht erreichbar: ${cause instanceof Error ? cause.message : String(cause)}`,
      url
    )
  }

  if (!antwort.ok) {
    throw new QuelleNichtLadbar(`Antwortete mit HTTP ${antwort.status}.`, url)
  }

  const text = await antwort.text()
  if (text.length > MAX_ZEICHEN) {
    throw new QuelleNichtLadbar(
      `Die Antwort ist zu gross (${text.length} Zeichen).`,
      url
    )
  }
  // An empty body is a broken source, not a year without collections. Read as
  // "no dates" it would delete a whole year of Termine on the next run.
  if (text.trim() === '') {
    throw new QuelleNichtLadbar('Die Antwort ist leer.', url)
  }
  return text
}
