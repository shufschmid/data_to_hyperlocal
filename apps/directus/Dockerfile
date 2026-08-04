FROM node:22.22.0-trixie-slim
LABEL org.opencontainers.image.authors="We.Publish Foundation"

# Scheduled Directus Flows fire in the process's local timezone — the cron library
# is given no explicit zone. Without TZ the container runs in UTC, so a `0 7` cron
# fires at 09:00 CEST. Europe/Zurich makes crons fire at Swiss wall-clock time
# year-round, tracking the CET/CEST switch. Node 22 bundles full ICU, so the named
# zone resolves without an OS tzdata package.
ENV TZ=Europe/Zurich

WORKDIR /cms

# Dependencies first so a source-only change does not reinstall them.
COPY package.json package-lock.json ./
RUN mkdir -p /cms/.cache /cms/node_modules/.directus /.pm2 && \
    chmod -R 777 /cms/.cache /cms/node_modules/.directus /.pm2 && \
    npm ci --no-audit --no-fund

# Everything else. See .dockerignore — .env, node_modules and build output are
# excluded on purpose: baking a local .env into the image would ship its secrets.
COPY . .

# Compiles migrations (*.mts → *.mjs) and every extension bundle under
# extensions/*. Directus refuses to start without the built bundle, so this must
# happen at build time, not at boot.
RUN npm run build && \
    mv docker/entrypoint.sh entrypoint.sh

EXPOSE 8055
CMD ["/bin/sh", "/cms/entrypoint.sh"]
