# apps/front — Frontend

Next 16 (App Router), React 19, MUI 9, Apollo Client 4. **UI only.**

Read the root [CLAUDE.md](../../CLAUDE.md) first — the hard constraints there apply
here. The one that shapes this app most: **business logic belongs in the Directus
extension bundle, not here.**

## What belongs here, and what does not

**Here:** pages, layout, components, forms, formatting, client-side state, GraphQL
documents, and thin route handlers that forward a request to Directus.

**Not here:** prompts, Claude calls, calculations, validation that protects data,
anything that must also hold when a colleague edits the record in the Directus admin
UI. All of that goes into `apps/directus/extensions/app` — see that app's CLAUDE.md.

The test: if the rule would be bypassed by someone editing the record directly in
Directus, it is in the wrong place.

## Layout

```
apps/front/src/
├── app/
│   ├── layout.tsx           server component: MUI cache provider + colour-scheme script
│   ├── providers.tsx        'use client': ApolloProvider + ThemeProvider
│   ├── page.tsx             renders <AppShell />
│   ├── blog/                PUBLIC page — published articles only, no session gate
│   └── api/                 route handlers — proxies, nothing else
│       ├── auth/{login,logout,session}/
│       ├── graphql/         the browser's only data endpoint
│       ├── redaktion/[...pfad]/  calls the extension endpoint (allowlisted)
│       ├── freigabe/             PUBLIC — the counter-check link
│       └── health/          docker healthcheck
├── components/              MUI components; *.test.tsx next to them
├── graphql/                 gql documents + result types, one file per collection
└── lib/
    ├── apollo.ts            client factory (points at /api/graphql)
    ├── theme.ts             the single MUI theme
    ├── redaktion.ts         pure presentation helpers (tested)
    ├── public.server.ts     server-only: the few unauthenticated paths (approval, public blog)
    ├── directus.server.ts   server-only: login/refresh/logout/fetch
    ├── session.server.ts    server-only: the two httpOnly cookies
    ├── auth.ts              pure: which refusal from Directus means "renew" (tested)
    └── proxy.server.ts      server-only: browser request → Directus request
```

`*.server.ts` files start with `import 'server-only'` — importing one from a client
component is a build error, which is what keeps tokens off the browser.

## Security model — do not work around it

- The browser holds **no** Directus token and **no** API key. It gets two httpOnly
  cookies (`session_access_token`, `session_refresh_token`); no script can read them.
- Every request to Directus goes through `proxyToDirectus` in `lib/proxy.server.ts`
  with the **signed-in user's** access token, so Directus permissions decide what
  happens. A token Directus refuses → refreshed once, request retried, rotated
  cookies written back; still refused → cookies cleared and a 401, so the workspace
  falls back to the login form instead of holding a credential that can only fail.
- **Which refusals mean "renew" is a measured rule, not a guess** — `istTokenProblem`
  in `lib/auth.ts` (pure, tested). Directus answers 401 for a missing, malformed or
  expired token, but **403 `INVALID_TOKEN`** for one it cannot verify — the case a
  browser hits when the backend's `SECRET` changed. Reading the status alone left
  that stuck for ever. It must stay narrow: the extension answers 403 with the code
  `FORBIDDEN` for "not found or not readable", and treating that as a dead session
  would sign an editor out over one invisible record.
- **Renewals are shared, and the result outlives the call.** The access cookie
  expires with the token it carries, so a workspace firing a dozen queries sends a
  dozen renewals with the same refresh token — and Directus rotates on every one, so
  the losers used to clear the session the winner had just renewed. One in-flight
  promise per token plus a 60-second memory of the result fixes it; requests that
  were already in flight with the old cookie get the same new pair.
- There is deliberately **no service/admin token in this app**. If a feature seems to
  need one, it needs a Directus extension endpoint instead — that is the whole point
  of constraint 7 in the root CLAUDE.md.
- Never introduce a `NEXT_PUBLIC_*` variable for anything sensitive: those are baked
  into the browser bundle at build time.

## Fetching data

Reads and writes to collections go through Apollo against `/api/graphql`:

```ts
const { data, loading, error, refetch } = useQuery<MeldungenErgebnis>(MELDUNGEN_QUERY, {
  fetchPolicy: LIVE_FETCH_POLICY
})
```

- Documents live in `src/graphql/*.ts`, never inline in a component. Directus derives
  the API from the data model: collection `meldungen` gives `meldungen`, `meldungen_by_id`,
  `create_meldungen_item(s)` and so on. Explore it
  at http://localhost:8055/graphql.
- Apollo Client 4: `ApolloClient`, `InMemoryCache`, `HttpLink`, `gql` come from
  `@apollo/client`; the hooks from `@apollo/client/react`. Default options require a
  module augmentation in v4 — pass `fetchPolicy` per hook instead.
- `npm run codegen` generates types from the live GraphQL schema into
  `src/graphql/generated/` (gitignored). Until you run it, the hand-written
  interfaces in `src/graphql/*.ts` are the types.
- **Apollo is client-side only.** Queries must not run during server rendering — a
  relative `/api/graphql` URL has no meaning there. The pattern that guarantees it:
  data-fetching components live below a gate that starts in a loading state
  (`AppShell` checks the session in the browser first). Keep it that way.
- Anything that is not a plain collection read/write is a `fetch` to a route handler
  that forwards to an extension endpoint — see `aktion` in `RedaktionPanel.tsx`.

## Adding a page

1. `src/app/<route>/page.tsx` — a server component that renders client components.
2. Data-fetching components are `'use client'` and use Apollo.
3. Reuse the theme; no second styling system. MUI only — no Tailwind, no CSS
   modules, no styled-components alongside it.

## MUI 9 notes

- The theme is `src/lib/theme.ts` — colours, radius, typography and component
  defaults go there, not into `sx` overrides sprinkled across components.
- `cssVariables` + `colorSchemes: { light: true, dark: true }` are on; dark mode
  follows the system. `InitColorSchemeScript` in the layout prevents a white flash.
- **System props were removed.** `alignItems`, `justifyContent`, `display` and
  friends are no longer props on `Stack`/`Typography` — put them in `sx`. `direction`
  and `spacing` are still real `Stack` props.
- Fonts are the system stack on purpose: `next/font/google` downloads at build time,
  which breaks `docker build` on a machine without internet. Ship a font file under
  `public/` with `@font-face` if a brand font is needed.
- Import icons individually (`@mui/icons-material/AutoAwesome`). Names follow the
  Material set — `DeleteOutlined`, not `DeleteOutline`.

## Route handlers

Thin. A handler validates its input, calls `proxyToDirectus`, returns the response.
No prompts, no calculations, no writes assembled by hand.

```ts
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params // params is a Promise in Next 15+
  if (!/^[0-9a-f-]{36}$/i.test(id)) return problem(400, 'Ungueltige Notiz-ID.')
  return proxyToDirectus(`/redaktion/meldungen/${id}/publizieren`, { method: 'POST' })
}
```

Bodies passed to `proxyToDirectus` must be strings, not streams — the request is
replayed after a token refresh.

## Commands

| Command             | What it does                                         |
| ------------------- | ---------------------------------------------------- |
| `npm run dev`       | Dev server on http://localhost:3000                  |
| `npm run build`     | Production build (`output: 'standalone'` for Docker) |
| `npm test`          | Jest + Testing Library                               |
| `npm run typecheck` | `tsc --noEmit`                                       |
| `npm run codegen`   | GraphQL types from the live schema                   |

## Testing

- Pure helpers in `src/lib/*.ts` get plain unit tests (`redaktion.test.ts`).
- Components get Testing Library tests driven by roles and visible text
  (`MeldungKarte`) — that is also how the accessible name gets checked.
- Keep components presentational (props in, callbacks out); the one component that
  fetches (`RedaktionPanel`) stays thin so everything else is trivially testable.

## Environment

`.env.local` from `.env.local.example` for local development; in Docker the values
come from the root `.env` via `docker-compose.yml`.

- `DIRECTUS_URL` — where Directus is reachable **from this server process**
  (`http://directus:8055` in Docker). The browser never uses it.
- No token, no Claude key. Both live in the backend.
