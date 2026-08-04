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
# otherwise just applies pending migrations — including everything in
# ./migrations. This is the one command that covers both first boot and redeploy.
echo "→ Bootstrapping Directus (install on empty DB, migrate otherwise)"
npx directus bootstrap

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
fi

echo "→ Ready. Directus is in the foreground."
wait "$DIRECTUS_PID"
