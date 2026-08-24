# Backend — Directus 11

The data model and **all** server-side logic of this application. There is no
separate API service: logic ships as a Directus extension bundle
(`extensions/app`) that runs inside the Directus process.

Working instructions for agents and developers: [CLAUDE.md](CLAUDE.md).

## First run

```bash
npm run setup            # .env from .env.example, install, build the extension bundle
npm run db:start         # Postgres 16 in Docker
npm run directus:init    # bootstrap + apply schema + data migrations — fresh database only
npm run dev              # Postgres + Directus
```

http://localhost:8055 — `admin@wepublish.ch` / `admin123`

Put your `ANTHROPIC_API_KEY` in `.env`. For `schema:dump`/`schema:load` also set
`DIRECTUS_TOKEN` (admin UI → your user → Token → generate) or the
`DIRECTUS_ADMIN_EMAIL`/`DIRECTUS_ADMIN_PASSWORD` pair.

While developing, run the bundle in watch mode in a second terminal — Directus does
not start without a built bundle:

```bash
cd extensions/app && npm run dev
```

## Changing the data model

Version-controlled with [directus-sync](https://tractr.github.io/directus-sync/).

```bash
npm run schema:dump      # admin-UI changes → schema/   (then commit)
npm run schema:diff      # what a push would change
npm run schema:load      # schema/ → a running Directus
```

`schema/` is the single source of truth for the model: collections, fields,
relations, roles, permissions and Flows are built in the admin UI and committed
with `schema:dump` — never in a migration. Migrations (`migrations/*.mts`) exist
only for row data and for indexes Directus does not manage:

```bash
npm run database:migrate   # compiles *.mts → *.mjs, then runs directus database migrate:latest
```

They run **after** the schema push on boot, so they may assume the model exists
but never create it. [CLAUDE.md](CLAUDE.md) has the rules.

## Tests and checks

```bash
npm test           # vitest, in extensions/app
npm run typecheck  # extension bundle (+ migrations, if the project has any)
npm run build      # compile every extension bundle (and any migrations)
```

## Deployment

The `Dockerfile` builds an image that bootstraps the database, starts Directus,
applies the committed schema and then runs the data migrations — see
`docker/entrypoint.sh`. It is deployed together with the frontend by the root
`docker-compose.yml`. Images are published by the workflows in the repository's
`.github/workflows/`.
