// Pure rules for the session proxy.
//
// Deliberately without `import 'server-only'`: the decision below is the part
// worth testing, and keeping it here lets it be unit-tested like every other
// helper in this folder instead of behind mocks for `next/headers`.

/**
 * Whether an answer from Directus means „dein Token taugt nichts" — as opposed
 * to „das darfst du nicht" or „das gibt es nicht".
 *
 * Measured against Directus 11: a missing, malformed or *expired* token is
 * answered with 401, but a token it cannot VERIFY is 403 `INVALID_TOKEN`. That
 * second case is what a browser carries after the backend's `SECRET` changed —
 * or while two backends with different secrets answer in turn — and it used to
 * be passed to the browser untouched, so the workspace sat behind an error it
 * could never clear.
 *
 * The narrowness matters as much as the breadth: the extension answers 403 with
 * the code `FORBIDDEN` for „nicht gefunden oder nicht freigegeben"
 * (`endpoints/redaktion`), and reading that as a dead session would throw an
 * editor out of the application over a single invisible record.
 */
export function istTokenProblem(status: number, koerper: string): boolean {
  if (status === 401) return true
  if (status !== 403) return false
  return /"code"\s*:\s*"(?:INVALID_TOKEN|TOKEN_EXPIRED)"/.test(koerper)
}
