# Multi-stage: the runtime image contains no source, no dev dependencies and no
# package manager — only Next's standalone output (see `output: 'standalone'` in
# next.config.ts).
FROM node:22.22.0-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:22.22.0-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# No NEXT_PUBLIC_* build args on purpose: everything this app needs is read at
# runtime on the server. A NEXT_PUBLIC_ value would be baked into the browser
# bundle at build time, which is how a "config change" silently does nothing.
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22.22.0-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as the unprivileged user that ships with the image.
COPY --from=build --chown=node:node /app/public ./public
COPY --from=build --chown=node:node /app/.next/standalone ./
COPY --from=build --chown=node:node /app/.next/static ./.next/static
USER node

EXPOSE 3000
CMD ["node", "server.js"]
