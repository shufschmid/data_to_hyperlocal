# Application Template — Directus · Next · MUI · Claude

A starting point for **standalone AI applications**. Clone it, delete the example
feature, build yours. Everything runs in Docker on an ordinary server — no GPU, no
model weights, no extra infrastructure.

| Path                             | App                                       | Stack                                | Port |
| -------------------------------- | ----------------------------------------- | ------------------------------------ | ---- |
| [apps/directus/](apps/directus/) | Backend: data + **all** server-side logic | Directus 11, TypeScript, Postgres 16 | 8055 |
| [apps/front/](apps/front/)       | Frontend: UI                              | Next 16, React 19, MUI 9, Apollo 4   | 3000 |

The two apps are built and deployed independently. This is a monorepo, **not** an npm
workspace: each app has its own `package.json`, lockfile and build. The root carries
the shared pre-commit tooling, CI and the compose file that runs the whole stack.

> **The rules this template exists to enforce** — full version in [CLAUDE.md](CLAUDE.md):
>
> 1. Runs without a GPU. 2. Every LLM call goes to the **Claude API**. 3. Runs with
>    Docker. 4. Self-contained: Postgres + Directus + frontend, nothing else. 5. No
>    persistent file storage outside Directus. 6. TypeScript only. 7. All server-side
>    code is a **Directus extension**. 8. All scheduled work is a **Directus Flow**
>    with a cron trigger.

---

## 1 · What you need

| Tool               | Why                              | Install                                        |
| ------------------ | -------------------------------- | ---------------------------------------------- |
| **Docker**         | Runs the whole application       | https://www.docker.com/products/docker-desktop |
| **Node.js 22**     | Local development without Docker | https://nodejs.org or `nvm install 22`         |
| **Claude API key** | Every AI feature                 | https://console.anthropic.com                  |

---

## 2 · Run it

```bash
cp .env.example .env      # then put your ANTHROPIC_API_KEY in .env
docker compose up --build
```

First boot takes a few minutes: it builds both images, creates the database, applies
the versioned schema from `apps/directus/schema/`, seeds the reference data and
creates the admin user.

- **Frontend:** http://localhost:3000 — sign in with the admin below
- **Directus admin:** http://localhost:8055 — `admin@wepublish.ch` / `admin123`

Stop with `docker compose down`; add `-v` to also delete the database.

### What you get

The application is **«Die Redaktion»**: public data in, local journalism out.

- **Watching** — a daily Flow asks data.bl.ch what changed and the statistics
  office's agenda what is coming. A dataset with figures per municipality becomes
  a candidate.
- **Writing** — one Claude call settles the angle for the whole run, then one
  cheap call per municipality writes the article. The shared half of the prompt
  is byte-identical across them, so the cache carries it.
- **Checking** — every draft is tested for relative time references and for
  percentages the model worked out for itself. Failures go back once with the
  offending words named, then land as a flagged draft. Never published silently.
- **Reviewing** — the editor revises by chat, singly or across a whole run. An
  instruction that reads like a lasting preference is remembered and applies next
  year too.
- **Approving** — an article can go out on a one-time link. Opening that link
  records nothing; only a button does. A message in counter-check cannot reach
  publication without an unambiguous yes.
- **Publishing** — `status = publiziert`, which the Dorfkönig reads by
  municipality.

---

## 3 · Local development

Docker is what deploys; for day-to-day work run the apps directly for fast reloads.

```bash
npm install                        # root: pre-commit tooling only

cd apps/directus
npm run setup                      # .env from example, install, build the extension bundle
npm run db:start                   # Postgres in Docker
npm run directus:init              # ONE TIME on a fresh database
```

Then three terminals:

```bash
cd apps/directus/extensions/app && npm run dev   # 1. rebuild the extension on change
cd apps/directus && npm run dev                  # 2. Directus
cd apps/front && npm install && npm run dev      # 3. Next
```

Start the extension watcher **first** and wait for its first successful build —
Directus will not start without a built bundle, and without the watcher your changes
are never picked up.

Put your `ANTHROPIC_API_KEY` in `apps/directus/.env`, and
`cp .env.local.example .env.local` in `apps/front`.

---

## 4 · Everyday commands

```bash
npm test                 # both apps' tests (from the root)
npm run typecheck        # both apps
npm run lint             # prettier --write across the tree

cd apps/directus
npm run schema:dump      # after ANY model change in the admin UI — then commit schema/
npm run schema:diff      # what a push would change
npm run build            # compile the extension bundle (and any migrations)
npm run db:reset         # DESTRUCTIVE: drops the dev database
```

The single most important habit: **after changing the data model in the Directus admin
UI, run `npm run schema:dump` and commit `apps/directus/schema/`.** Otherwise the
change exists only on your machine. The model always travels this way — never in a
migration.

---

## 5 · Repository layout

```
.
├── README.md               ← this file
├── CLAUDE.md               ← the rules and recipes agents follow
├── docker-compose.yml      ← the whole application, self-contained
├── .env.example            ← configuration for the Docker stack
├── .github/workflows/      ← verify (typecheck/test/build) + image publishing
└── apps/
    ├── directus/           ← backend  (extensions/app = all server-side logic)
    └── front/              ← frontend (Next + MUI)
```

Deeper guidance: [CLAUDE.md](CLAUDE.md),
[apps/directus/CLAUDE.md](apps/directus/CLAUDE.md),
[apps/front/CLAUDE.md](apps/front/CLAUDE.md).

---

## 6 · Deployment

Images are published to GHCR, named after the repository
(`ghcr.io/<owner>/<repo>-backend`, `…-front`): a push to `main` rebuilds the app that
changed, a `v*` tag builds both production images in lockstep.

On a server, run the same `docker-compose.yml` with real values in `.env` — generate
`KEY` and `SECRET` with `openssl rand -hex 32`, set `DB_PASSWORD` and
`ADMIN_PASSWORD`, point `DIRECTUS_PUBLIC_URL` and `FRONT_PUBLIC_URL` at the real
hostnames, and put a reverse proxy in front for TLS.

State lives in two named volumes: `db_data` (Postgres) and `directus_uploads`
(Directus Files). Back those up — nothing else on the host holds application state.

---

## 7 · Troubleshooting

| Symptom                                          | Cause / fix                                                                                               |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| `KEY variable is not set`                        | You skipped `cp .env.example .env`.                                                                       |
| Port 3000 / 8055 / 5432 already in use           | Change `FRONT_PORT` / `DIRECTUS_PORT` in `.env`, or stop the other process.                               |
| Directus starts but a custom route 404s          | The extension bundle was not built: `cd apps/directus && npm run build:extensions`.                       |
| AI feature returns "konnte nicht erzeugt werden" | `ANTHROPIC_API_KEY` missing or invalid — it belongs in the **backend** environment.                       |
| Frontend keeps showing the login form            | Cookies blocked, or `DIRECTUS_URL` unreachable from the Next process (in Docker: `http://directus:8055`). |
| A colleague's collection is missing locally      | `cd apps/directus && npm run schema:load`.                                                                |
| `Cannot connect to the Docker daemon`            | Docker isn't running.                                                                                     |
