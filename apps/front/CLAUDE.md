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
│   ├── robots.ts            robots.txt — lets crawlers IN so they can read the noindex
│   └── api/                 route handlers — proxies, nothing else
│       ├── auth/{login,logout,session}/
│       ├── auth/editor/       PUBLIC — the way in from the We.Publish editor
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
    ├── session.server.ts    server-only: the two httpOnly cookies, or the marker in the frame
    ├── marke.server.ts      server-only: seals/opens the session marker (tested)
    ├── marke.client.ts      the marker in the page's memory + `sitzungsFetch` (tested)
    ├── rahmen.ts            pure: frame session? whose Origin may write? (tested)
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
- **Embedding in the We.Publish editor costs the cookie's own CSRF protection,
  and only when it is switched on.** `EDITOR_EINBETTUNG` (server-side, never
  `NEXT_PUBLIC_`) is a list of https origins allowed to frame this workspace.
  Empty — the default — means exactly what stood here before: `X-Frame-Options:
SAMEORIGIN`, no frame, cookies `SameSite=Lax`. Set, two things change together
  and they have to: a `frame-ancestors` CSP replaces the old header (never both —
  they contradict each other, modern browsers follow the CSP), and the session
  cookies become `SameSite=None; Secure`, because in a foreign frame the browser
  does not send a lax cookie at all and the workspace simply looks logged out.
  What is given up is the cookie's own rule against cross-site requests. What
  stays: the tokens remain **httpOnly**, so no script reads them, and every call
  to Directus still goes through this app's same-origin `/api/*` routes with the
  signed-in user's token. The rules are pure and tested in `lib/einbettung.ts`;
  the allow-list drops anything that is not a bare `https://` origin rather than
  writing it into a CSP, and `None` forces `Secure` even in development, since a
  browser silently discards a `SameSite=None` cookie that is not secure.
- **`SameSite=None` is not enough, and Safari is where that shows.** Measured on
  16 September 2026 against the editor's own `userinfo` controller: a frame from
  a foreign site is a third-party context, Safari blocks third-party cookies
  outright, Firefox partitions them, Chrome allows them until somebody turns
  them off. So with `EDITOR_EINBETTUNG` set and everything above working as
  designed, **the embedded workspace still looks logged out in Safari** — no
  error, no refusal, just an empty session. Until this is addressed the
  embedding is a Chrome feature, not a newsroom feature, and it should not be
  announced as one.
  The remedy is not a cookie flag: the instance has to run on a subdomain of the
  same site as the editor of its medium. Then the cookie is first-party,
  `SameSite=Lax` is enough, and the CSRF protection given up above comes back.
  The fallback, if that is not available, is carrying the session marker in
  every link and form instead of in a cookie. The same question stands for the
  Dorfkönig, and it deserves one answer for both — see
  `_wepublish/oekosystem/2026-09-16_konzept_dorfkoenig_im_editor.md`, section 8,
  point 1.
- **The fallback is built, and it is the SITZUNGSMARKE.** Since 17 September
  2026 a session inside the frame travels as a marker in a header instead of a
  cookie: the very same token pair, sealed with AES-256-GCM under
  `SITZUNGSMARKE_SCHLUESSEL` (`lib/marke.server.ts`, `versiegle`/`oeffne`, Web
  Crypto, no new package). It is opaque — the key never leaves this server, so
  the browser gains nothing it did not have. `readSession` reads the marker
  BEFORE the cookies and never both, so a stale cookie from an earlier
  same-site visit cannot win over the session the editor just handed over;
  `writeSession` answers a frame session with the header `X-Sitzungsmarke` and
  writes no cookie at all. Whether a request IS a frame session hangs on the
  request — a marker, or `X-Rahmen: editor` from the login form
  (`istRahmenSitzung` in `lib/rahmen.ts`, pure and tested) — never on a module
  variable: one process serves both kinds of visitor at once.
  **Where it lives and what it costs:** in the page's memory
  (`lib/marke.client.ts`), never in `localStorage`, never in a cookie, never in
  the address after the entry. A reload inside the frame therefore loses it and
  the editor hands out a fresh token — 240 minutes' worth. That is the deal.
  Every call the workspace makes goes through `sitzungsFetch`, which carries the
  marker, picks up a renewed one out of the answer and drops it on a 401; Apollo
  gets it as its `HttpLink` `fetch`. Outside the frame it adds nothing at all.
  **The CSRF protection the cookie gave up comes back as an Origin check:** a
  writing `/api/*` request in a frame session must carry an `Origin` that is
  this workspace's own or one from `EDITOR_EINBETTUNG` (`ursprungErlaubt`, the
  same allow-list that builds `frame-ancestors`, so the two cannot disagree
  about who is inside). A request without an `Origin` is refused, not trusted.
  **The way in** is `GET /?token=<jwt>` — the address the editor opens. The
  middleware recognises it and redirects to `/api/auth/editor`, which trades the
  token at `POST /redaktion/editor-zugang` in the bundle, seals the answer and
  sends the browser to `/?rahmen=editor#m=<marke>`. A FRAGMENT: it reaches no
  server, no access log and no `Referer`, and `history.replaceState` takes it
  out of the address bar at once. With `EDITOR_EINBETTUNG` set the middleware
  also sends `Referrer-Policy: no-referrer`. `SITZUNGSMARKE_SCHLUESSEL` empty
  means no frame login at all, and the page says so instead of failing quietly.
  **Still open on 17 September 2026:** the editor does not yet hand the token to
  the iframe address — its own PR is not there — so the measured path today is
  the login form inside the frame, which the marker already makes work.
- There is deliberately **no service/admin token in this app**. If a feature seems to
  need one, it needs a Directus extension endpoint instead — that is the whole point
  of constraint 7 in the root CLAUDE.md.
- **Nothing in this app may be indexed, and the blog is UNLISTED rather than
  secret**: reachable for anyone who has the address, absent from search results.
  Three pieces say so and they have to stay consistent — the `X-Robots-Tag`
  header on `/:path*` in `next.config.ts` (`noindex, nofollow, noarchive`), the
  `robots` metadata in the root layout (inherited by every page, `googleBot`
  spelled out separately), and `src/app/robots.ts`. **The last one deliberately
  does NOT forbid crawling, and changing that would break the other two:**
  robots.txt governs CRAWLING, `noindex` governs INDEXING. A crawler turned away
  at robots.txt never reads the `noindex`, and Google documents that it may then
  still list the bare URL when something links to it. Blocking the door is what
  leaves the address in the index. There is no sitemap, for the same reason.
  Tested in `src/app/robots.test.ts`.
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

- `EDITOR_EINBETTUNG` — allowed iframe origins, space-separated, empty by
  default (see the security model above for what setting it costs). It is not in
  a committed example file: `.gitignore` excludes `.env.*`, so the front app has
  no checked-in example; the root `.env.example` and `docker-compose.yml` carry
  it.
- `SITZUNGSMARKE_SCHLUESSEL` — 32 bytes, base64 (`openssl rand -base64 32`),
  server-side. The key the session marker is sealed with, for the editor's
  frame. Empty — the default — means no frame login: the login form inside the
  frame answers 503 with a German sentence naming the variable, and everything
  outside the frame is untouched. Like `EDITOR_EINBETTUNG` it has no
  checked-in example here (`.gitignore` excludes `.env.*`); the root
  `.env.example` and `docker-compose.yml` carry it.
- `DIRECTUS_URL` — where Directus is reachable **from this server process**
  (`http://redaktion-directus:8055` in Docker — the service name; on a shared
  deploy host a bare `directus` alias can belong to another stack). The browser
  never uses it.
- No token, no Claude key. Both live in the backend.
