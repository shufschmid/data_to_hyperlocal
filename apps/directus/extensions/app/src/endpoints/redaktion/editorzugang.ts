import { randomBytes } from 'node:crypto'
import { optionalEnv } from '../../shared/env'
import {
  befundMeldung,
  EDITOR_SCHWEIGT,
  KEIN_KONTO,
  KEIN_ZUGANG,
  NICHT_KONFIGURIERT,
  NUR_LESEN,
  parseUserinfo,
  pruefeToken,
  rolleFuer
} from '../../redaktion/editorzugang'

// `POST /redaktion/editor-zugang` — the door from the We.Publish editor.
//
// DELIBERATELY PUBLIC, like `/freigabe`: the person on the other end is not
// signed in yet, that is the whole point. What stands in for a login is the
// editor's own short-lived token, and the three gates below — the audience must
// be this instance, the editor must confirm the token, and the e-mail must
// already exist as an active Directus user. No account is ever created here:
// who may work in the newsroom is a rights decision, and it is taken by a
// person in the admin UI.
//
// Off without `EDITOR_API_URL` or `EDITOR_HERKUNFT`, and it says so (503) —
// the `CRAWLER_KEY` bargain.

export interface Sitzungspaar {
  accessToken: string
  refreshToken: string
  /** Lifetime of the access token in milliseconds, as Directus reports it. */
  expires: number
}

export interface DirectusBenutzer {
  id: string
  status: string
}

export interface EditorzugangDeps {
  /** `EDITOR_API_URL`; empty means the door is shut. */
  editorApiUrl(): string
  /** `EDITOR_HERKUNFT` — the origin this instance is registered under. */
  eigeneHerkunft(): string
  /** `GET {basis}/external-apps/userinfo` with the token; null on any failure. */
  holeUserinfo(basis: string, token: string): Promise<unknown>
  findeBenutzer(email: string): Promise<DirectusBenutzer | null>
  stelleSitzungAus(benutzerId: string): Promise<Sitzungspaar>
  jetzt(): Date
}

export interface Antwort {
  status: number
  koerper: unknown
}

function fehler(status: number, meldung: string): Antwort {
  return { status, koerper: { errors: [{ message: meldung }] } }
}

/**
 * The whole decision, with every outside thing injected — so each branch is a
 * unit test instead of a deployment.
 */
export async function editorZugang(
  koerper: unknown,
  deps: EditorzugangDeps
): Promise<Antwort> {
  const basis = deps.editorApiUrl().trim()
  const eigen = deps.eigeneHerkunft().trim()
  if (basis === '' || eigen === '') return fehler(503, NICHT_KONFIGURIERT)

  const token =
    koerper !== null && typeof koerper === 'object'
      ? (koerper as { token?: unknown }).token
      : undefined

  const befund = pruefeToken(token, eigen, deps.jetzt())
  if (!befund.ok) return fehler(401, befundMeldung(befund.grund))

  // Only now is the editor asked — an unreadable, expired or foreign token
  // never costs a request.
  const roh = await deps.holeUserinfo(basis, String(token))
  const nutzer = parseUserinfo(roh)
  if (nutzer === null) return fehler(401, EDITOR_SCHWEIGT)

  const zugang = rolleFuer(nutzer)
  if (zugang === 'lesen') return fehler(403, NUR_LESEN)
  if (zugang === 'kein_zugang') return fehler(403, KEIN_ZUGANG)

  const benutzer = await deps.findeBenutzer(nutzer.email)
  // A suspended or invited account is told the same thing as a missing one:
  // both mean "a person has to act in the admin UI", and telling them apart
  // would let a caller probe which e-mails exist here.
  if (benutzer === null || benutzer.status !== 'active') {
    return fehler(403, KEIN_KONTO)
  }

  const paar = await deps.stelleSitzungAus(benutzer.id)
  return {
    status: 200,
    koerper: {
      data: {
        access_token: paar.accessToken,
        refresh_token: paar.refreshToken,
        expires: paar.expires
      }
    }
  }
}

// --- the wiring ------------------------------------------------------------

/** Six seconds: the editor answers in milliseconds or it is not answering. */
const USERINFO_ZEITGRENZE_MS = 6000

interface AuthLike {
  refresh(token: string): Promise<Sitzungspaar>
}

interface Zeilenbauer {
  insert(zeile: Record<string, unknown>): Promise<unknown>
  select(...spalten: string[]): Zeilenbauer
  whereRaw(sql: string, bindungen: unknown[]): Zeilenbauer
  first(): Promise<Record<string, unknown> | undefined>
}

export interface EditorzugangUmgebung {
  database: (tabelle: string) => Zeilenbauer
  services: {
    AuthenticationService: new (optionen: {
      schema: unknown
      accountability?: unknown
    }) => AuthLike
  }
  getSchema(): Promise<unknown>
  logger: { error(fehler: unknown, nachricht: string): void }
}

export interface RouterLike {
  post(
    pfad: string,
    handler: (
      req: {
        body?: unknown
        ip?: string
        get?(feld: string): string | undefined
      },
      res: { status(code: number): { json(koerper: unknown): unknown } }
    ) => Promise<void>
  ): unknown
}

/**
 * Where the Directus session actually comes from.
 *
 * `AuthenticationService.login` cannot be used: for the local provider it ends
 * in `LocalAuthDriver.login`, which verifies a password we do not have and
 * never will (read in `@directus/api/dist/auth/drivers/local.js` on
 * 17 September 2026). Signing a JWT by hand instead would mean re-implementing
 * Directus' role tree, its global-access computation and its secret handling —
 * three things that change between minor versions.
 *
 * So the door writes ONE row into `directus_sessions`, exactly the row `login`
 * writes, and then calls `AuthenticationService.refresh` on it. Everything that
 * matters — the permission tree, the claims, the signature, the rotation and
 * the expiry — is then Directus' own code. The seed row is short-lived, so a
 * failure between the two leaves something that expires by itself; `refresh`
 * replaces its token immediately.
 */
async function sitzungFuer(
  umgebung: EditorzugangUmgebung,
  benutzerId: string,
  herkunft: string
): Promise<Sitzungspaar> {
  // 64 characters, like Directus' own `nanoid(64)`, from the same CSPRNG.
  const saat = randomBytes(48).toString('base64url')

  await umgebung.database('directus_sessions').insert({
    token: saat,
    user: benutzerId,
    expires: new Date(Date.now() + 60_000),
    origin: herkunft
  })

  const auth = new umgebung.services.AuthenticationService({
    schema: await umgebung.getSchema()
  })
  return auth.refresh(saat)
}

async function holeUserinfo(basis: string, token: string): Promise<unknown> {
  const antwort = await fetch(
    `${basis.replace(/\/+$/, '')}/external-apps/userinfo`,
    {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(USERINFO_ZEITGRENZE_MS)
    }
  )
  if (!antwort.ok) return null
  return antwort.json()
}

/** One line in `index.ts`; everything above is testable without Express. */
export function verdrahteEditorzugang(
  router: RouterLike,
  umgebung: EditorzugangUmgebung
): void {
  router.post('/editor-zugang', async (req, res) => {
    const deps: EditorzugangDeps = {
      // Read per request: switching the door on or off is an environment
      // change and a restart, never a code change.
      editorApiUrl: () => optionalEnv('EDITOR_API_URL', ''),
      eigeneHerkunft: () => optionalEnv('EDITOR_HERKUNFT', ''),
      holeUserinfo: (basis, token) =>
        holeUserinfo(basis, token).catch((problem: unknown) => {
          umgebung.logger.error(problem, 'redaktion: userinfo nicht erreichbar')
          return null
        }),
      async findeBenutzer(email) {
        const zeile = await umgebung
          .database('directus_users')
          .select('id', 'status')
          .whereRaw('LOWER(??) = ?', ['email', email])
          .first()
        if (zeile === undefined) return null
        return { id: String(zeile['id']), status: String(zeile['status']) }
      },
      stelleSitzungAus: (benutzerId) =>
        sitzungFuer(umgebung, benutzerId, optionalEnv('EDITOR_HERKUNFT', '')),
      jetzt: () => new Date()
    }

    try {
      const antwort = await editorZugang(req.body, deps)
      res.status(antwort.status).json(antwort.koerper)
    } catch (problem) {
      umgebung.logger.error(problem, 'redaktion: Editor-Zugang fehlgeschlagen')
      res.status(500).json({
        errors: [{ message: 'Der Editor-Zugang hat nicht funktioniert.' }]
      })
    }
  })
}
