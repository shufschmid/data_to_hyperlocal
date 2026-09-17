# apps/directus — Backend

Directus 11 on Postgres 16. This app owns the data model **and all server-side
logic**. There is no separate API service: business logic ships as a Directus
extension bundle running inside the Directus process.

Read the root [CLAUDE.md](../../CLAUDE.md) first — the hard constraints there apply
here.

## Layout

```
apps/directus/
├── extensions/app/          ← ALL server-side logic (one bundle, own package.json)
│   └── src/
│       ├── shared/          claude.ts · env.ts · http.ts   (reusable, no domain logic)
│       ├── redaktion/       the newsroom's rules: prompts, checks, and the learning layer
│       │                    (lernsignale · gedaechtnis · lernen · weiterreichen — see below)
│       ├── dossiers/ punkt6/  the two broadcast pipelines, copied from the sister project
│       ├── endpoints/       custom HTTP routes
│       ├── hooks/           filter/action hooks on collection writes
│       ├── operations/      steps a Flow can call (this is how cron works)
│       └── types/schema.ts  typed view of the collections
├── extensions/.registry/    marketplace extension: TypeScript type generator
├── MEDIUM_ANLEGEN.md        how a second house sets this up: variables, rows, registrations
├── migrations/*.mts         row data and unmanaged indexes only — never the model
├── schema/                  directus-sync dump — the data model, single source of truth
├── templates/*.liquid       invite/reset emails; name and logo come from project settings
├── docker/entrypoint.sh     container boot: bootstrap → start → schema push → data migrations
└── docker-compose.yaml      LOCAL DEV DATABASE ONLY (the full stack is at the repo root)
```

## Commands

| Command                    | What it does                                                              |
| -------------------------- | ------------------------------------------------------------------------- |
| `npm run setup`            | `.env` from the example, install, build the extension bundle              |
| `npm run db:start`         | Postgres in Docker (detached)                                             |
| `npm run directus:init`    | Bootstrap a fresh database, apply the schema, migrate. **First run only** |
| `npm run dev`              | Postgres + Directus on the host                                           |
| `npm run build`            | Compile every extension bundle (`npm ci` per bundle) and any migrations   |
| `npm test`                 | Vitest in the extension bundle                                            |
| `npm run typecheck`        | `tsc --noEmit` for the bundle (and migrations, if any)                    |
| `npm run database:migrate` | Compile `*.mts`, then `directus database migrate:latest` (rare)           |
| `npm run schema:dump`      | Live Directus → `schema/` (**run this after every model change**)         |
| `npm run schema:diff`      | What a push would change                                                  |
| `npm run schema:load`      | `schema/` → live Directus (diff-and-apply, safe to repeat)                |
| `npm run db:reset`         | **Destructive.** Drops the dev database volume                            |

`schema:dump` / `schema:load` need a running Directus plus `DIRECTUS_URL` and either
`DIRECTUS_TOKEN` or `DIRECTUS_ADMIN_EMAIL`/`DIRECTUS_ADMIN_PASSWORD` in `.env`.

## Changing the data model

**Always through schema sync.** `schema/` is the single source of truth for the whole
model: collections, fields, relations, roles, policies, permissions, presets,
dashboards, translations and Flows. The loop never changes:

1. Create/change it at http://localhost:8055 (admin UI).
2. `npm run schema:dump`.
3. Commit `schema/`. Colleagues and every container get it via `schema:load` — a
   diff-and-apply, safe to repeat, and part of the container boot.

A fresh database reaches the current model with `schema:load` alone. That is the whole
mechanism, and it is also the reason it stays reliable: one owner, one artefact to
review in a diff.

**The dump is not the only way to write the snapshot.** `schema:load` is a plain
`directus-sync push` and the container runs it on every boot, so a field file written
by hand is applied like a dumped one. That is the practice for a field a code change
needs: copy a sibling `schema/snapshot/fields/<collection>/<field>.json` (an enum
from `redaktionswissen/geltungsbereich.json`, a text from
`recherchehinweise/kommentar.json`, an m2o from `redaktionswissen/datensatz.json`
plus its `relations/…` twin), check `sort` and `max_length`, and commit it with the
code. The gate is unchanged: `schema:diff` against a running instance must come back
empty, and the next `schema:dump` regenerates `specs/`. Adding a value to an existing
enum is an edit to the field's `choices` — Directus stores no CHECK for it, so the
column takes the new value the moment the code writes it.

Use it for structure _and_ for everything with presentation metadata — interfaces,
field order, icons, translations, roles, permissions, dashboards, Flows. Directus
writes that metadata for you; hand-written SQL does not.

After changing the model, update `extensions/app/src/types/schema.ts` and the
frontend's GraphQL documents (`apps/front/src/graphql/`).

### Migrations are the exception, not the alternative

**Never create or alter a collection, field or relation in a migration.** Two owners
drift, quietly: a detail the migration got wrong or left out can survive the schema
push, and the same collection is then defined twice, in two files that no longer
agree. A table without `directus_collections`/`directus_fields` rows is also a
collection your colleagues can neither see nor edit in the admin UI. If a model
change _feels_ like it needs a migration, the answer is still: do it in the admin UI
and dump. (This repo carried its model in migrations until August 2026; they are
deleted, their net state lives in `schema/`, and `directus_migrations` still lists
them on old databases — that is harmless.)

What a migration is still for — `20260824A-stammdaten.mts` (seeds and indexes),
`20260824B-entsorgung-indizes.mts` (indexes only),
`20260914A-gemeindeseiten.mts` (one partial unique index whose predicate matches
the endpoint's own guard, plus nine seeded addresses written only where the
field is still empty) and `20260917B-suedanflug.mts` (the composite unique
`(jahr, monat)` on `suedanflugquoten`, plus the EuroAirport source row seeded
**inactive**):

- **Row data a fresh install needs without a human clicking**: the 87 municipalities,
  the three watched sources, the newsroom's registered clubs. Insert-only and
  idempotent, so an editor's later changes are never undone.
- **Indexes and constraints Directus does not manage, with a comment saying why**:
  composite uniques, the two partial unique indexes on `meldungen`, the CHECK on
  `chat_nachrichten`. Single-column uniques and indexes belong in the snapshot
  (`is_unique`, `is_indexed`) — not here.

Rules for the rare migration you do write:

- **Migrations run AFTER the schema push** (see `docker/entrypoint.sh`): they may
  assume the model exists, and must never create it. This is deliberately the
  opposite of the old boot order — a row-data migration on a fresh database needs
  the tables the snapshot builds.
- Filename `YYYYMMDDA-description.mts` — the leading number must be unique and sorts
  the run order. Directus records applied versions in `directus_migrations`.
- Write **`.mts`**, never `.js`: `npm run database:migrate` compiles them to `.mjs`
  (Directus' migration runner only loads `.js`/`.mjs`/`.cjs` and ignores `.ts`). The
  compiled files are gitignored.
- Export `up(knex)` and `down(knex)`. Assume it may run against a database that
  already has data — `ON CONFLICT DO NOTHING`, `IF NOT EXISTS`, guarded
  `ADD CONSTRAINT`.
- Never edit a migration that has run somewhere. Add a new one.

## Adding server-side logic

Everything goes into the single bundle at `extensions/app`. Three entry types, and
the choice matters:

### Endpoint — the frontend calls it

`src/endpoints/<name>/index.ts`, registered under `directus:extension.entries` in
`extensions/app/package.json`. Mounted at `/<name>`.
`src/manifest.test.ts` compares that list with the source tree in both directions —
an operation folder without an entry still builds (an endpoint may import its
handler) and fails only when its Flow fires.

```ts
export default defineEndpoint((router, { services, getSchema, logger }) => {
  router.post('/:id', async (req: ApiRequest, res, next) => {
    if (!isAuthenticated(req)) return next(new ForbiddenError())
    const meldungen = new ItemsService('meldungen', {
      schema: await getSchema(),
      accountability: req.accountability
    })
    // …
  })
})
```

- **Endpoints are public by default** — Directus mounts them before its permission
  layer. Every endpoint must decide explicitly who may call it. This is the most
  common security bug in a Directus extension.
- Pass `accountability` to a service so the caller's permissions apply. Omit it only
  where the code must deliberately act as the system, and say why in a comment.
- Read and write through `services.ItemsService`, not raw `database` — services run
  hooks, validation and permissions. Use knex only for reporting-style queries.
- **`readOne` never returns `null`.** It throws `ForbiddenError` for an item that is
  missing _or_ not readable by the caller, and for a malformed key. Do not write a
  `=== null` check — it is dead code. Match on it with
  `isDirectusError(error, ErrorCode.Forbidden)` and answer **403**, never your own
  404: the ambiguity is deliberate, because two different answers let a caller probe
  which ids exist. Re-wrap it only to get a German message, and let anything else
  from the read fall through to a logged 500 instead of being mislabelled.
- Return errors via `createError` from `@directus/errors` and `next(err)`. Log the
  cause; never return a raw provider error to the browser (it can contain the prompt).
- Wrap only the part that can genuinely fail. A single `try` around the whole
  handler turns every bad request into the same 502: give the caller's mistakes
  their own 4xx (see `LeereAnweisung` in `redaktion`) and keep the generic
  5xx for what really is a fault.
- Working example: `src/endpoints/redaktion/` — note the deliberately public `/freigabe` routes and why they are safe.
- **The one endpoint that is public by design and answers 404 instead of 403:**
  `src/endpoints/api/` (mounted at `/api/v1/…`), the read-only API the Dorfkönig
  fetches published articles from. The 403 rule above protects data a caller
  must not probe for; here everything that answers is published and public, so
  there is nothing to hide and the convention (`wepublish-rest/1`, R9) asks for 404. It avoids `readOne` entirely — `readByQuery` with a hard-wired
  `status = publiziert` and a uuid-shape check before the query, so a caller's
  typo cannot become a 500 from Postgres. Two more properties worth keeping:
  the route REGISTER drives both the router and `/beschreibung`+`/openapi.json`
  (a route cannot be undocumented, and the tests compare both directions), and
  every outside thing is injected, so the whole API is unit-tested without a
  database. The switch `BLOG_API_OFFEN` is explicit and never a fallback — and
  it gates `inhalt: true`, which is not the same as «carries an article»:
  `/api/v1/bilanz` serves nothing but counters and sits behind the switch all
  the same, because how much unpublished work lies inside is not less private
  than what has already gone out. A monitor that only needs to know whether the
  service carries asks `/api/v1/gesundheit`, which answers either way.
  Contract for consumers: [SCHNITTSTELLE.md](SCHNITTSTELLE.md).
- **The one endpoint that trades a foreign token for a session:**
  `POST /redaktion/editor-zugang` (`src/endpoints/redaktion/editorzugang.ts`,
  one line of wiring in `index.ts`; the rules in
  `src/redaktion/editorzugang.ts`, pure and tested). Deliberately public like
  `/freigabe` — the journalist coming out of the We.Publish editor is not
  signed in yet, that is the point — and it carries three gates of its own.
  **One.** The `aud` of the token must be `EDITOR_HERKUNFT`, the origin THIS
  instance is registered under as an External App. Not decoration: the editor's
  own `/external-apps/userinfo` accepts any token whose `aud` matches ANY
  registered app of that house, so without this check a token for another tool
  in the same editor would buy a newsroom session (read in the editor's repo on
  17 September 2026). **Two.** `EDITOR_API_URL/external-apps/userinfo` must
  confirm it (6-second timeout) and answer with an e-mail and the account's
  permissions; `CAN_PUBLISH_ARTICLE` gets in, `CAN_GET_ARTICLES` alone is
  refused with its own sentence (there is no Directus reader role, and creating
  one is a rights decision, not a code change), anything else is refused.
  **Three.** That e-mail must already be an ACTIVE `directus_users` row. **No
  user is ever created here** — who may work in the newsroom is decided by a
  person in the admin UI, and a missing account gets a German sentence saying
  so. Missing or suspended are told the same thing, so a caller cannot probe
  which e-mails exist.
  The session itself is **not** signed by hand and **not** taken from
  `AuthenticationService.login` — that one ends in `LocalAuthDriver.login`,
  which verifies a password this door does not have. Instead the door writes one
  row into `directus_sessions`, exactly the row `login` writes, and calls
  `AuthenticationService.refresh` on it: the role tree, the claims, the
  signature, the rotation and the expiry are then Directus' own code, which is
  what keeps this working across minor versions. The seed row expires in a
  minute, so a failure in between leaves nothing behind.
  Both variables empty → 503 and the door says so (the `CRAWLER_KEY` bargain).
  The front half of this — why the session travels as a marker and not as a
  cookie — is in [apps/front/CLAUDE.md](../front/CLAUDE.md).
- **The one endpoint gated by a key instead of a login:** `src/endpoints/sokrates/`
  (`GET /sokrates/sendungen`) serves the day's Regionaljournal editions —
  Abschnitte plus whole transcript — to Sokrates, the „Frage des Tages" AI.
  The key (`SOKRATES_API_KEY`) travels in the **`X-Sokrates-Key` header, never
  in `Authorization`**: Directus' own auth middleware runs before every custom
  endpoint and answers 401 `INVALID_CREDENTIALS` to any Bearer token it cannot
  resolve as one of its own — a foreign key in that header never reaches the
  endpoint's code (measured here). Unset key → 503 on the content route, wrong
  key → 401, comparison timing-safe (`pruefeZugang`). The rules live in
  `sokrates.ts` next to the wiring and are unit-tested without a database.

### Hook — react to a write, from any source

`src/hooks/<name>/index.ts`. A hook fires for every write path (admin UI, REST,
GraphQL, other extensions), which makes it the right place for invariants.

- `filter('<collection>.items.create'|'.update')` runs **before** the write and must
  return the payload — the only place that can still change what gets stored.
- `action(...)` runs after and cannot change anything: use it for side effects.
- Hooks block the request. Nothing slow belongs here — that is what Flows are for.
- Anything derived by an LLM is a cache: invalidate it in a hook when its source
  changes, so a stale summary can never outlive the text it describes. Example:
  `src/hooks/meldung-status/` — it guards the editorial state machine on every write path.
  `src/hooks/entsorgung-termin/` is the same principle applied to a derived
  article: correcting a collection date — including in the admin UI, which no
  endpoint sees — un-confirms the date and discards the reminder written from
  it, because an article is a cache of the facts it was written from.
- The same hook carries the two marks the public API needs and the timestamps
  alone could not give it (`stempel` in `redaktion/status.ts`, pure and tested):
  `publiziert_durch` says whether a person at the desk or the scheduled run set
  off the publication — `context.accountability.user` is what tells them apart,
  and the Flow „Entsorgung publizieren" writes without one — and
  `zurueckgezogen_am` records a retraction while `publiziert_am` stays put, so
  `/api/v1/korrekturen` can report it without the history losing its shape.

### Operation — a step a Flow can call. **This is how scheduled work is done.**

`src/operations/<name>/{api.ts,app.ts}` — `api.ts` is the handler, `app.ts` describes
it in the Flow editor.

To schedule it ([Directus trigger docs](https://directus.com/docs/guides/flows/triggers)):

1. Settings → Flows → Create Flow → Trigger **Schedule (cron)**, e.g. `0 7 * * *`.
2. Add your operation, fill in its options, save.
3. `npm run schema:dump` — the Flow is now in version control and every environment
   gets it.

Crons fire in the **process timezone**: `TZ=Europe/Zurich` is set in the Dockerfile
and compose so `0 7` means 07:00 Swiss wall-clock all year.

Write scheduled handlers to be idempotent and **bounded** — a scheduled run can
overlap a previous one, and an unbounded run is how a nightly job turns into a
surprise API bill. Example: `src/operations/quellen-pruefen/` (two separate budgets
option, one Claude call per item, one bad item skipped rather than aborting).

## Calling Claude

`src/shared/claude.ts` is the only place that talks to a model.

```ts
const answer = await completeJson<unknown>({
  system: SYSTEM_PROMPT,
  prompt,
  maxTokens: 1024
})
const validated = parseSummary(answer) // never trust the shape
```

- **A PDF goes in through `completeChat`/`completeChatJson`**, as a `document`
  content block in the user turn — `completeText`/`completeJson` take a plain
  string and cannot carry one. `redaktion/entsorgung.ts` builds that message.
  Still keep the answer small — the waste calendar is read as one row per
  collection with its dates, not as a flat list of a hundred dates. Requests
  with `maxTokens` ≥ 8192 stream under the hood (`sendToClaude`), because the
  SDK refuses a plain request that large; callers see no difference. A call
  that big takes minutes, so its endpoint must not hold the HTTP connection
  open — the calendar extraction answers 202 and runs detached, with progress
  on the records (`status: 'liest'`) and a per-process single-flight set.
- `completeText` / `completeJson` throw `ClaudeTruncatedError` when the model hit
  `max_tokens`. A truncated answer looks valid to the caller and truncated JSON is
  the classic silent failure — never "recover" by using a partial answer.
- `completeJson` strips code fences and surrounding prose (`extractJson`), but the
  type parameter is a promise, not a proof. Validate before writing to a collection.
- Both take an optional `MessageSender` so tests inject a stub and never hit the
  network. See `src/shared/claude.test.ts`.
- Keep prompts in their own module next to the handler
  (`redaktion/prompt.ts`) so prompt building and answer validation are
  unit-testable without a network call. Do this for every AI feature.
- **Store each part of an answer in its own field.** Packing structured output into
  one text column (`summary\n\n#tag #tag`) forces the frontend to parse it back
  apart, which is the same format written twice in two packages — they drift. Use a
  `cast-csv` column for a list (`meldungen.zeit_warnungen`; Directus exposes it as
  `[String]` in GraphQL) or `cast-json` for anything nested. The mapping from
  validated answer to columns is one pure function (`summaryFields`), shared by the
  endpoint and the Flow operation so the two cannot diverge.
- Model: `ANTHROPIC_MODEL`, default `claude-sonnet-5`. Reach for `claude-opus-5` for
  genuinely hard reasoning, not by default.
- `ANTHROPIC_API_KEY` lives **here**, never in the frontend.

## Learning from the editor

Every desk decision in the workspace is used three times — as an EXAMPLE in the
next Sichtung's user turn, as a candidate RULE in `redaktionswissen`, and, for one
armed kind of rule, as an ACTION. Four modules in `src/redaktion/` carry it, and
the split between them is the split between pure and Directus-bound code:

| Module             | Pure? | What it does                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------ | ----- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `lernsignale.ts`   | no    | ONE loader per desk (`ladeWochenblattSignale`, `ladeAmtsblattSignale`, `ladeGemeindeSignale`, `ladeSendungSignale`) for the scheduled run and the re-inventory button alike: decided rows of the window (last three issues / 30 days), the Verwerfen join, the Chefredaktion's verdict via the lead's origin FK, the `verfallen` titles and a `Bilanz`. The two municipality-scoped desks share one private loader. Pure helpers `bilanzZeile`, `deklariereKappung`. |
| `lernen.ts`        | yes   | The rules of learning: `lohntLernen` (a comment always, a bare click only after two same-direction decisions, doublette/veraltet/falsche Gemeinde never), the Lern prompt and schema, `parseLernUrteil` with its code guards, `regelnBlock` (R1…Rn for a Sichtung), `vorgabenZeilen` (for an article prompt), `automatischeWeitergabe` (fail-closed) and `automatikPausieren` (two rejections in a row).                                                             |
| `gedaechtnis.ts`   | no    | The store: `ladeRegeln(bereich, stufe)` capped at 30 with a warning, `merkeWissenAus` for words (chat, comments, Begründungen), `lerneAusEntscheid` for decisions (fire-and-forget, `logger.warn` on failure, one promise chain per desk so two quick decisions cannot create twin rules) and `pausiereAutomatikWennNoetig`.                                                                                                                                         |
| `weiterreichen.ts` | mixed | Four pure mappers build a lead from a candidate / publication / municipal item / broadcast candidate with its origin FK; `reicheWeiter` creates the lead FIRST and marks the origin `weitergereicht` second. The endpoints and the four Sichtungen share it — an automatic hand-up is `automatisch: true` plus the `regel` that asked for it.                                                                                                                        |

Four things a change here must keep:

- **Desk rules never reach the cached prefix.** `buildArtikelSystemPrompt` is
  byte-identical across a run; only `bereich: statistik` rules go through `drain.ts`
  into it. Every other desk gets its rules in the USER turn — numbered in a
  Sichtung, as „Redaktionelle Vorgaben" in an article prompt. There are tests.
- **Learning never blocks a write.** `lerneAusEntscheid` runs after the row is
  stored and swallows its own failure. A lost lesson is a warning in the log; a
  blocked reject would be a bug.
- **Automation creates a lead, never a Meldung.** `automatischeWeitergabe` answers
  only for `empfehlung: 'weiterreichen'` with a cited rule that is loaded, active,
  `stufe: sichtung` and `wirkung: weiterreichen`. Anything else is null.
- **Automatic hand-ups are no examples until judged.** `lernDigest` skips a lead
  that is `automatisch` and still `offen`, or the automation would feed itself.

Endpoints of the learning layer, all in `src/endpoints/redaktion/`:

- `POST /redaktion/wissen` — a rule entered by hand in „Gelerntes"
  (`wissenFelderManuell` validates, German messages); `herkunft: manuell`.
- `POST /redaktion/hinweise/:id/zurueck` — „Zurück auf den Tisch": the lead must be
  `offen` and carry an origin FK; the origin goes back to `offen`, the lead becomes
  `zurueckgegeben`, and a `regel` on it counts toward the pause.
- `POST /redaktion/hinweise/:id/bewerten`, the four `…/ablehnen`, the four
  `…/weiterreichen`, `…/kandidaten/:id/perle` and `…/meldungen/:id/verwerfen` all
  store first and then call `lerne(signal)`; the optional `kommentar` in their
  bodies is what makes the lesson immediate.
- `POST /redaktion/gemeindeseiten/pruefen` (202, single-flight; `GET
/redaktion/gemeindeseiten/lauf` mirrors its state for the button, like
  `quellen/lauf`) and
  `POST /redaktion/gemeindeseiten/:id/{meldung,ablehnen,weiterreichen}` — the
  municipal-news desk, same shape as the gazette's; `/meldung` refuses (422) a
  row whose reader stored no text, because a Meldung from a title alone reads
  complete and is not.
- `POST /redaktion/suedanflug/:id/meldung` — the south-approach article, ONE
  model call per municipality: the month's row in the path, the municipality in
  the body (`{gemeinde}`), because one sheet yields one article per affected
  place. The wiring is in `index.ts`, the rest in
  `src/endpoints/redaktion/suedanflug.ts` and `src/redaktion/suedanflug.ts`.
  Three things it refuses rather than fudges: a municipality that is not
  `gemeinden.suedanflug` (422 — who is affected is the newsroom's judgement,
  and the article's whole point is „also über dieser Gemeinde"), a row without
  figures or without the month's PDF address (422 — the source line is built by
  code and carries exactly one address), and a second article for the same
  month and municipality (409). The figures come out of the STORED row, never
  from a fresh fetch: the article has to stand on what the editor saw when she
  pressed the button, and the revision watchdog is what notices when they move
  afterwards.
- `POST /redaktion/gemeinden/:id/news-url` — the one address the feed reads
  per municipality. Validated by READING the page first (`leseUebersicht`:
  template recognised, list non-empty), so a mistyped address fails the form
  with a German reason instead of becoming a row that errors every day at one;
  a successful save starts a run so the editor sees the page's items within a
  minute. Empty clears the field.

`src/shared/euroairport/` is the newest reader and the smallest: `parse.ts`
pure (the overview table, the monthly sheet's text layer, and three checks that
report and never correct), `index.ts` for the two requests. **Its one departure
from the house style is measured:** the text layer comes from `extrahiereText`
(`shared/wochenblatt`) and NOT from `shared/pdf-text.ts`, whose column splitter
cuts this 841.8-pt landscape table in half at 420.9 pt and lost the quota and
the time window from all 31 day lines. Both take pdfjs from the same single
`unpdf` copy, which is the one thing `pdf-text.ts` exists to guarantee. There
is a test against the real August 2026 PDF.

The reader behind that feed, `src/shared/gemeindeseite/`, is the pattern for
any further HTML source: pure parsers per template family (`erkennung`,
`liste`, `detail`, `datum`, `url`, `text`, `robots`), tested against saved
fixtures, and one impure `erstelleLeser` that owns politeness — identified UA,
sequential requests, a per-host pause `robots.txt` may lengthen, disallowed
paths never fetched, redirects only within the site, charset-aware decoding,
size caps. Platform detection is by fingerprint in the HTML, never by host: the
newsroom's rule is that a rule holds for a kind of page, not for one
municipality.

## Environment variables

`.env` locally (from `.env.example`), the `directus` service in the root
`docker-compose.yml` in Docker. Adding one means editing **three** files:
`apps/directus/.env.example`, the root `.env.example`, and `docker-compose.yml`.

Read them through `shared/env.ts` (`requireEnv` names the missing variable in the
error) — never `process.env` scattered across handlers.

`EDITOR_API_URL` and `EDITOR_HERKUNFT` are the newest two (17 September 2026) and
both are read with `optionalEnv`: empty means the editor door answers 503 and
names itself, never a silent yes. `EDITOR_HERKUNFT` must be the NAKED origin —
the editor mints the token with `audience: app.url` and its own `userinfo`
compares that against `new URL(app.url).origin`, so an External App registered
with a path (or a trailing slash) can never authenticate at all.

**Not everything configurable is a variable.** Which statistics portals are read
lives in `quellen` — one row per portal, `basis_url` for the address and
`konfiguration` (`{amt, bezirke}`) for the office it speaks for and the
`gemeinden.bezirk` values it carries figures about. The EuroAirport's
south-approach feed is a `quellen` row for the same reason (`typ:
'euroairport'`), and its `konfiguration` carries the thresholds
(`{monatsschwelle: 40, jahresschwellen: [8, 10]}`) rather than the code or the
prompt — the newsroom moves its own threshold without a deploy. The migration
seeds that row **inactive**: whether this source is read at all is a person's
decision, not a deploy's, and the daily check only walks `aktiv = true`. A dataset already knows its
portal through `datensaetze.quelle`, and the daily catalogue check already walks
the sources one by one, so a list of hosts in the environment would be a second
truth about the same thing. The rule is a pure function, `redaktion/portale.ts`.
The whole picture for a second house is in [MEDIUM_ANLEGEN.md](MEDIUM_ANLEGEN.md).

## Types

`src/types/schema.ts` is hand-maintained, or regenerated by the bundled
**TypeScript Types** module in the admin UI (`extensions/.registry`, from
`directus-extension-ts-typegen`) — paste its output over the file. The frontend does
not import it; it generates its own types from GraphQL.

## Container boot

`docker/entrypoint.sh`, in order: `directus bootstrap` (installs on an empty
database; the project's own migrations are excluded via `MIGRATIONS_PATH`) → start
Directus → wait for `/server/health` → `directus-sync push` → `directus database
migrate:latest` (row data and unmanaged indexes, now that the model exists). It is
idempotent: a redeploy re-runs all of it against the existing database.
`RUN_SCHEMA_SYNC=false` skips the schema push **and** the data migrations — it means
"touch nothing".
