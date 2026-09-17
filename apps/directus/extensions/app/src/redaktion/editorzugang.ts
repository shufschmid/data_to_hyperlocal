// The door from the We.Publish editor into this newsroom.
//
// A journalist opens the newsroom as an "External App" inside the editor. The
// editor hands over a short-lived JWT (`createExternalAppToken`, 240 minutes,
// `audience: app.url`); this module holds the rules that decide whether that
// token buys a Directus session, and nothing else. No fetch, no database, no
// Express — those live in `endpoints/redaktion/editorzugang.ts`.
//
// **Why the audience is checked HERE and not left to the editor.** The editor's
// `/external-apps/userinfo` reads the `aud` of the token, looks for ANY
// registered external app whose origin matches it, and verifies the signature
// with that audience. So a token minted for a DIFFERENT external app of the
// same house passes userinfo and comes back with a valid user. Without the
// check below, anyone able to obtain a token for any tool in that editor would
// receive a newsroom session. `EDITOR_HERKUNFT` is therefore the origin THIS
// instance is registered under, not the editor's own address.
//
// Read in the editor's repo on 17 September 2026 (branch
// `zettelkasten-slash-erweiterungspunkt`):
// `libs/external-apps/api/src/lib/external-apps.resolver.ts` and
// `…/external-apps-userinfo.controller.ts`.

/** The permission that says: this person publishes articles in the editor. */
export const RECHT_PUBLIZIEREN = 'CAN_PUBLISH_ARTICLE'

/** The permission that says: this person may read articles, nothing more. */
export const RECHT_LESEN = 'CAN_GET_ARTICLES'

export const KEIN_KONTO =
  'Für dieses Editor-Konto gibt es in der Redaktion noch keinen Zugang.'

export const KEIN_ZUGANG =
  'Dieses Editor-Konto darf im Editor keine Artikel publizieren und bekommt darum keinen Zugang zur Redaktion.'

/**
 * What a reader is told.
 *
 * Read-only is a real answer, not a mistake — and today it ends at the door,
 * because the newsroom has no Directus reader role
 * (`schema/collections/roles.json` holds Administrator and Dorfkoenig, and
 * Dorfkoenig is a token role without app access). Creating one is a rights
 * decision and belongs in the admin UI, not in this file.
 */
export const NUR_LESEN =
  'Dieses Editor-Konto darf Artikel nur lesen. Die Redaktion hat dafür noch keine Leserolle; bitte bei der Redaktionsleitung melden.'

export const NICHT_KONFIGURIERT =
  'Der Editor-Zugang ist auf dieser Instanz nicht konfiguriert.'

export const EDITOR_SCHWEIGT =
  'Der Editor hat das Token nicht bestätigt. Bitte im Editor neu öffnen.'

/**
 * Scheme, host and port of an address, or null.
 *
 * Used on both sides of the audience comparison, so a trailing slash or a path
 * cannot make two identical hosts look different. It is normalisation, never
 * laxness: two different hosts can never normalise to the same origin.
 */
export function herkunftVon(wert: unknown): string | null {
  if (typeof wert !== 'string' || wert.trim() === '') return null
  try {
    const url = new URL(wert.trim())
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.origin
  } catch {
    return null
  }
}

export type TokenGrund = 'unlesbar' | 'abgelaufen' | 'fremde_audience'

export type TokenBefund =
  | { ok: true; audience: string }
  | { ok: false; grund: TokenGrund }

interface TokenInhalt {
  aud?: unknown
  exp?: unknown
}

/** The payload of a JWT, WITHOUT verifying anything. The editor verifies. */
function inhaltVon(token: string): TokenInhalt | null {
  const teile = token.split('.')
  if (teile.length !== 3) return null
  const roh = teile[1]
  if (roh === undefined || roh === '') return null

  try {
    const text = Buffer.from(roh, 'base64url').toString('utf8')
    const inhalt: unknown = JSON.parse(text)
    if (inhalt === null || typeof inhalt !== 'object') return null
    return inhalt as TokenInhalt
  } catch {
    return null
  }
}

/**
 * Judges the token before anybody is asked about it.
 *
 * Expiry is read locally although the editor would also refuse it: a token that
 * died an hour ago is not worth a round trip, and the person gets the honest
 * reason instead of "der Editor hat nicht geantwortet".
 */
export function pruefeToken(
  token: unknown,
  eigeneHerkunft: string,
  jetzt: Date
): TokenBefund {
  if (typeof token !== 'string' || token.trim() === '') {
    return { ok: false, grund: 'unlesbar' }
  }

  const inhalt = inhaltVon(token.trim())
  if (inhalt === null) return { ok: false, grund: 'unlesbar' }

  if (typeof inhalt.exp === 'number' && inhalt.exp * 1000 <= jetzt.getTime()) {
    return { ok: false, grund: 'abgelaufen' }
  }

  const roh = Array.isArray(inhalt.aud) ? inhalt.aud[0] : inhalt.aud
  const audience = herkunftVon(roh)
  const eigen = herkunftVon(eigeneHerkunft)

  if (audience === null || eigen === null || audience !== eigen) {
    return { ok: false, grund: 'fremde_audience' }
  }

  return { ok: true, audience }
}

export function befundMeldung(grund: TokenGrund): string {
  switch (grund) {
    case 'abgelaufen':
      return 'Das Editor-Token ist abgelaufen. Bitte die Redaktion im Editor neu öffnen.'
    case 'fremde_audience':
      return 'Das Editor-Token gehört zu einer anderen Anwendung.'
    default:
      return 'Das Editor-Token ist nicht lesbar.'
  }
}

export interface EditorNutzer {
  id: string
  email: string
  berechtigungen: string[]
}

function textListe(wert: unknown): string[] {
  if (!Array.isArray(wert)) return []
  return wert.filter(
    (eintrag): eintrag is string => typeof eintrag === 'string'
  )
}

/**
 * The editor's `userinfo` answer, reduced to what this door needs.
 *
 * The e-mail is the ONLY key between the two houses — the editor's user id
 * means nothing in Directus — so an answer without one is unusable and says so
 * rather than half-working. Lower-cased because Directus matches e-mails
 * case-insensitively and a newsroom should not depend on how somebody typed it.
 */
export function parseUserinfo(roh: unknown): EditorNutzer | null {
  if (roh === null || typeof roh !== 'object') return null

  const antwort = roh as {
    id?: unknown
    email?: unknown
    roles?: unknown
  }

  if (typeof antwort.email !== 'string' || antwort.email.trim() === '') {
    return null
  }

  const berechtigungen = new Set<string>()
  for (const rolle of Array.isArray(antwort.roles) ? antwort.roles : []) {
    if (rolle === null || typeof rolle !== 'object') continue
    for (const recht of textListe(
      (rolle as { permissionIDs?: unknown }).permissionIDs
    )) {
      berechtigungen.add(recht)
    }
  }

  return {
    id: typeof antwort.id === 'string' ? antwort.id : '',
    email: antwort.email.trim().toLowerCase(),
    berechtigungen: [...berechtigungen].sort()
  }
}

export type Zugang = 'redaktion' | 'lesen' | 'kein_zugang'

/**
 * What this editor account is, as far as the newsroom is concerned.
 *
 * Note what this does NOT do: it assigns no Directus role. The Directus user
 * already has one, put there by hand, and this decides only whether the door
 * opens at all. Today the newsroom has exactly two Directus roles —
 * Administrator and Dorfkoenig (a read-only token role, no app access,
 * `schema/collections/roles.json`) — so there is nowhere for a `lesen` verdict
 * to land. It is still answered separately rather than folded into
 * `kein_zugang`, because the refusal a reader gets is a different sentence and
 * the day a reader role exists this is the one place that changes.
 */
export function rolleFuer(
  nutzer: Pick<EditorNutzer, 'berechtigungen'>
): Zugang {
  if (nutzer.berechtigungen.includes(RECHT_PUBLIZIEREN)) return 'redaktion'
  if (nutzer.berechtigungen.includes(RECHT_LESEN)) return 'lesen'
  return 'kein_zugang'
}
