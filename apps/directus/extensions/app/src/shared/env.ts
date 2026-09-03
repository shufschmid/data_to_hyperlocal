// Environment access with loud failures.
//
// Extensions run inside the Directus process, so they see the same environment
// as Directus itself: everything in apps/directus/.env locally, and everything
// passed to the `directus` service in docker-compose.yml in production.
//
// Never read secrets anywhere else in the codebase — go through here so a
// missing variable fails with a message that names the variable.

export function requireEnv(
  name: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const value = env[name]
  if (value === undefined || value.trim() === '') {
    throw new Error(
      `Environment variable ${name} is not set. Add it to apps/directus/.env for local ` +
        `development and to the directus service in docker-compose.yml for deployments.`
    )
  }
  return value
}

export function optionalEnv(
  name: string,
  fallback: string,
  env: NodeJS.ProcessEnv = process.env
): string {
  const value = env[name]
  return value === undefined || value.trim() === '' ? fallback : value
}

export function envFlag(
  name: string,
  fallback = false,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  const value = env[name]
  if (value === undefined || value.trim() === '') return fallback
  // `ja` belongs here because the switches are documented in German — and a
  // switch that reads as "off" when someone writes the obvious German word for
  // "on" fails silently, which is the worst way for a switch to fail.
  return ['1', 'true', 'yes', 'on', 'ja'].includes(value.trim().toLowerCase())
}
