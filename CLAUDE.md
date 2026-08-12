# «Die Redaktion» — Monorepo Entry Point

Turns public data into local journalism. Sources are watched for new datasets;
when one arrives with figures per municipality, one article is drafted for each
municipality the newsroom covers. An editor reviews them, revises them by chat,
optionally sends them out to be counter-checked, and publishes. Published
articles are read by a separate downstream system, the **Dorfkönig**.

Built from the standalone-AI-application template; the example feature it shipped
with has been removed.

**What makes this project different from a summariser:**

- Articles must still be correct in five years, so relative time references are
  checked, not merely discouraged — see `redaktion/zeitbezug.ts`.
- Every figure is checked against the data it came from. A percentage the model
  worked out for itself is flagged — `redaktion/zahlen.ts`.
- It has a **memory**. When the same statistic reappears next year, last year's
  articles and the rules learned from the editor's chat feed into the new run.

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
   Redis, no queue broker, no external cron host, no side-car. Outbound dependencies
   are enumerated below and adding one is a deliberate decision, not a commit.

   | Host                | Why                                                        | Adapter            |
   | ------------------- | ---------------------------------------------------------- | ------------------ |
   | `api.anthropic.com` | every LLM call                                             | `shared/claude.ts` |
   | `data.bl.ch`        | open-data catalogue and records (no auth, documented API)  | `shared/ods/`      |
   | `www.baselland.ch`  | the publication agenda — announcements the API cannot give | `shared/agenda/`   |
   | `statistik.bl.ch`   | tables the open-data portal does not carry                 | `shared/statbl/`   |

   The portal is also _watched_, but only where it has to be. An inventory walks
   it once (`operations/portal-inventur`) and asks three questions per page: is
   this a municipality table, is it in the open-data portal, is it in the agenda?
   Only what answers yes-no-no is polled daily — everything else already reaches
   us through those two channels. The measured result: 88 branches exist, a
   handful need watching.

   `statistik.bl.ch` is the answer to a real gap, not a convenience: the
   open-data portal has no agriculture dataset at all, while that host publishes
   "Landwirtschaftsbetriebe nach Gemeinde" back to 2013 at a stable URL with a
   `?year=` parameter. There is no machine-readable form — `.csv`, `.xlsx`,
   `.json` all 404 — so `shared/statbl/` parses the HTML, which is Excel's
   "publish as web page" output and therefore regular. Nothing on this host is
   crawled or discovered: only a table whose URL an editor pasted is ever
   fetched, and afterwards only that same table, once a day, to see whether a
   new year has appeared.

   The agenda host sits behind a Cloudflare Managed Challenge. The connector
   identifies itself honestly, makes a handful of spaced attempts per scheduled
   run, and if all of them are turned away it says so on the source so a person
   can enter the entry by hand.

   The workspace has four tabs: **Läufe · Datenquellen · Gelerntes · Gemeinden**.
   „Datenquellen" is one chronological list fed by all three watchers — the
   agenda, the watched portal branches, and changes in the data.bl.ch catalogue.
   The third feed is the one that is easy to forget and carries the most: only 9
   of 188 datasets have an agenda entry, so without it most articles would have
   no visible origin at all. Announced entries without a date hang below the
   list, grouped by quarter, and move up by themselves once they get one.

   When it turns us away, that is not silence: the workspace shows a banner
   naming the source, the reason and the date of the last attempt, with a link
   to the page and a form to type the entry in by hand
   (`POST /redaktion/ankuendigungen`, which updates an existing announcement
   rather than adding a second one). An absence is otherwise
   indistinguishable from "nothing was published".

   **Do not try to make it pass.** Cloudflare fingerprints the TLS handshake, not
   just the User-Agent — measured on this host, `curl` gets through where Node's
   `undici` is refused with the identical header. The fixes for that are faking a
   browser fingerprint or shelling out to another client, and both are
   circumvention rather than politeness. If we cannot get in as ourselves, we do
   not get in; the open-data API carries the pipeline either way.

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

| The change is…                                | Goes to                                                                                                   |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| a new collection or field                     | Directus admin UI, then `npm run schema:dump` — [apps/directus](apps/directus/)                           |
| a calculation, validation or business rule    | extension bundle (endpoint or hook)                                                                       |
| anything that calls Claude                    | extension bundle, via `shared/claude.ts`                                                                  |
| something that must run nightly/hourly        | Flow with a Schedule trigger + a custom operation in the bundle                                           |
| a screen, a form, a list, a chart             | [apps/front](apps/front/) — MUI components, Apollo for data                                               |
| a new query the UI needs                      | `apps/front/src/graphql/*.ts`                                                                             |
| a new rule about what an article may say      | the prompt in `redaktion/prompt.ts` **and** a check next to it — a prompt is a request, a check is a rule |
| a table on statistik.bl.ch the newsroom wants | paste its URL in the workspace — „Datenquellen" → „Auftrag …" — it becomes an ordinary dataset            |
| a one-off data repair or backfill             | `apps/directus/migrations/*.mts`                                                                          |
| an agenda entry the crawler could not fetch   | the banner in the workspace → „Eintrag von Hand erfassen"                                                 |
| a new environment variable                    | `apps/directus/.env.example` **and** root `.env.example` **and** docker-compose.yml                       |

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

## How the pipeline hangs together

```
Flow "Portal inventarisieren"  (0 */2 * * *)
  └─ operations/portal-inventur   walks statistik.bl.ch once, page by page
       ├─ Gemeindetabelle?  → against our own 86 names, no model
       ├─ in data.bl.ch?    ┐ 1× Sonnet, both catalogues in the cached prefix
       └─ in der Agenda?    ┘ yes to either → never polled

Flow "Quellen taeglich pruefen"  (0 6 * * *)
  └─ operations/quellen-pruefen
       ├─ portal_bereiche → "Letzte Änderung" of the watched branches only
       ├─ shared/statbl/  → registered tables: is there a new year?
       │                    if so the dataset reopens and the run inherits
       │                    datensaetze.standard_vorgabe — the memory
       ├─ shared/ods/     → data.bl.ch catalogue: what changed?
       ├─ shared/agenda/  → the office's agenda: what is coming?
       │                    writes datensaetze + ankuendigungen
       └─ agenda/zuordnung  1× Sonnet per published agenda entry:
                            which portal dataset is this? (catalogue cached)

editor marks a dataset relevant  ─────────────┐
  or, from the agenda: picks the dataset       │
  and types an Auftrag for the run  ───────────┤
                                              ▼
Flow "Meldungen erzeugen"  (*/2)   endpoints/redaktion  (immediately)
  └─ operations/redaktion-abarbeiten      └─ same drain(), single-flight
       └─ redaktion/drain.ts
            ├─ eroeffneLaeufe   one run per dataset+period
            ├─ stage A          1× Opus  → briefing for the whole run
            │                    laeufe.vorgabe steers it; earlier periods are
            │                    fetched only when a vorgabe asks for them
            └─ stage B          N× Sonnet → one article per municipality
                                 cached system prompt, checked afterwards

hooks/meldung-status   guards every status change, on every write path
```

**Four things a change here must not break:**

1. **`buildArtikelSystemPrompt` is byte-identical across a run.** It is what the
   prompt cache carries. Interpolating anything municipality-specific into it is
   invisible in the output and shows up only on the invoice. There is a test.
   `laeufe.vorgabe` belongs in it — it is per run — the municipality's own
   history does not, and goes into the user turn.
2. **Figures are computed per group of like rows, never across.** Dataset 12060
   holds tonnes and kilograms-per-inhabitant in one column; averaging them
   produced a number that went into a draft article as fact. See `kontext.ts`.
3. **A portal page shows its own table only if the navigation says so.** `1_4`
   renders the table of `1_4_5_1` as a preview. Read as data, one statistic was
   registered under four paths and the coverage question was paid for four
   times. `istEigeneSeite` is what tells them apart.
4. **The state machine lives in a hook, not in the endpoints.** An administrator
   can edit a message directly in the admin UI, so a rule checked only where we
   call it is not a rule.

## Where the memory lives

- `laeufe` + `meldungen` of earlier periods — what was published about this
  dataset before, fed back into the briefing and into each municipality's article.
- `datensaetze.standard_vorgabe` — the instruction that made a table worth
  writing about, kept with the dataset. When next year's edition appears, the
  run that opens by itself starts from the same brief instead of a blank one.
- `datensaetze.gemeindefeld` — the municipality column, when an editor names it
  because the portal's metadata does not. Automatic detection stays in charge
  everywhere else; this only fills the gap it leaves.
- `ankuendigungen.datensatz` — which portal dataset an agenda entry means. The
  agenda says "Abfallstatistik 2025", the portal says "Abfallmengen nach
  Kategorie, Gemeinde und Jahr (seit 2017)"; a model bridges that once and
  `zuordnung_geprueft` stops it from being asked again. That link is what turns
  an agenda row into a "Meldungen erzeugen" button.
- `redaktionswissen` — durable rules distilled from the editor's chat by a small
  classification call. Scoped to a dataset, a source or globally, and visible in
  the workspace so a wrong one can be switched off.

Both are bounded on purpose: the rules feed the cached prompt prefix, and an
unbounded memory would grow it without limit.

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
