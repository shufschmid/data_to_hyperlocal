#!/bin/sh
# Container boot sequence. Runs on every start and must stay idempotent — a
# redeploy re-runs all of it against an existing database.
set -e

: "${ADMIN_EMAIL:?ADMIN_EMAIL must be set (used to create the first admin on an empty database)}"
: "${ADMIN_PASSWORD:?ADMIN_PASSWORD must be set}"

PORT="${PORT:-8055}"

echo "→ Compiling TypeScript migrations (*.mts → *.mjs)"
npm run build:migrations

# `bootstrap` installs Directus on an empty database (tables + first admin) and
# runs Directus' own migrations. The project's migrations in ./migrations are
# deliberately kept OUT of this step (MIGRATIONS_PATH points at a directory that
# does not exist): they carry row data and unmanaged indexes for tables that on
# a fresh database only exist after the schema push below — so they run last.
echo "→ Bootstrapping Directus (install on empty DB, core migrations only)"
MIGRATIONS_PATH=./migrations/keine npx directus bootstrap

echo "→ Starting Directus"
npx directus start &
DIRECTUS_PID=$!

if [ "${RUN_SCHEMA_SYNC:-true}" = "false" ]; then
  echo "→ RUN_SCHEMA_SYNC=false — skipping schema sync"
else
  echo "→ Waiting for Directus to report healthy"
  attempt=0
  until node -e "fetch('http://127.0.0.1:${PORT}/server/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; do
    attempt=$((attempt + 1))
    if [ "$attempt" -ge 60 ]; then
      echo "✖ Directus did not become healthy within 120s"
      kill "$DIRECTUS_PID" 2>/dev/null || true
      exit 1
    fi
    sleep 2
  done

  # Applies the versioned schema (collections, fields, roles, flows) from
  # ./schema. directus-sync talks to the running instance over HTTP, which is why
  # this happens after the start and not before it.
  echo "→ Applying versioned schema (directus-sync push)"
  DIRECTUS_URL="http://127.0.0.1:${PORT}" \
  DIRECTUS_ADMIN_EMAIL="${ADMIN_EMAIL}" \
  DIRECTUS_ADMIN_PASSWORD="${ADMIN_PASSWORD}" \
    npm run schema:load

  # Data migrations (row seeds, indexes Directus does not manage) run after the
  # push: they may assume the model exists, never create it. Skipped together
  # with the sync so RUN_SCHEMA_SYNC=false really touches nothing.
  echo "→ Applying data migrations"
  npx directus database migrate:latest
fi

echo "→ Ready. Directus is in the foreground."
wait "$DIRECTUS_PID"
