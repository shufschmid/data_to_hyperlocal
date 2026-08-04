# Application Template — Monorepo Entry Point

This repository is a **template** for standalone AI applications. A new project
starts by copying it and deleting the example feature (see
[Starting a new project](#starting-a-new-project)).

It is a **monorepo** — both apps live side by side under `apps/`. It is **not** an
npm workspace: each app is installed, built and deployed independently and has its
own lockfile. The root carries the shared pre-commit tooling, CI, and the
docker-compose file that runs the whole stack.

## The stack — fixed, not a suggestion

| Path                             | Purpose                                                        | Stack                                 | Port |
| -------------------------------- | -------------------------------------------------------------- | ------------------------------------- | ---- |
| [apps/directus/](apps/directus/) | Backend: data model, **all** server-side logic, scheduled work | Directus 11, TypeScript, Postgres 16  | 8055 |
| [apps/front/](apps/front/)       | Frontend: UI only                                              | Next 16 (App Router), React 19, MUI 9 | 3000 |

Data flows one way through one door:

```
   browser
      │  same-origin /api/* only (httpOnly session cookies, no tokens in JS)
      ▼
┌─────────────────────┐   Apollo Client → /api/graphql → Directus GraphQL
│     apps/front      │   fetch        → /api/…        → extension endpoint
│  Next 16 · MUI 9    │
└──────────┬──────────┘
           │ server-side only, with the user's access token
           ▼
┌─────────────────────┐
│    apps/directus    │  Directus 11 + one extension bundle
│  data + all logic   │──► Claude API (https, CPU only)
└──────────┬──────────┘
           ▼
      Postgres 16
```

## Hard constraints

These are requirements of the platform, not preferences. A change that breaks one of
them is wrong even if it works.

1. **Runs on a machine without a GPU.** No local inference, no CUDA, no model
   weights, no vector database that needs a GPU. If a feature seems to need a local
   model, it needs the Claude API instead.
2. **Claude API for every LLM call.** One client:
   `apps/directus/extensions/app/src/shared/claude.ts`. Never add a second provider,
   a second SDK, or a direct `fetch` to an inference endpoint.
3. **Runs with Docker.** `cp .env.example .env && docker compose up --build` starts
   the entire application. Anything a feature needs at runtime is a service or an
   environment variable in [docker-compose.yml](docker-compose.yml).
4. **Self-contained.** Postgres, Directus and the frontend are the only services. No
   Redis, no queue broker, no external cron host, no side-car. The Claude API is the
   single outbound dependency; a new one needs a deliberate decision, not a commit.
5. **No persistent file storage outside Directus.** Application code never writes to
   the filesystem — no temp caches, no JSON state files, no log files, no
   `./data`. State goes into a Directus collection; binaries go through Directus
   Files (one named volume). Containers are disposable: anything written outside a
   volume is gone on the next deploy.
6. **TypeScript only.** All logic — backend, frontend, migrations, scripts. No
   Python, no shell scripts carrying business rules. `apps/directus/docker/entrypoint.sh`
   is the one exception and it only orchestrates commands.
7. **Server-side code lives in the Directus extension bundle.**
   `apps/directus/extensions/app` — endpoints, hooks and Flow operations.
   [Extension docs](https://directus.com/docs/guides/extensions/overview). Next
   route handlers are proxies only: they forward a request and never contain a rule,
   a prompt or a calculation.
8. **Scheduled work is a Directus Flow with a Schedule (cron) trigger.**
   [Trigger docs](https://directus.com/docs/guides/flows/triggers). No system cron,
   no `setInterval` in a hook, no scheduler container. The Flow calls a custom
   operation from the bundle; the Flow itself is committed via `schema:dump`.

## Where does this feature go?

| The change is…                             | Goes to                                                                             |
| ------------------------------------------ | ----------------------------------------------------------------------------------- |
| a new collection or field                  | Directus admin UI, then `npm run schema:dump` — [apps/directus](apps/directus/)     |
| a calculation, validation or business rule | extension bundle (endpoint or hook)                                                 |
| anything that calls Claude                 | extension bundle, via `shared/claude.ts`                                            |
| something that must run nightly/hourly     | Flow with a Schedule trigger + a custom operation in the bundle                     |
| a screen, a form, a list, a chart          | [apps/front](apps/front/) — MUI components, Apollo for data                         |
| a new query the UI needs                   | `apps/front/src/graphql/*.ts`                                                       |
| a one-off data repair or backfill          | `apps/directus/migrations/*.mts`                                                    |
| a new environment variable                 | `apps/directus/.env.example` **and** root `.env.example` **and** docker-compose.yml |

A change that spans both apps starts in `apps/directus` — data model first, then the
GraphQL documents in the frontend.

## Cross-cutting conventions

- **Formatter**: Prettier — no semicolons, single quotes, no trailing commas, 2-space
  indent, 110 columns. Enforced by a **root** Husky + lint-staged pre-commit hook
  across the whole tree.
- **No ESLint.** Prettier plus `tsc --noEmit` (`npm run typecheck`) is the gate.
- **TypeScript strict mode** everywhere, plus `noUncheckedIndexedAccess`.
- **UI labels in German, code and comments in English.** Error messages that reach a
  browser are UI labels — German.
- **Node 22.x**, package manager `npm`, in both apps.
- **Tests by default for new logic.** Vitest in the extension bundle, Jest +
  Testing Library in the frontend. Both are wired and run in CI. Skip only with a
  concrete reason (thin glue, framework plumbing, purely cosmetic). Put the rule in
  a pure function next to the wiring and test that — the pattern is everywhere in
  the example feature.
- **Secrets live in the backend.** The frontend holds no API key and no service
  token; it acts as the signed-in user. See [apps/front/CLAUDE.md](apps/front/CLAUDE.md).
- **Keep the CLAUDE.md files current.** After landing a change, update this file
  and/or the app's when the change affects something a future agent would rely on —
  new endpoint, collection, command, env var, pattern, or a fact that is now wrong.
  Skip it for routine fixes, refactors that don't change shape, dependency bumps and
  copy tweaks. When in doubt: would the next agent be misled by the current text?

## Running it

**Everything in Docker** (what deploys, one command):

```bash
cp .env.example .env         # then put your ANTHROPIC_API_KEY in it
docker compose up --build    # or: npm run up
```

**Local development** (fast feedback, three terminals):

```bash
cd apps/directus/extensions/app && npm run dev   # 1. watch-rebuild the bundle — start first
cd apps/directus && npm run dev                  # 2. Postgres in Docker + Directus on the host
cd apps/front && npm run dev                     # 3. Next dev server
```

Start the extension watcher **before** Directus: Directus refuses to start without a
built bundle, and without the watcher your changes are never picked up.

- Frontend: http://localhost:3000
- Directus admin: http://localhost:8055 — `admin@wepublish.ch` / `admin123`

## Starting a new project from this template

The example feature is one collection (`notes`) plus everything that touches it. It
exists to show the patterns end to end. To make the repo yours:

1. Read this file and both app `CLAUDE.md` files.
2. Rename the images/description: root `package.json` (name, description). CI image
   names derive from the repo name automatically.
3. Delete the example, in this order:
   - `apps/front/src/components/Note*.tsx`, `apps/front/src/graphql/notes.ts`,
     `apps/front/src/lib/notes.ts` (+ tests), `apps/front/src/app/api/notes/`
   - `apps/directus/extensions/app/src/endpoints/notes-summary/`,
     `.../hooks/notes-normalize/`, `.../operations/notes-summarize-pending/`, and
     their entries in `apps/directus/extensions/app/package.json`
   - `apps/directus/migrations/20260729A-example-notes-collection.mts`
   - `notes` from `apps/directus/extensions/app/src/types/schema.ts`
4. Keep `shared/claude.ts`, `shared/env.ts`, `shared/http.ts`, the auth/session and
   proxy code in `apps/front/src/lib`, and `AppShell`/`LoginForm` — that is the
   scaffolding, not the example.
5. Build your first feature by copying the shape of what you deleted.

## Deployment

Images are published to GHCR, named after the repository:

- **Staging** — a push to `main` rebuilds only the app whose `apps/<app>/**` changed:
  `ghcr.io/<owner>/<repo>-backend:main`, `ghcr.io/<owner>/<repo>-front:main`.
- **Production** — a `v*` tag builds **both** images in lockstep:
  `…-backend:production` and `…-front:production`.

One reusable builder ([publish-docker-image.yml](.github/workflows/publish-docker-image.yml))
takes a build `context` and image `tags`; the per-app workflows call it with path
filters. [verify.yml](.github/workflows/verify.yml) typechecks, tests and builds both
apps on every push and PR. GitHub only reads workflows at the repo root, so both
apps' pipelines live in `.github/workflows/`.

On a server, deploy the same `docker-compose.yml` with real values in `.env`
(`KEY`, `SECRET`, `DB_PASSWORD`, `ADMIN_PASSWORD`, the public URLs) and a reverse
proxy in front for TLS.

## Things to know before editing

- **Not an npm workspace.** No hoisting, no shared `node_modules`. Always `cd` into
  `apps/directus` or `apps/front` first. The root `npm install` only installs the
  pre-commit tooling — never add app dependencies to the root `package.json`.
- The extension bundle is a **third** npm package with its own `node_modules`:
  `apps/directus/extensions/app`. Its `package-lock.json` is committed and
  `npm run build` installs it with `npm ci` — so a dependency change means running
  `npm install` inside the bundle and committing the lockfile, or the build fails.
- Directus is pinned to **11.x** on purpose. `directus-sync` (schema-as-code) has no
  Directus 12 release, and the bundled `ts-typegen` module declares
  `host: ">= 10.10.0 < 12.0.0"`. Check both before bumping the major.
- The pre-commit hook is installed at the git root (`.husky/`).
- Never commit any `.env`. The root `.env` configures Docker; `apps/directus/.env`
  and `apps/front/.env.local` configure local development.
