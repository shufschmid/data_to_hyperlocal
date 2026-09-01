# «Die Redaktion» — Monorepo Entry Point

Turns public data into local journalism. Sources are watched for new datasets;
when one arrives with figures per municipality, one article is drafted for each
municipality the newsroom covers. An editor reviews them, revises them by chat,
optionally sends them out to be counter-checked, and publishes. Published
articles are read by a separate downstream system, the **Dorfkönig**.

Built from the standalone-AI-application template; the example feature it shipped
with has been removed.

**What makes this project different from a summariser:**

- Articles must still be correct in five years, so relative time references are
  checked, not merely discouraged — see `redaktion/zeitbezug.ts`.
- Every figure is checked against the data it came from. A percentage the model
  worked out for itself is flagged — `redaktion/zahlen.ts`.
- It has a **memory**. When the same statistic reappears next year, last year's
  articles and the rules learned from the editor's chat feed into the new run.

It is a **monorepo** — both apps live side by side under `apps/`. It is **not** an
npm workspace: each app is installed, built and deployed independently and has its
own lockfile. The root carries the shared pre-commit tooling, CI, and the
docker-compose file that runs the whole stack.

## The stack — fixed, not a suggestion

| Path                             | Purpose                                                        | Stack                                 | Port |
| -------------------------------- | -------------------------------------------------------------- | ------------------------------------- | ---- |
| [apps/directus/](apps/directus/) | Backend: data model, **all** server-side logic, scheduled work | Directus 11, TypeScript, Postgres 16  | 8055 |
| [apps/front/](apps/front/)       | Frontend: UI only                                              | Next 16 (App Router), React 19, MUI 9 | 3000 |

Data flows one way through one door:

```
   browser
      │  same-origin /api/* only (httpOnly session cookies, no tokens in JS)
      ▼
┌─────────────────────┐   Apollo Client → /api/graphql → Directus GraphQL
│     apps/front      │   fetch        → /api/…        → extension endpoint
│  Next 16 · MUI 9    │
└──────────┬──────────┘
           │ server-side only, with the user's access token
           ▼
┌─────────────────────┐
│    apps/directus    │  Directus 11 + one extension bundle
│  data + all logic   │──► Claude API (https, CPU only)
└──────────┬──────────┘
           ▼
      Postgres 16
```

## Hard constraints

These are requirements of the platform, not preferences. A change that breaks one of
them is wrong even if it works.

1. **Runs on a machine without a GPU.** No local inference, no CUDA, no model
   weights, no vector database that needs a GPU. If a feature seems to need a local
   model, it needs the Claude API instead.
2. **Claude API for every LLM call.** One client:
   `apps/directus/extensions/app/src/shared/claude.ts`. Never add a second provider,
   a second SDK, or a direct `fetch` to an inference endpoint.
3. **Runs with Docker.** `cp .env.example .env && docker compose up --build` starts
   the entire application. Anything a feature needs at runtime is a service or an
   environment variable in [docker-compose.yml](docker-compose.yml). The service
   names carry the `redaktion-` prefix and must stay unique **across the deploy
   host**, not just within the file — never rename one back to a bare `directus`,
   `postgres` or `front`. A PaaS that hosts several stacks puts them on one shared
   Docker network, and two stacks publishing the alias `directus` round-robin each
   other's requests: half come back `400` or `403 INVALID_TOKEN` from the other
   application's Directus. This project hit exactly that on its Dokploy host in
   August 2026 — the compose header carries the full story.
4. **Self-contained.** Postgres, Directus and the frontend are the only services. No
   Redis, no queue broker, no external cron host, no side-car. Outbound dependencies
   are enumerated below and adding one is a deliberate decision, not a commit.

   | Host                           | Why                                                                                                                                                                                                                                                                                                                                                   | Adapter                      |
   | ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
   | `api.anthropic.com`            | every LLM call                                                                                                                                                                                                                                                                                                                                        | `shared/claude.ts`           |
   | `data.bl.ch`                   | open-data catalogue and records (no auth, documented API)                                                                                                                                                                                                                                                                                             | `shared/ods/`                |
   | `www.baselland.ch`             | the publication agenda — announcements the API cannot give — and the office's own web article behind an entry, read once per announcement for the mapping and the briefing                                                                                                                                                                            | `shared/agenda/`             |
   | `statistik.bl.ch`              | tables the open-data portal does not carry                                                                                                                                                                                                                                                                                                            | `shared/statbl/`             |
   | `crawler.wepublish.dev`        | renders sport pages that refuse a plain request                                                                                                                                                                                                                                                                                                       | `shared/crawler/`            |
   | `www.binninger-wochenblatt.ch` | the first registered weekly-paper archive — one host per Blatt, only archives an editor registered, read once a day                                                                                                                                                                                                                                   | `shared/wochenblatt/`        |
   | `www.lokalzeitungen.ch`        | the platform hosting the Riehener Zeitung (and others) — the paper page links the current issue, the issue page links a paywall-free PDF from its title; only that free door is used                                                                                                                                                                  | `shared/wochenblatt/`        |
   | `www.wochenblatt.ch`           | the Wochenblatt für das Birseck's e-paper listing — plain links to issuu readers, newest first, the slug carries number and date                                                                                                                                                                                                                      | `shared/wochenblatt/`        |
   | `issuu.com`                    | where that Wochenblatt's issues actually live — the reader page yields the `publicationId`, the anonymous `public.reader.download` API (the same call the reader's download button makes, answering only where the publisher enabled downloads) yields a signed S3 address for the original PDF; if the publisher turns it off, the run fails visibly | `shared/wochenblatt/`        |
   | `bibo.ch`                      | the BiBo (Birsigtal-Bote), on Localpoint's CMS — the listing page embeds its issues as JSON, the reader page names the coordinates the PDF address is derived from                                                                                                                                                                                    | `shared/wochenblatt/`        |
   | `files.localpoint.ch`          | the BiBo's original PDFs — the same public address the reader's download button opens, no login                                                                                                                                                                                                                                                       | `shared/wochenblatt/`        |
   | `amtsblattportal.ch`           | every canton's official gazette plus the federal SHAB, in one documented API — published items need no credentials. The only source that covers the whole newsroom area, Riehen (BS) and Dornach (SO) included                                                                                                                                        | `shared/amtsblatt/`          |
   | `bgauflage.bl.ch`              | the building plans behind a Baselland permit, as plain images — the same public door the objection period opens, read only for a publication the newsroom acted on                                                                                                                                                                                    | `shared/amtsblatt/`          |
   | an IMAP mailbox                | where SMD delivers the two shows' transcript PDFs — one mailbox, two subject filters. Dedup runs against THIS database's own `source_subject`, never the mailbox's seen-flag, so a second deployment reading the same mailbox costs nothing                                                                                                           | `dossiers/mailbox.ts`        |
   | `api.srgssr.ch`                | the SRGSSR Audio Metadata API (OAuth2) — resolves a Regionaljournal story to its public MP3. Read with `optionalEnv`: missing credentials fail PER STORY as `resolution_error`, never as a crashed dossier                                                                                                                                            | `dossiers/srgssr-client.ts`  |
   | `telebasel.ch`                 | two plain GETs per punkt6 episode — `robots.txt` allows `/sendungen/`, and the episode page carries one schema.org `Clip` per Beitrag with exact start/end seconds, so no model is needed to find the boundaries                                                                                                                                      | `punkt6/telebasel-client.ts` |

   The crawler is the one host we do not own the other end of, and it exists for
   a measured reason: the football association's Match Center answers `curl`
   with 403 and builds its tables in the browser, and Swiss Volley's Game Center
   streams its fixtures over RSC — its raw HTML holds the club name and nothing
   else. The service runs a real browser and returns Markdown. We identify
   ourselves, read only pages an editor registered against a club, and read each
   once a day. `CRAWLER_KEY` empty means the sport features stay quiet; nothing
   else notices.

   The portal is also _watched_, but only where it has to be. An inventory walks
   it once (`operations/portal-inventur`) and asks three questions per page: is
   this a municipality table, is it in the open-data portal, is it in the agenda?
   Only what answers yes-no-no is polled daily — everything else already reaches
   us through those two channels. The measured result: 88 branches exist, a
   handful need watching.

   `statistik.bl.ch` is the answer to a real gap, not a convenience: the
   open-data portal has no agriculture dataset at all, while that host publishes
   "Landwirtschaftsbetriebe nach Gemeinde" back to 2013 at a stable URL with a
   `?year=` parameter. There is no machine-readable form — `.csv`, `.xlsx`,
   `.json` all 404 — so `shared/statbl/` parses the HTML, which is Excel's
   "publish as web page" output and therefore regular. Nothing on this host is
   crawled or discovered: only a table whose URL an editor pasted is ever
   fetched, and afterwards only that same table, once a day, to see whether a
   new year has appeared.

   The agenda host sits behind a Cloudflare Managed Challenge. The connector
   identifies itself honestly, makes a handful of spaced attempts per scheduled
   run, and if all of them are turned away it says so on the source so a person
   can enter the entry by hand.

   The spacing is the part that matters, and it was measured. The challenge is a
   window, not a verdict: a cold process gets challenged once and is served
   normally four seconds later, but a bad patch outlasts that. Three attempts at
   a flat four seconds covered eight seconds of wall clock — which is how the
   06:00 run could report a bot check for a page that answered by hand all
   morning. The pause now doubles (4s, 8s, 16s, 32s) over five attempts, so a run
   spans a minute at a _lower_ request rate than before. That fixed it; the
   source has read all 44 announcements since.

   The **agenda host is not the gazette host** — do not confuse them.
   `www.baselland.ch` is the office's publication calendar; `amtsblattportal.ch`
   is the Confederation's gazette portal, and it is the FIFTH feed. Its
   `robots.txt` is a blanket `Disallow: /`, which governs crawling its pages;
   the documented API is used instead, identified, once a day, only for the
   municipalities an editor registered. Two things measured there are worth
   keeping: **the portal indexes publications two different ways and the sets do
   not overlap at all** — `municipalityId` (the BFS number) carries what is
   anchored to a PLACE, `municipalityZipCodes` carries what is anchored to an
   ADDRESS, and for Pratteln in August 2026 that was 14 rows against 65 with
   nothing in common. And **`municipalityName` is a trap**: the portal accepts
   it, answers 200, and silently ignores it — asking for "Riehen" that way
   returned Zurich fire bans.

   The workspace has eight WORKBENCHES and a gear: **statistik.bl ·
   Sportresultate · Entsorgung · Wochenblätter · Amtsblatt · Regionaljournal ·
   punkt6 · Chefredaktion**, with **Gemeinden** and **Gelerntes** behind the
   settings gear at the end of the row. Every tab up there is a desk with a
   task; the two behind the gear are configuration. The **Blog** is neither —
   it is the result of all the others — so it hangs on two small links in the
   header instead: one opens it in-app for editing, one opens the public page.
   The tab values are NAMES, not indices (`reiter === 'amtsblatt'`): the order
   was renumbered twice, and each time every `reiter === N` had to move with it. „Sportresultate" is the second feed and works
   the same way as the first: a source that publishes on its own schedule, watched
   daily. What differs is the shape — a statistic arrives once a year for every
   municipality at once, a match arrives every weekend for one club. Filterable
   by Gemeinde and Sportart, split into played and upcoming by the clock rather
   than by whether a score exists, because a finished match whose result the
   source has not published yet is exactly the one an editor is waiting for.
   „Entsorgung" is the third feed and the only one nobody watches: the printed
   Abfuhrkalender is registered once a year per municipality, read in one pass,
   and produces the whole year's reminders in advance — seventy-odd articles at
   a stroke, so the desk shows only the **next two** (`naechsteErinnerungen`)
   with „Jetzt publizieren" beside the usual „Freigeben", and folds the year
   away behind one click. The municipality blog thins the same flood
   (`blogOhneErinnerungsflut`): all of them are created on the same day, so all
   of them would otherwise sort above the journalism. Its unit of work is one
   calendar — pick it, read it, confirm its dates, write its year — so the tab
   shows one at a time rather than a directory of eighty-seven.
   „Wochenblätter" (the press review, `presseschau` in code) is the fourth
   feed and deliberately a DESK, not an archive: every municipality's weekly
   paper, watched daily at 09:00 through its public PDF archive. A new issue
   is inventoried by one Opus call into CANDIDATES — only the paper's own
   exclusive journalism, never what the municipality publishes itself (that
   arrives through the other feeds) — and they land on the editor's desk.
   She takes a candidate over (one short Meldung in own words, mandatory
   in-text attribution, a `#page=N` link straight to the piece), rejects it
   WITH A REASON — nicht relevant, Doublette, veraltet, falsche Gemeinde,
   andere + Kommentar — or HANDS IT UP (`weitergereicht`): a good piece she
   cannot verify today becomes a Recherche-Hinweis on the Chefredaktion desk
   instead of a Meldung. All three decisions are the learning signal: the
   last ~20 ride into the next inventory's user turn as examples, per paper.
   Some pieces are PERLEN — curious AND of supra-local interest (the story
   the city of Basel wants too); the model proposes, the chief editor decides
   — ON THE CANDIDATE (`wochenblattkandidaten.perle`, null = pending on her
   desk), via POST /kandidaten/:id/perle, INDEPENDENT of whether a Meldung
   ever comes of the piece. A published Meldung carries a mirrored copy
   (`meldungen.perle`): the meldung-status hook stamps it at publish time,
   the endpoint updates one published already — unpublished still never
   carries a Perle, the hook guards it. Registration takes the newest
   issue and ignores the backlog forever. An issue whose PDF outgrows the
   Claude API's 32-MB request limit (issuu and Localpoint hand out the
   publisher's original — measured 34 MB and 58 MB) is inventoried from its
   TEXT LAYER, page by page — code decides the transport
   (`brauchtTextTransport`), and the per-page rubric headers keep the
   municipality assignment working without images (`entspreizeVersalien`
   un-spaces letter-spaced headers first). Source links are per connector:
   `#page=N` on a PDF, a path segment on an issuu reader (`seitenLink`).
   A paper may cover municipalities the newsroom does not: a candidate the
   model files under a foreign name is dropped by `parseInventar`, never
   refiled under the nearest covered municipality.
   One paper can cover SEVERAL municipalities (the Muttenzer & Prattler
   Anzeiger has two, `wochenblattgemeinden`): every candidate carries its own
   `gemeinde`, assigned by the inventory — the page index top-left where
   printed, the content where not (the front) — and correctable by the editor;
   the `kandidat-gemeinde` hook stamps corrections and they teach the next
   inventory. Wochenblätter also yield RECHERCHE-FÄHRTEN (mostly from
   Leserbriefe): leads for the newsroom's own reporting, collected in
   `recherchehinweise` — and NEVER published unchecked. The verdict
   (brauchbar / kein Hinweis + Kommentar) is a learning signal like the
   Perlen. The inventory proposes leads VERY sparingly (two to three per
   issue at most — a missed lead is acceptable, a dozen bland ones are not),
   and every verdict is checked against the source, not the summary: every
   candidate and lead links its page (`seitenLink`) and shows the original
   wording in a collapsible box (`seiten_texte` on the issue for candidates;
   a lead carries its page's text itself in `quelltext`, so it outlives its
   issue). „Chefredaktion" is the fifth tab and the SECOND desk: the leads
   and the pending Perle decisions live there with a count badge, and they
   deliberately survive new issues — the chief editor clears them by verdict,
   however long that takes. The Wochenblätter desk, by contrast, cleans
   itself twice over: FINISHED work vanishes immediately from the view
   (`bleibtAufDemTisch` — published, verworfen, abgelehnt and weitergereicht
   drop off; an übernommene Meldung stays while it is being edited), and when
   a paper's next issue is inventoried, the previous issues' UNDECIDED
   candidates are deleted (`raeumeAlteVorschlaegeAuf`) — decided rows stay,
   they are the memory, and candidates with a Perle proposal are spared too
   (their verdict belongs to the Chefredaktion and survives new issues); the
   badge counts what the desk shows. A re-inventory diffs leads like
   candidates: open ones the new run no longer proposes are deleted, verdicts
   are never re-asked.
   „Amtsblatt" is the fifth feed and the newsroom's THIRD desk. It is the
   only source that reaches every covered municipality: the cantonal gazettes
   and the federal SHAB sit on one portal, so Riehen (BS) and Dornach (SO)
   arrive through the same door as the Baselland ones — where the statistics
   portals are cantonal and silent about them. Read daily at 07:00, two
   requests per municipality (see above), filed into five groups — Bauen,
   Handelsregister, Behörden, Grundbuch, Personen. `personen` is not a topic
   but a property: those rubrics name private individuals, which is what lets
   one rule cover them all.
   Volume was measured, and it decides the design: **12 publications a day over
   seven municipalities, eight of them commercial-register routine**. So one
   Sonnet call per municipality per run TRIAGES the day's titles — it SORTS,
   it never filters. Proposals sit on top, everything else is one click away
   (`tisch`), and `vorschlag = null` means "not judged", never "no".
   To what it proposed, the run reads the actual BUILDING PLANS
   (`redaktion/amtsblattlauf.ts`, Opus with the sheets as image blocks) — the
   one call in the project that looks at evidence rather than prose. That is
   also where a model would most readily invent a figure, so every finding must
   name the sheet it stood on, `parsePlanbefund` drops the ones naming a sheet
   that does not exist, and the list is capped at twelve (the first real run
   returned 24, half of them survey marks). It pays: a permit titled „4
   Mehrfamilienhäuser" yielded 16 flats, 27 parking spaces and the demolition
   of an existing house and pool; a Muttenz one revealed that the plans say
   Bahnhofstrasse 19 where the publication says 20. Only Baselland publishes
   its plans as plain images — Basel-Stadt and Solothurn keep theirs behind
   viewers we do not parse (`portal-ebau.so.ch` answers 401), so those links
   are SHOWN and not read, and `Unterlage.lesbar` is what tells them apart.
   For everything the triage did not propose, the editor gets the link and a
   button that reads the documents on demand — the same function either way.
   Three decisions like the press review (übernehmen · ablehnen mit Grund ·
   an die Chefredaktion), all three teach the next triage. **No Meldung is
   written without a person's decision.** The tab's badge counts the PROPOSALS
   plus what she already took over — counting the whole desk read "99+" every
   morning, because the desk deliberately keeps the rest. The desk also cleans
   itself (`darfWeg`): an undecided row with a passed DEADLINE goes, and so
   does anything the triage did not propose after seven days. A proposal
   without a deadline stays until decided — it is the queue, and deciding it is
   the learning signal. Decided rows are never deleted; they are the memory.
   The cleanup takes the run's own look-back window as a floor, and that is not
   decoration: with a seven-day window against seven-day retention, one run
   deleted 32 rows and re-fetched them minutes later, re-paying for the same
   triage every morning. The window is now two days.
   A gazette Meldung is also revised INLINE, like the match report, the press
   review and the reminder — it has no `lauf`, so the statistics queue cannot
   carry it. Without that fourth branch it sat at `verarbeitung: 'geplant'` for
   ever, which is exactly what happened. And the desk shows WORK, not history:
   a taken-over publication STAYS, with its Meldung rendered on the row, until
   that Meldung is published or discarded — because that is where it is edited
   (`bleibtAufDemTisch` takes the Meldung's status, exactly as the press
   review's does). Dropping the row the moment the article existed made it
   vanish under the editor's hands with nothing on screen to say where the
   article had gone.
   Two things the articles do that nothing else does: they carry TWO built
   links (the official PDF and the documents), and they keep the names of
   natural persons OUT by default — an official publication may name a private
   individual, a piece of journalism decides that for itself, and
   `personenWarnungen` reports it when the model does anyway.

   „Regionaljournal" and „punkt6" are the sixth and seventh feeds, ported from
   the sister project shufschmid/regionaljournal (same template, same
   conventions). SMD mails a transcript PDF of each show into one mailbox; the
   Regionaljournal's stories are resolved against the SRGSSR Audio API, punkt6's
   episode against telebasel.ch — whose page carries one schema.org `Clip` per
   Beitrag with exact start/end seconds, which is why punkt6 needs no model to
   find its boundaries where the Regionaljournal does. The whole of `dossiers/`
   and `punkt6/` came over UNCHANGED and is meant to stay that way: the next fix
   over there should be a copy, not a merge. Everything this newsroom added
   lives in `redaktion/sendung.ts` and `redaktion/sendunglauf.ts`.
   **One thing this bundle forced a change on.** The sister project imports
   `pdfjs-dist` directly and works around the extension bundler by resolving
   `pdf.worker.mjs` by hand — the build folds everything into one `dist/api.js`,
   so pdfjs's own guess points at a file that lives only in `node_modules`. That
   cannot survive here, because this bundle already carries `unpdf` (the waste
   calendar reads its PDFs with it), and unpdf ships its own inlined pdfjs. Two
   copies met: `The API version "5.7.284" does not match the Worker version
"6.1.200"`, and every dossier failed — while the Vitest suite stayed green,
   because it runs against un-bundled source. `shared/pdf-text.ts` now takes
   pdfjs from `unpdf/pdfjs`, `pdfjs-dist` is gone from the bundle, and there is
   exactly one copy and no worker file. **Only a real `docker compose build`
   plus one processed dossier proves this; no test can.**
   Two fixes originated HERE and belong in the sister project as copies.
   First: telebasel.ch renders the NEWEST episode only as the archive page's
   hero, never in the vertical episode list, so the current Sendung could never
   be resolved — hit on the 31.08. dossier, and structural, because a
   transcript normally arrives before the next episode airs.
   `telebasel-client.ts` now reads the hero's share modal
   (`share-data-element`) as a fallback. Second: both `imapConfigFromEnv`
   functions now REQUIRE their subject filter — the mailbox is shared between
   several saved searches, and an empty filter used to mean "ingest
   everything": a Directus process whose environment predated
   `PUNKT6_IMAP_SUBJECT_FILTER` (env vars load at process start, a `.env` edit
   needs a restart) turned 14 Regionaljournal/Gemeinden mails into failing
   punkt6 dossiers before anyone noticed.
   Two things were deliberately changed on arrival. The Beiträge lost their
   `draft/published` status — a leftover from an abandoned plan that would have
   put two meanings of „publizieren" side by side; here the word means one
   thing, an article going to the Dorfkönig. And the review itself is UNTOUCHED
   in shape, because not everyone who watches these shows writes municipality
   news: where a Beitrag is ABOUT a covered municipality it is highlighted on
   its own card and carries the three decisions there (`SendungsKandidat`), and
   the tab's badge counts only those.
   **The pre-filter is what makes this affordable, and it has a local trap.** No
   model is called unless a covered municipality is named, and the match uses
   WORD BOUNDARIES: „Aesch" sits inside „Aeschenplatz" and „Aeschenvorstadt",
   „Riehen" inside „Riehenring" — Basel city addresses these two shows mention
   constantly. A substring match would propose the wrong municipality almost
   daily. There is a test.

   „Gemeinden" is a flat, searchable list — not grouped by district. The
   districts were dropped because they hid what they organised: Riehen, the
   first municipality outside the five Basel-Landschaft districts, arrived as
   its own collapsed one-item accordion and was simply overlooked. Each active
   municipality also carries its own card: whether the statistics feed can say
   anything at all (the portals are cantonal — an out-of-canton municipality
   like Riehen gets sport, waste and the press review, and silence from the
   statistics side, which the card says outright), its `vereine` with
   Aushängeschild before Breitensport and both writable here, the paper that
   covers it, and whether this year's Abfuhrkalender exists. The list shows the
   REDAKTIONSGEBIET, not the directory: all 87 rows stay in the table, because
   the source detection matches portal pages against those names — thinning it
   would quietly stop every municipality table from being recognised.
   „statistik.bl" — until this change called „Datenquellen" — is one
   chronological list fed by all three watchers — the
   agenda, the watched portal branches, and changes in the data.bl.ch catalogue.
   The third feed is the one that is easy to forget and carries the most: only 9
   of 188 datasets have an agenda entry, so without it most articles would have
   no visible origin at all. Announced entries without a date hang below the
   list, grouped by quarter, and move up by themselves once they get one.

   When it turns us away, that is not silence: the workspace shows a banner
   naming the source, the reason and the date of the last attempt, with a link
   to the page and a form to type the entry in by hand
   (`POST /redaktion/ankuendigungen`, which updates an existing announcement
   rather than adding a second one). An absence is otherwise
   indistinguishable from "nothing was published".

   **Do not try to make it pass.** Cloudflare fingerprints the TLS handshake, not
   just the User-Agent — measured on this host, `curl` gets through where Node's
   `undici` is refused with the identical header. The fixes for that are faking a
   browser fingerprint or shelling out to another client, and both are
   circumvention rather than politeness. If we cannot get in as ourselves, we do
   not get in; the open-data API carries the pipeline either way.

5. **No persistent file storage outside Directus.** Application code never writes to
   the filesystem — no temp caches, no JSON state files, no log files, no
   `./data`. State goes into a Directus collection; binaries go through Directus
   Files (one named volume). Containers are disposable: anything written outside a
   volume is gone on the next deploy.
6. **TypeScript only.** All logic — backend, frontend, migrations, scripts. No
   Python, no shell scripts carrying business rules. `apps/directus/docker/entrypoint.sh`
   is the one exception and it only orchestrates commands.
7. **Server-side code lives in the Directus extension bundle.**
   `apps/directus/extensions/app` — endpoints, hooks and Flow operations.
   [Extension docs](https://directus.com/docs/guides/extensions/overview). Next
   route handlers are proxies only: they forward a request and never contain a rule,
   a prompt or a calculation.
8. **Scheduled work is a Directus Flow with a Schedule (cron) trigger.**
   [Trigger docs](https://directus.com/docs/guides/flows/triggers). No system cron,
   no `setInterval` in a hook, no scheduler container. The Flow calls a custom
   operation from the bundle; the Flow itself is committed via `schema:dump`.
9. **The data model is synced, never migrated.** Collections, fields, relations,
   roles, permissions and Flows are built in the Directus admin UI and committed with
   `npm run schema:dump` (directus-sync → `apps/directus/schema/`). A migration must
   never create or alter structure; `apps/directus/migrations/` is a last resort for
   row data and for indexes Directus does not manage — see
   [apps/directus/CLAUDE.md](apps/directus/CLAUDE.md).

## Where does this feature go?

| The change is…                                    | Goes to                                                                                                                                                                                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a new collection, field, relation or role         | Directus admin UI, then `npm run schema:dump` — [apps/directus](apps/directus/)                                                                                                                                                          |
| a calculation, validation or business rule        | extension bundle (endpoint or hook)                                                                                                                                                                                                      |
| anything that calls Claude                        | extension bundle, via `shared/claude.ts`                                                                                                                                                                                                 |
| something that must run nightly/hourly            | Flow with a Schedule trigger + a custom operation in the bundle                                                                                                                                                                          |
| a screen, a form, a list, a chart                 | [apps/front](apps/front/) — MUI components, Apollo for data                                                                                                                                                                              |
| a new query the UI needs                          | `apps/front/src/graphql/*.ts`                                                                                                                                                                                                            |
| a new rule about what an article may say          | the prompt in `redaktion/prompt.ts` **and** a check next to it — a prompt is a request, a check is a rule (`zeitbezug.ts`, `zahlen.ts`, `attribution.ts`, `quelle.ts`)                                                                   |
| a table on statistik.bl.ch the newsroom wants     | paste its URL in the workspace — „statistik.bl" → „Auftrag …" — it becomes an ordinary dataset                                                                                                                                           |
| a club whose results the newsroom wants           | „Gemeinden" → die Karte der Gemeinde → „Verein erfassen"; ohne Konnektor für die `quelle` bleibt er still erfasst                                                                                                                        |
| a new rule about what a match report may say      | `redaktion/spielbericht.ts` — the prompt **and** the check next to it                                                                                                                                                                    |
| which of a club's teams gets a report             | `redaktion/mannschaft.ts` — the first team only, mirrored in the workspace's counter (`berichtenswerteSpiele`)                                                                                                                           |
| an Abfuhrkalender the newsroom wants              | paste the PDF's address in the workspace — „Entsorgung" → „Abfuhrkalender erfassen"; one PDF per zone (Riehen) registers zone by zone into the same calendar                                                                             |
| a weekly paper the newsroom wants read            | „Presseschau" → „Wochenblatt erfassen" with its archive URL; the platform decides the parser (`konnektor`: WordPress-Archivliste, lokalzeitungen.ch, issuu or Localpoint) — a fifth platform gets its own value in `shared/wochenblatt/` |
| a new rule about what a press review may say      | `redaktion/presseschau.ts` — the prompt **and** the checks next to it (attribution, digits, verbatim overlap)                                                                                                                            |
| a new rule about what a gazette article may say   | `redaktion/amtsblatt.ts` — the prompt **and** the checks (attribution, digits, absolute dates, no private names)                                                                                                                         |
| a new rule about what a broadcast Meldung may say | `redaktion/sendung.ts` — the prompt **and** the checks (attribution per show, digits, verbatim overlap against the transcript)                                                                                                           |
| which names a broadcast is scanned for            | nothing — `gemeindeTreffer` uses the active `gemeinden` rows, so adding a municipality adds it to the scan                                                                                                                               |
| which gazette rubrics reach the desk              | `RUBRIKGRUPPEN` in `shared/amtsblatt/parse.ts` — sub-rubric first, rubric second; an unmapped rubric is dropped, never guessed                                                                                                           |
| a municipality's postcodes                        | „Gemeinden" → die Karte → Abschnitt „Amtsblatt"; ohne sie bleiben Handelsregister, Konkurse und Betreibungen dieser Gemeinde unsichtbar                                                                                                  |
| a new rule about what a reminder may say          | `redaktion/erinnerung.ts` — the prompt **and** the check next to it                                                                                                                                                                      |
| a one-off data repair or backfill                 | rows only: a one-shot Flow, else `apps/directus/migrations/*.mts` as a last resort                                                                                                                                                       |
| an agenda entry the crawler could not fetch       | the banner in the workspace → „Eintrag von Hand erfassen"                                                                                                                                                                                |
| a municipality the newsroom covers                | „Gemeinden" → „Gemeinde hinzufügen" — aus dem Verzeichnis, oder ausserkantonal neu erfasst (Name, BFS-Nummer, Bezirk)                                                                                                                    |
| which municipalities a weekly paper covers        | „Gemeinden" → die Karte → „Zuordnung ändern"; ein NEUES Blatt weiterhin im Reiter „Wochenblätter"                                                                                                                                        |
| a new environment variable                        | `apps/directus/.env.example` **and** root `.env.example` **and** docker-compose.yml                                                                                                                                                      |

A change that spans both apps starts in `apps/directus` — data model first, then the
GraphQL documents in the frontend.

## Cross-cutting conventions

- **Formatter**: Prettier — no semicolons, single quotes, no trailing commas, 2-space
  indent, 110 columns. Enforced by a **root** Husky + lint-staged pre-commit hook
  across the whole tree.
- **No ESLint.** Prettier plus `tsc --noEmit` (`npm run typecheck`) is the gate.
- **TypeScript strict mode** everywhere, plus `noUncheckedIndexedAccess`.
- **UI labels in German, code and comments in English.** Error messages that reach a
  browser are UI labels — German.
- **Node 22.x**, package manager `npm`, in both apps.
- **Tests by default for new logic.** Vitest in the extension bundle, Jest +
  Testing Library in the frontend. Both are wired and run in CI. Skip only with a
  concrete reason (thin glue, framework plumbing, purely cosmetic). Put the rule in
  a pure function next to the wiring and test that — the pattern is everywhere in
  the example feature.
- **Secrets live in the backend.** The frontend holds no API key and no service
  token; it acts as the signed-in user. See [apps/front/CLAUDE.md](apps/front/CLAUDE.md).
- **Keep the CLAUDE.md files current.** After landing a change, update this file
  and/or the app's when the change affects something a future agent would rely on —
  new endpoint, collection, command, env var, pattern, or a fact that is now wrong.
  Skip it for routine fixes, refactors that don't change shape, dependency bumps and
  copy tweaks. When in doubt: would the next agent be misled by the current text?

## Running it

**Everything in Docker** (what deploys, one command):

```bash
cp .env.example .env         # then put your ANTHROPIC_API_KEY in it
docker compose up --build    # or: npm run up
```

**Local development** (fast feedback, three terminals):

```bash
cd apps/directus/extensions/app && npm run dev   # 1. watch-rebuild the bundle — start first
cd apps/directus && npm run dev                  # 2. Postgres in Docker + Directus on the host
cd apps/front && npm run dev                     # 3. Next dev server
```

Start the extension watcher **before** Directus: Directus refuses to start without a
built bundle, and without the watcher your changes are never picked up.

- Frontend: http://localhost:3000
- Directus admin: http://localhost:8055 — `admin@wepublish.ch` / `admin123`

## How the pipeline hangs together

```
Flow "Portal inventarisieren"  (0 */2 * * *)
  └─ operations/portal-inventur   walks statistik.bl.ch once, page by page
       ├─ Gemeindetabelle?  → against our own 87 names, no model
       ├─ in data.bl.ch?    ┐ 1× Sonnet, both catalogues in the cached prefix
       └─ in der Agenda?    ┘ yes to either → never polled

Flow "Quellen taeglich pruefen"  (0 6 * * *)
  └─ operations/quellen-pruefen
       ├─ portal_bereiche → "Letzte Änderung" of the watched branches only
       ├─ shared/statbl/  → registered tables: is there a new year?
       │                    if so the dataset reopens and the run inherits
       │                    datensaetze.standard_vorgabe — the memory
       ├─ shared/ods/     → data.bl.ch catalogue: what changed?
       ├─ shared/agenda/  → the office's agenda: what is coming?
       │                    writes datensaetze + ankuendigungen
       └─ agenda/zuordnung  1× Sonnet per published agenda entry:
                            which portal datasets is this? (catalogue cached)
                            Where the entry links one of the office's web
                            articles, that article is read first
                            (shared/agenda/artikel.ts) and goes into the user
                            turn — three words of agenda title against 188
                            catalogue titles is a coin toss between the three
                            housing datasets, the article says what was
                            counted. It also answers with a LIST: a topic
                            routinely spans several datasets, they all get
                            `datensaetze.ankuendigung`, and the timeline then
                            shows the topic once instead of the same thing
                            three times.

editor marks a dataset relevant  ─────────────┐
  or, from the agenda: picks the dataset       │
  and types an Auftrag for the run  ───────────┤
                                              ▼
Flow "Meldungen erzeugen"  (*/2)   endpoints/redaktion  (immediately)
  └─ operations/redaktion-abarbeiten      └─ same drain(), single-flight
       └─ redaktion/drain.ts
            ├─ eroeffneLaeufe   one run per dataset+period
            ├─ stage A          1× Opus  → briefing for the whole run
            │                    laeufe.vorgabe steers it; earlier periods are
            │                    fetched only when a vorgabe asks for them
            └─ stage B          N× Sonnet → one article per municipality
                                 cached system prompt, checked afterwards

hooks/meldung-status   guards every status change, on every write path

Both scheduled scrapes can also be started by hand: the button in the
„Gemeinden" tab (POST /redaktion/quellen/lauf, 202 + detached, single-flight,
GET for the status) runs the same two operation handlers with the committed
Flows' options — a button press and a nightly run are indistinguishable.
Waste calendars are deliberately absent: those are registered one PDF at a
time by an editor.

Flow "Wochenblaetter pruefen"  (0 9 * * *)
  └─ operations/wochenblatt-pruefen   per registered paper: read the archive
       ├─ waehleNeueAusgaben   at most ONE new issue per paper per run; a
       │                       first-ever run takes exactly the newest entry
       │                       (backlog ignored forever, that was the deal)
       ├─ PDF → Directus Files, text layer via unpdf → volltext + seiten
       └─ 1× Opus per issue → CANDIDATES (exclusive journalism only), steered
          by lernDigest: the newsroom's last ~20 take/reject decisions of
          THIS paper, as few-shot examples in the user turn

editor takes a candidate over ── POST /redaktion/kandidaten/:id/meldung
  └─ 1× Sonnet over the handed fact summary → short Meldung in own words,
     in-text attribution enforced (check + one retry), source line with
     #page=N appended by code, 8-gram overlap check against the issue's own
     text — then the normal review/chat/publish workflow. Rejection asks for
     the reason; the Perle question is NOT asked here — the chief editor
     answers it on the candidate (POST /redaktion/kandidaten/:id/perle),
     whether or not a Meldung exists. Every decision teaches the next
     inventory.

Flow "Amtsblatt pruefen"  (0 7 * * *)
  └─ operations/amtsblatt-pruefen   je aktive Gemeinde, sequenziell
       ├─ municipalityId=<BFS>        Ort-gebunden: Baugesuche, Planauflagen,
       │                              Verkehr, Grundbuch, Behoerdenbeschluesse
       ├─ municipalityZipCodes=<PLZ>  Adress-gebunden: Handelsregister,
       │                              Konkurse, Betreibungen — DISJUNKT zum
       │                              ersten, beide braucht es
       ├─ 1× Sonnet je Gemeinde  → Sichtung: was lohnt einen Blick?
       │                           sortiert, filtert nie; die letzten ~20
       │                           Entscheide DIESER Gemeinde als Beispiele
       └─ je Vorschlag: Einzel-XML (Angaben, Frist, Personennamen) und, wo
          BL Plaene auflegt, 1× Opus über die Planblätter als Bilder
          → planbefunde, jeder mit seinem Blatt

editor takes a publication over ── POST /redaktion/amtsblatt/:id/meldung
  └─ 1× Sonnet über die Angaben + Planbefunde → kurze Meldung; Attribution
     erzwungen (Prüfung + ein Nachfassen), zwei gebaute Links (amtliches PDF
     und die Unterlagen), absolute Fristen, Privatpersonen ungenannt.
     Ablehnen mit Grund und Weiterreichen an die Chefredaktion lehren die
     nächste Sichtung. „Unterlagen lesen" holt die Pläne für jede andere
     Zeile nach — 202 + detached, Fortschritt als plan_status.

Flow "Sportresultate holen"  (0 30 6 * * *)
  └─ operations/sportresultate-holen   dispatches on vereine.quelle
       ├─ fvnws        1 request for ALL football clubs (the "what's on" page)
       │                 ├─ istInteressant()  drops Nachwuchs, Senioren, Test-
       │                 │                    spiele — 39 on one club page, 4
       │                 │                    worth reporting
       │                 └─ ordneVereinZu()   against our own vereine, no model
       ├─ swissvolley  1 request PER TEAM (vereine.ergebnis_url)
       ├─ handball     1 request PER TEAM — the friendliest source: every row
       │                 prints a real ISO instant, so no month names and no
       │                 timezone arithmetic. But an unplayed fixture shows
       │                 "0 - 0", so a score is only read once the match is past.
       ├─ everything else — skipped, and the sports are named in the log
       └─ schreibeSpielberichte()  every new result gets its draft in the SAME
                          run (redaktion/spielberichte.ts, shared with the
                          button): the editor finds a written report, not a
                          fixture to press a button on. Bounded at 10 per pass;
                          a backlog is worked off over several mornings. Where
                          the result is genuinely all we know — no league, no
                          club note, no earlier match — the article shrinks to
                          two or three sentences (`nurDasResultat`), because
                          padding a bare 2:2 can only be done by inventing.

editor registers an Abfuhrkalender (PDF address or file)  ── endpoints/redaktion
  one calendar per municipality+year, one or more DOCUMENTS below it —
  Riehen prints a separate PDF per zone, so its calendar owns two, each with
  its zone label and an editor-written note ("umfasst auch Bettingen") that
  every reminder of that zone states as a fact
  └─ POST /entsorgung/kalender/:id/extrahieren   answers 202, runs detached
       (a dense year grid takes Opus 8–10 minutes — longer than any proxy
       holds a connection; progress lives on the records as status 'liest',
       the workspace polls). Loops the documents,
       1× Opus per document, PDF as a document block → one row per collection
       with its dates (the calendar's own shape), never a flat list of dates
       ├─ weekday-vs-date check   the PDF prints both; a mismatch is flagged
       ├─ deadlines computed      "Montag vor dem Termin" → the actual date
       ├─ regular collections     kept as a note, never as Termine — but their
       │                          HOLIDAY EXCEPTIONS are ("Mittwoch statt
       │                          Freitag" before Christmas is the most useful
       │                          reminder of all)
       └─ per-zone documents      the zone is forced in code; a broken Zone-1
                                  PDF never costs Zone 2 its year
  └─ POST /entsorgung/kalender/:id/meldungen   after the editor confirmed
       answers 202 and runs detached — one model call per newsletter day, so a
       year takes minutes. Progress lives on the record (status 'schreibt'),
       the workspace polls and says so; reloading interrupts nothing. A day
       that already carries a reminder is skipped, and the skip condition is
       the same as the partial unique index (`status <> 'verworfen'`), so a
       second click fills gaps and can never double.
       └─ planeErinnerungen()   anchor = Anmeldeschluss ?? Datum
            → erscheint_am = last newsletter day before it (Mon–Fri, no BS
              holiday); dates sharing a day become ONE Meldung
            → N× Sonnet, one per newsletter day, over handed facts

Flow "Entsorgung publizieren"  (0 5 * * *)
  └─ operations/entsorgung-publizieren   no model call, no outbound request
       ├─ freigegeben ∧ erscheint_am = TOMORROW → publiziert
       │    (the Dorfkönig builds the newsletter the evening before)
       └─ freigegeben ∧ erscheint_am < today → noted as verpasst, NOT published
```

A result becomes an article through `POST /redaktion/spielberichte` — the
"Meldungen erzeugen" button in the Sportresultate tab. It writes one Meldung per
result that has none yet, straight through rather than queued: one model call
over facts already held, so there is nothing to schedule. That also keeps the
statistics queue out of it, since `drain` only picks up rows it marked `geplant`
itself.

Match reports are ordinary `meldungen` — same review, chat, counter-check and
publishing. They carry `spiel` instead of `lauf`, which is why `lauf` is nullable
and the old `unique(lauf, gemeinde)` is now two partial indexes. Waste-collection
reminders are the third kind and carry neither: they are identified by
`erscheint_am`, and their partial unique `(gemeinde, erscheint_am)` is the merge
rule enforced by the database — two reminders in one edition read as noise, so
several collection dates that fall on one newsletter day become one article.

**Reminders are written absolute and never say "morgen".** „Am Freitag (12. Juni 2026) ist Papierabfuhr" is the required form: the Dorfkönig turns it into
"morgen" when it composes the edition, which is why the text is still true in the
archive years later — the five-year rule holding without an exception carved for
it. Two more things the code decides rather than the model: the reminder is timed
to the **registration deadline** where there is one (a Häckseldienst tour booked
by Monday 11.30 is useless as a Tuesday reminder, so it appears the Friday
before), and the other zone's next date is looked up and handed over, never
inferred.

The prompt is handed the outcome, not just the two numbers: working out who won
means knowing which side the club played on, and that is arithmetic the model
must not do. Afterwards every figure in the text is checked against what was
handed over — a stray "Rang 7" is flagged, because a table position is exactly
the kind of number that quietly turns out wrong.

**Only the first team gets a report.** A village club fields four: SC Binningen
played four times on 29 August 2026 — 2. Liga interregional, a 4th-league side,
a 5th-league side and a women's team, and the rows say only „SC Binningen" for
all of them. Three articles about the same club losing 0:2 and 0:12 and winning
7:0 on one Saturday are noise, so `redaktion/mannschaft.ts` keeps the club's
highest league (derived from its own matches, because `vereine.liga` is an
editor's free text — measured values include „3. und 4. Liga" and null). Women's
sides are not reported as the club — **except where the club's registered team
IS one**: Sm'Aesch Pfeffingen plays Nationalliga A der Damen and is the flagship
of Aesch, and a blunt rule would have silenced it. Fixtures are all still stored
and shown; this is only about what gets written.

**Three sports have connectors: football, volleyball, handball.** Basketball,
chess, Schwingen, swimming, American football and curling are recorded as clubs
but no source is read for them, so the tab is legitimately right about football
and empty about basketball at the same time. The run reports the gap in
`ohneKonnektor` rather than looking complete.

Why the others are not built, so nobody repeats the search:

- **Swimming** — `swimrankings.net` and `swiss-swimming.ch` both refuse us; the
  crawler gets 0 bytes even through Playwright. No reachable source.
- **American football** — `safv.ch` responds but publishes no results page.
- **Curling** — the entry is a facility hosting several clubs, not a team.
- **Chess** — `swisschess.ch/…/smm` is a _news feed_ about the championship. It
  names Riehen constantly in prose but carries no fixture table and no link to
  one. Needs a different URL, not a parser.
- **Basketball** — `basketplan.ch` is the best source of the lot: plain `curl`
  works, it is server-rendered, and `POST /exportGames.do` yields Excel and iCal
  from `federationId` + `leagueHoldingId` + a date range. Missing is only which
  league BC Arlesheim plays in.

`spiele.spielnummer` is "the identity at the source", not always a number:
football uses the SFV's Spielnummer, volleyball has none, so the connector
composes `sv-<team>-<heim>-vs-<gast>`. Keyed on the pairing rather than the date
so a postponement updates the fixture instead of cloning it — and the column is
160 wide, because 32 silently swallowed every volleyball insert inside the
per-row error handler.

**The club page is not a result source.** `matchcenter.…/default.aspx?v=<id>`
is the right way to _find_ a club and it does show scores, but it names only the
club's own team — an away row reads "FC Pratteln C1 · 4 · 2" with nothing to say
whether Pratteln won 4:2 or lost 2:4. The "what's on" page names both teams in
playing order and puts the venue at the first-named team's ground, verified by
joining the two on `Spielnummer`. Read results from there, or not at all.

**Five things a change here must not break:**

1. **`buildArtikelSystemPrompt` is byte-identical across a run.** It is what the
   prompt cache carries. Interpolating anything municipality-specific into it is
   invisible in the output and shows up only on the invoice. There is a test.
   `laeufe.vorgabe` belongs in it — it is per run — the municipality's own
   history does not, and goes into the user turn.
2. **Figures are computed per group of like rows, never across.** Dataset 12060
   holds tonnes and kilograms-per-inhabitant in one column; averaging them
   produced a number that went into a draft article as fact. See `kontext.ts`.
3. **A portal page shows its own table only if the navigation says so.** `1_4`
   renders the table of `1_4_5_1` as a preview. Read as data, one statistic was
   registered under four paths and the coverage question was paid for four
   times. `istEigeneSeite` is what tells them apart.
4. **The state machine lives in a hook, not in the endpoints.** An administrator
   can edit a message directly in the admin UI, so a rule checked only where we
   call it is not a rule.
5. **The web article frames, the dataset counts.** `ladeWebartikel` hands the
   office's own prose to the briefing, and it is full of cantonal and district
   figures. Every number in a municipality article still comes from that
   municipality's rows — the briefing prompt says so outright, and the
   percentage check (`zahlen.ts`) is what catches it when it does not.

6. **The source link is built, never written.** Asked for a link without being
   given one, the model produced `<a href="https://www.statistik.bl.ch">` — the
   bare host, the source of nothing. `redaktion/quelle.ts` derives the address
   (the office's web article when the agenda links one, otherwise
   `data.bl.ch/explore/dataset/<id>/` or `statistik.bl.ch/web_portal/<id>`),
   the prompt dictates it, a check reports any other URL, and
   `repariereQuellenlink` forces every anchor onto it before the article is
   stored. A wrong address is the one error a reader can neither see nor check.
   The frontend renders that one anchor through `textStuecke`/`Artikeltext` —
   parsed, never `dangerouslySetInnerHTML`, so nothing else can become markup.

## Where the memory lives

- `laeufe` + `meldungen` of earlier periods — what was published about this
  dataset before, fed back into the briefing and into each municipality's article.
- `datensaetze.standard_vorgabe` — the instruction that made a table worth
  writing about, kept with the dataset. When next year's edition appears, the
  run that opens by itself starts from the same brief instead of a blank one.
- `datensaetze.gemeindefeld` — the municipality column, when an editor names it
  because the portal's metadata does not. Automatic detection stays in charge
  everywhere else; this only fills the gap it leaves.
- `ankuendigungen.datensatz` + `datensaetze.ankuendigung` — which portal datasets
  an agenda entry means, in both directions. The agenda says "Abfallstatistik
  2025", the portal says "Abfallmengen nach Kategorie, Gemeinde und Jahr (seit
  2017)"; a model bridges that once and `zuordnung_geprueft` stops it from being
  asked again. `ankuendigungen.datensatz` is the PRIMARY one — the "Meldungen
  erzeugen" button — while `datensaetze.ankuendigung` marks every dataset of the
  topic, because a publication routinely spans several ("Bau- und
  Wohnbaustatistik" is the new flats and the housing stock). **The agenda has
  priority in the timeline:** a dataset carrying an `ankuendigung` is not shown
  again on its own, and the entry's date rises to its newest dataset's
  `daten_stand`, so the topic sits where its numbers are rather than at the
  announcement's date weeks earlier.
- `redaktionswissen` — durable rules distilled from the editor's chat by a small
  classification call. Scoped to a dataset, a source or globally, and visible in
  the workspace so a wrong one can be switched off.
- `vereine` — which clubs speak for a municipality, and why. Recorded from the
  Gemeinden tab through `POST /redaktion/vereine`, whose one rule with teeth is
  that `swissvolley` and `handball` need an `ergebnis_url`: those two are read
  one request per team, and without it the morning run skips the club with a log
  line nobody reads. `bedeutung` splits
  them the way the newsroom does: `aushaengeschild` carries regional reach,
  `breitensport` is the village itself, and that changes how a result is framed.
  `notiz` holds the editor's own reasoning and belongs in the **user turn** of an
  article prompt, never in the cached system prefix — it is per-municipality, and
  interpolating it there would break the byte-identical guarantee. `liga` is a
  snapshot that goes stale every season. Clubs proposed by a connector arrive
  with `zuordnung_geprueft = false`, the same confirm-once pattern as
  `ankuendigungen`.
- `entsorgungskalender.extraktion` + `merkblatt` — what the PDF said and what was
  deliberately discarded as a regular collection. The second half is the one that
  matters later: without it, a category the model dropped by mistake is
  indistinguishable from one the calendar never had.
- `wochenblattkandidaten.entscheid` (uebernommen/abgelehnt/weitergereicht) +
  `ablehnungsgrund`/`ablehnungskommentar` +
  `wochenblattkandidaten.perle` + `wochenblattkandidaten.gemeinde_korrigiert` +
  `recherchehinweise.status`/`kommentar` — the press review's memory IS its
  decision rows: no distillation call, no second store. `lernDigest` renders
  the last ~20 of each signal per paper into the next inventory's user turn —
  take/reject with reasons, handovers to the Chefredaktion (a positive
  signal: good, but verify first), Perle verdicts (on the candidate, null =
  still on her desk, not "no" — counted even when the candidate itself was
  never decided; `meldungen.perle` is only the published mirror), municipality
  corrections, lead verdicts — never into the cached system prefix, and
  deliberately scoped per Blatt: what is a Doublette in Binningen says nothing
  about Muttenz.

- `amtsblattmeldungen.entscheid` + `ablehnungsgrund`/`ablehnungskommentar` —
  the gazette feed's memory is its decision rows too, and scoped PER
  MUNICIPALITY rather than per source: what counts as local news in Riehen says
  little about Dornach. `lernDigest` renders the last ~20 into the next
  triage's user turn, never into the cached prefix. `vorschlag` +
  `vorschlag_begruendung` are the triage's own verdict, and null means "not
  judged" — the row still shows, it simply carries no recommendation.
- `amtsblattmeldungen.planbefunde` + `plan_fazit` — what the building plans
  actually said, each finding with the sheet it was read from. Kept because the
  plans come down when the objection period ends: the link dies, the reading
  outlives it. `gemeinden.plz` belongs here too — it is the key to half the
  feed, and its absence is silent rather than loud.

- `sendungskandidaten.entscheid` + `ablehnungsgrund` — the broadcast feed's
  memory, scoped PER SHOW rather than per municipality: what counts as "only
  mentioned" is a property of how a programme talks, and the two talk very
  differently. `ablehnungsgrund: 'nur_erwaehnt'` is the one that teaches the
  next inventory exactly the distinction its prompt asks it to make. Undecided
  candidates are deleted after seven days (`darfWeg`) — a broadcast is
  perishable — decided ones never.

Both are bounded on purpose: the rules feed the cached prompt prefix, and an
unbounded memory would grow it without limit.

## Deployment

Images are published to GHCR, named after the repository:

- **Staging** — a push to `main` rebuilds only the app whose `apps/<app>/**` changed:
  `ghcr.io/<owner>/<repo>-backend:main`, `ghcr.io/<owner>/<repo>-front:main`.
- **Production** — a `v*` tag builds **both** images in lockstep:
  `…-backend:production` and `…-front:production`.

One reusable builder ([publish-docker-image.yml](.github/workflows/publish-docker-image.yml))
takes a build `context` and image `tags`; the per-app workflows call it with path
filters. [verify.yml](.github/workflows/verify.yml) typechecks, tests and builds both
apps on every push and PR. GitHub only reads workflows at the repo root, so both
apps' pipelines live in `.github/workflows/`.

On a server, deploy the same `docker-compose.yml` with real values in `.env`
(`KEY`, `SECRET`, `DB_PASSWORD`, `ADMIN_PASSWORD`, the public URLs) and a reverse
proxy in front for TLS.

**The actual Dokploy host does not consume the GHCR images at all**: the compose
file builds both apps from source (`build:` contexts), and Dokploy rebuilds and
redeploys the stack from the repository on every push to `main`. A push IS the
deploy — which is also why the GHCR publish workflows failing does not stop a
deploy (measured 2026-09-01: they had been failing at startup since 30.08 —
`GITHUB_TOKEN` capped at `packages: read` by the repo's Actions settings — while
the server kept deploying normally). The images remain the documented path for
any host that pulls instead of builds.

## Things to know before editing

- **Not an npm workspace.** No hoisting, no shared `node_modules`. Always `cd` into
  `apps/directus` or `apps/front` first. The root `npm install` only installs the
  pre-commit tooling — never add app dependencies to the root `package.json`.
- The extension bundle is a **third** npm package with its own `node_modules`:
  `apps/directus/extensions/app`. Its `package-lock.json` is committed and
  `npm run build` installs it with `npm ci` — so a dependency change means running
  `npm install` inside the bundle and committing the lockfile, or the build fails.
- Directus is pinned to **11.x** on purpose. `directus-sync` (schema-as-code) has no
  Directus 12 release, and the bundled `ts-typegen` module declares
  `host: ">= 10.10.0 < 12.0.0"`. Check both before bumping the major.
- The pre-commit hook is installed at the git root (`.husky/`).
- Never commit any `.env`. The root `.env` configures Docker; `apps/directus/.env`
  and `apps/front/.env.local` configure local development.
