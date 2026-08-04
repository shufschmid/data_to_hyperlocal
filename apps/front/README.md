# Frontend — Next 16 · React 19 · MUI 9 · Apollo 4

The user interface. **UI only**: business logic, prompts and Claude calls live in the
Directus extension bundle (`../directus/extensions/app`).

Working instructions for agents and developers: [CLAUDE.md](CLAUDE.md).

## Run it

```bash
cp .env.local.example .env.local   # DIRECTUS_URL — no tokens, no API keys
npm install
npm run dev                        # http://localhost:3000
```

The backend must be running (`cd ../directus && npm run dev`). Sign in with the
Directus admin: `admin@wepublish.ch` / `admin123`.

## Commands

```bash
npm run dev         # dev server
npm run build       # production build (standalone output for Docker)
npm test            # jest + testing-library
npm run typecheck   # tsc --noEmit
npm run codegen     # TypeScript types from the live GraphQL schema
```

## How it talks to the backend

The browser only ever calls this app's own `/api/*` routes:

- `/api/auth/login` · `logout` · `session` — the session is two **httpOnly** cookies;
  no token is ever readable by JavaScript.
- `/api/graphql` — Apollo's endpoint. Forwards to Directus GraphQL **with the
  signed-in user's token**, so Directus permissions apply.
- `/api/notes/[id]/summary` — example of calling a Directus extension endpoint.

This app holds no service token and no API key. Anything that needs system-level
access belongs in a Directus extension endpoint instead.
