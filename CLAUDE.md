# «Die Redaktion» — Monorepo Entry Point

Turns public data into local journalism. Sources are watched for new datasets;
when one arrives with figures per municipality, one article is drafted for each
municipality the newsroom covers. An editor reviews them, revises them by chat,
optionally sends them out to be counter-checked, and publishes. Published
articles are read by a separate downstream system, the **Dorfkönig**, through
the read-only API at `/api/v1/…` (`endpoints/api/`, contract in
[apps/directus/SCHNITTSTELLE.md](apps/directus/SCHNITTSTELLE.md)).

Built from the standalone-AI-application template; the example feature it shipped
with has been removed.

**What makes this project different from a summariser:**

- Articles must still be correct in five years, so relative time references are
  checked, not merely discouraged — see `redaktion/zeitbezug.ts`.
- Every figure is checked against the data it came from. A percentage the model
  worked out for itself is flagged — `redaktion/zahlen.ts`.
- It has a **memory**. When the same statistic reappears next year, last year's
  articles and the rules learned from the editor's chat feed into the new run.
- **Complete, or declared — never a silent sample.** Whatever a model or a
  computed figure works from is either the whole source, or the gap is said out
  loud: as a "(N weitere …)"-line in the prompt, a note on the row, or a plain
  refusal to write. The newsroom's words, after finding a "Kantonsschnitt"
  computed from 400 of 3'524 rows: better to not solve a task and say so than
  to quietly work from a sample — readers live in these municipalities and
  know their numbers. Size caps guard prompts and storage, never arithmetic,
  and a cap that bites must be audible (the audit of 8 September 2026 closed
  every silent one; the pattern to copy is simap's `abgeschnitten`).

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

   | Host                                        | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Adapter                               |
   | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
   | `api.anthropic.com`                         | every LLM call                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `shared/claude.ts`                    |
   | `data.bl.ch`                                | open-data catalogue and records (no auth, documented API)                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `shared/ods/`                         |
   | `data.bs.ch`                                | the same Opendatasoft platform for Basel-Stadt — registered but INACTIVE, so no request is made until a person switches it on. Measured 17.09.2026: identical paths and response shape, 361 datasets against 188, and Riehen and Bettingen are municipalities in its rows, not quarters                                                                                                                                                                                                                    | `shared/ods/`                         |
   | `www.baselland.ch`                          | the publication agenda — announcements the API cannot give — and the office's own web article behind an entry, read once per announcement for the mapping and the briefing                                                                                                                                                                                                                                                                                                                                 | `shared/agenda/`                      |
   | `statistik.bl.ch`                           | tables the open-data portal does not carry                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | `shared/statbl/`                      |
   | `crawler.wepublish.dev`                     | renders sport pages that refuse a plain request, and is the second door for any page a direct read cannot get (since 17.09.2026, see the note on refusals)                                                                                                                                                                                                                                                                                                                                                 | `shared/crawler/`                     |
   | `www.binninger-wochenblatt.ch`              | the first registered weekly-paper archive — one host per Blatt, only archives an editor registered, read once a day                                                                                                                                                                                                                                                                                                                                                                                        | `shared/wochenblatt/`                 |
   | `www.lokalzeitungen.ch`                     | the platform hosting the Riehener Zeitung (and others) — the paper page links the current issue, the issue page links a paywall-free PDF from its title; only that free door is used                                                                                                                                                                                                                                                                                                                       | `shared/wochenblatt/`                 |
   | `www.wochenblatt.ch`                        | the Wochenblatt für das Birseck's e-paper listing — plain links to issuu readers, newest first, the slug carries number and date                                                                                                                                                                                                                                                                                                                                                                           | `shared/wochenblatt/`                 |
   | `issuu.com`                                 | where that Wochenblatt's issues actually live — the reader page yields the `publicationId`, the anonymous `public.reader.download` API (the same call the reader's download button makes, answering only where the publisher enabled downloads) yields a signed S3 address for the original PDF; if the publisher turns it off, the run fails visibly                                                                                                                                                      | `shared/wochenblatt/`                 |
   | `bibo.ch`                                   | the BiBo (Birsigtal-Bote), on Localpoint's CMS — the listing page embeds its issues as JSON, the reader page names the coordinates the PDF address is derived from                                                                                                                                                                                                                                                                                                                                         | `shared/wochenblatt/`                 |
   | `files.localpoint.ch`                       | the BiBo's original PDFs — the same public address the reader's download button opens, no login                                                                                                                                                                                                                                                                                                                                                                                                            | `shared/wochenblatt/`                 |
   | `amtsblattportal.ch`                        | every canton's official gazette plus the federal SHAB, in one documented API — published items need no credentials. The only source that covers the whole newsroom area whatever the canton — Riehen (BS) today, a Solothurn or Aargau municipality the day one is registered                                                                                                                                                                                                                              | `shared/amtsblatt/`                   |
   | `bgauflage.bl.ch`                           | the building plans behind a Baselland permit, as plain images — the same public door the objection period opens, read only for a publication the newsroom acted on                                                                                                                                                                                                                                                                                                                                         | `shared/amtsblatt/`                   |
   | `www.simap.ch`                              | the joint public-procurement platform of the Confederation and the cantons — open search and detail endpoints, no key, a documented OpenAPI spec. Read once a day, anchored on registered procurement-office uuids and our own postcodes, never on municipality names (`simap.ch` without `www` answers 301)                                                                                                                                                                                               | `shared/simap/`                       |
   | `zettelkasten-tuer.raumschiffenterprise.ch` | the REST door of the Zettelkasten, We.Publish's evidence-bound knowledge layer: both Basel gazettes since 2018, every row with the raw fetch it came from and a checksum, plus the canton's own PDF address per publication. Read with a bearer token, one request per gazette row an editor opens, organisations only — the `personen` rubrics never leave this adapter. Off without `ZETTELKASTEN_TOKEN`, and the desk says so                                                                           | `shared/zettelkasten/`                |
   | the We.Publish editor of this medium        | ONE request per entry from the editor: `/external-apps/userinfo` confirms the short-lived token a journalist arrives with and answers with their e-mail and permissions. Never polled, never read on a schedule. Off without `EDITOR_API_URL`, and the door says so (503)                                                                                                                                                                                                                                  | `endpoints/redaktion/editorzugang.ts` |
   | an IMAP mailbox                             | where SMD delivers the two shows' transcript PDFs — one mailbox, two subject filters. Dedup runs against THIS database's own `source_subject`, never the mailbox's seen-flag, so a second deployment reading the same mailbox costs nothing                                                                                                                                                                                                                                                                | `dossiers/mailbox.ts`                 |
   | `api.srgssr.ch`                             | the SRGSSR Audio Metadata API (OAuth2) — resolves a Regionaljournal story to its public MP3. Read with `optionalEnv`: missing credentials fail PER STORY as `resolution_error`, never as a crashed dossier                                                                                                                                                                                                                                                                                                 | `dossiers/srgssr-client.ts`           |
   | `telebasel.ch`                              | two plain GETs per punkt6 episode — `robots.txt` allows `/sendungen/`, and the episode page carries one schema.org `Clip` per Beitrag with exact start/end seconds, so no model is needed to find the boundaries                                                                                                                                                                                                                                                                                           | `punkt6/telebasel-client.ts`          |
   | `swiss.basketball`                          | the association's own mirror of Basketplan — `/basketplan/showLeagueSchedule.do?…&xmlView=rss` answers one `<GameRSS>` per match, and its `robots.txt` allows everything. The ORIGINAL, `basketplan.ch`, bars us with a blanket `Disallow: /` on both hosts and documents no API (measured 17.09.2026), so that door stays shut and the code refuses it. One request per GROUP, once a day. `referees` is dropped at the parser's boundary and `findTeamById.do` is never called: both carry personal data | `shared/basketplan/`                  |
   | the municipalities' own websites            | one host per municipality, only the news page an editor registered (`gemeinden.news_url`), the detail pages it links and the same-site PDFs behind them — read once a day at 13:00, sequentially, the host's `robots.txt` honoured (crawl-delay, disallowed paths), a 429 raises that host's spacing for the rest of the run, never a redirect onto another site. Measured on the first nine: four CMS families, no bot wall                                                                               | `shared/gemeindeseite/`               |
   | `www.euroairport.com`                       | the ILS-33 usage statistics: how many of a month's landings came in over the south (runway 33) — one HTML overview page and one PDF per month, text layer, no auth. `robots.txt` bars `/admin/`, `/core/`, `/profiles/`, `/search/`, `/user/…` and the facet parameters; neither `/de/publikationen/` nor `/sites/default/files/` is among them, and there is no bot check. One request a day plus one per new month                                                                                       | `shared/euroairport/`                 |

   The crawler is the one host we do not own the other end of, and it exists for
   a measured reason: the football association's Match Center answers `curl`
   with 403 and builds its tables in the browser, and Swiss Volley's Game Center
   streams its fixtures over RSC — its raw HTML holds the club name and nothing
   else. The service runs a real browser and returns Markdown. We identify
   ourselves, read only pages an editor registered against a club, and read each
   once a day. Since 17 September 2026 it is also the second door for any page a
   direct read cannot get — see the note on refusals below. `CRAWLER_KEY` empty
   means the sport features stay quiet and that door stays shut; nothing else
   notices.

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

   The workspace has nine WORKBENCHES and a gear: **statistik.bl ·
   Sportresultate · Entsorgung · Wochenblätter · Amtsblatt · Gemeindeseiten ·
   Regionaljournal · punkt6 · Chefredaktion**, with **Gemeinden** and **Gelerntes** behind the
   settings gear at the end of the row. Every tab up there is a desk with a
   task; the two behind the gear are configuration. The **Blog** is neither —
   it is the result of all the others — so it hangs on two small links in the
   header instead: one opens it in-app for editing, one opens the public page.
   **The blog also has a THIRD reader, and it is a program.** The Dorfkönig
   fetches the published articles from `/api/v1/…` (`endpoints/api/`, convention
   `wepublish-rest/1`, contract in `apps/directus/SCHNITTSTELLE.md`). Three
   things are worth knowing before touching it. It is an extension rather than
   Directus' own `/items` door because the three fields a consumer needs are
   NOT columns: the municipality's slug (only the frontend had one), the rubrik
   (visible solely in which of five foreign keys is set) and the source (stored
   differently by every desk). `datengrundlage` is read for the source and
   never delivered — for a statistics article it holds the municipality's whole
   period slice as working material (measured slices run 50–100 rows). And the register in `endpoints/api/register.ts` drives the
   router AND the documentation, so a route cannot exist undocumented; the
   tests compare both directions. The switch `BLOG_API_OFFEN` is deliberate
   rather than a fallback: unset means the content paths answer 503 and the
   health says which of the two reasons it is.
   Measured while building it: statistics articles often carry NO source line
   in their text at all, so the address is derived from the dataset behind the
   run with the same `quellenlink()` the newsroom's own check uses — fishing it
   out of the prose returned null for every real article.
   Since 15 September 2026 every article also carries its **Prüfsiegel** and
   the **`medium`** the instance speaks for, and a RETRACTION is a message of
   its own (`/api/v1/korrekturen`). Three things about that are worth keeping.
   The seal is COMPUTED, never stored: the warnings, the counter-check, the
   signature and the provenance all lie in the row already, and a stored copy
   would go stale the moment a revision rewrote the text. `sortiereWarnungen`
   splits the one warning column by the check that wrote it, matching the
   exact wordings the writers build from (`redaktion/warnungen.ts`, the one
   place those faces live now) — an unknown warning lands under `weitere`,
   visible and uncategorised, never dropped. And the warnings themselves are
   German prose for the editor: they leave unchanged, a consumer SHOWS them
   and never reads a number back out of one. `medium` is added in `routen.ts`
   rather than in the pure projection, because it belongs to the instance and
   not to the row; unset means `unbenannt` and the door stays open
   (`CRAWLER_KEY`'s pattern). `/korrekturen` carries no `text` — what was
   pulled back does not leave the house a second time — and it reports only
   what `zurueckgezogen_am` actually stamps, so retractions from before that
   field existed are absent rather than dated by guess.
   The tab values are NAMES, not indices (`reiter === 'amtsblatt'`): the order
   was renumbered twice, and each time every `reiter === N` had to move with it. „Sportresultate" is the second feed and works
   the same way as the first: a source that publishes on its own schedule, watched
   daily. What differs is the shape — a statistic arrives once a year for every
   municipality at once, a match arrives every weekend for one club. Filterable
   by Gemeinde and Sportart, in THREE sections (`ordneSpiele`): the last five
   days' results with their reports standing OPEN on the page — a report is a
   short notice now, and hiding one behind a click cost six clicks every
   Monday — then everything still open, soonest first, with the played matches
   whose result the source has not yet published on top, because those are
   exactly what an editor is waiting for; then the Spiele-Archiv, where reports
   fold away behind a click again. Gemeinde and the report's status sit as
   chips on the match row beside the sport.
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
   instead of a Meldung. All three decisions are the learning signal, three
   times over: as EXAMPLES (the decided rows of the paper's last three
   issues ride into the next inventory's user turn, with reasons and
   comments, plus a Bilanz that counts what was left lying — undecided
   candidates are marked `verfallen`, never deleted, because "not worth a
   click" is the loudest form of "too many proposals"), as RULES (words —
   a reject comment, a hand-up Begründung, a chat instruction — are
   classified into `redaktionswissen` at once; a bare click only once it
   repeats twice and a model can name the class; see "Where the memory
   lives"), and as ACTION (a rule the editor armed with `wirkung:
   weiterreichen` lets the inventory hand a matching candidate to the
   Chefredaktion by itself — as a lead, marked `automatisch`, reversible with
   „Zurück auf den Tisch", and paused after two rejections in a row).
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
   only source that reaches every covered municipality WHATEVER ITS CANTON:
   the cantonal gazettes and the federal SHAB sit on one portal, so Riehen
   (BS) arrives through the same door as the nine Baselland ones — where the
   statistics portals are cantonal and silent about it. Nothing about that
   stops at the cantonal border: a Solothurn municipality such as Dornach
   would arrive the same way the day an editor registers one, and the
   newsroom covers none today (measured 17.09.2026 against
   `/api/v1/gemeinden`: ten municipalities, nine BL plus Riehen). Read daily at 07:00, two
   requests per municipality (see above), filed into six groups — Bauen,
   Handelsregister, Behörden, Grundbuch, Personen, Öffentliche Beschaffung.
   `personen` is not a topic but a property: those rubrics name private
   individuals, which is what lets one rule cover them all.
   **`beschaffung` is the one group two sources share.** Public procurement
   arrives from simap.ch (`shared/simap/`), collected by the SAME 07:00
   operation rather than a Flow of its own — that is what makes it cheap: its
   rows land in `amtsblattmeldungen` marked `quelle_typ: 'simap'`, so the one
   triage call per municipality judges the gazette's news and the day's
   tenders together at no extra model cost, and the desk, the three decisions
   and the per-municipality memory work on them unchanged. Two queries per
   run: one PER MUNICIPALITY over its registered procurement offices
   (`gemeinden.simap_vergabestellen`), and ONE over all cantons involved,
   matched locally by `gemeinden.plz` — the second is the one that catches
   what the CANTON or the Confederation builds in a covered municipality
   (measured: IWB tunnelling in Binningen, a Wärmenetz in Riehen), which the
   municipality itself never publishes. Basel-Stadt's gazette rubric `OB-BS`
   was moved into this group too, so a BS tender's two arrivals sit side by
   side and the editor rejects one as `doublette` — matching them on titles
   would be guesswork. Facts come at collection time, not on a click (a
   handful a week, and the tender deadline lives only in the detail);
   `plan_status: 'nicht_lesbar'` is what keeps these rows out of the
   plan-reading query and hides the documents button, since simap publishes no
   sheets. **Three things measured on 2 September 2026 and easy to get wrong
   again:** the procurement-office directory names NO canton, so its name
   search returns „Gemeinde Aesch LU" and two Reinach AG offices — every uuid
   in `simap_vergabestellen` was verified through the postcodes of its actual
   publications, and auto-resolution would file another canton's tenders here
   silently; the place-of-performance match must therefore anchor on the
   postcode, never the city name (Reinach AG 5734 vs. Reinach BL 4153);
   and the search REFUSES a filter-only request, which is why the second query
   carries the full `projectSubTypes` list as its quick filter.
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
   returned 24, half of them survey marks). The sheets themselves are bounded
   three ways — count, bytes, and PIXELS: the API takes nothing over 8000 px an
   edge, and scans compress too well for the byte cap to catch that (measured
   on Binningen 0275/2026 — an 8433-px sheet at 2.6 MB failed the whole
   reading with a raw 400). Oversized sheets are LEFT OUT, not resized
   (`shared/amtsblatt/bilder.ts` reads the header, no image codec in the
   bundle), the row keeps the count (`plan_blaetter`), and an article written
   from four of five sheets says so in a code-built Hinweis line under the
   source — the newsroom's rule: fewer sheets is fine, silence about it is not. It pays: a permit titled „4
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
   **The Vorgeschichte** is the one thing on this desk that comes from outside
   the project: what the Zettelkasten (`shared/zettelkasten/`) already holds
   about the same address or the same company, since 2018, both Basel gazettes,
   every row with the raw fetch it came from. Fetched once per proposed row
   after the plan reading (`redaktion/vorgeschichte.ts`, capped at 20 a
   municipality a run), and on demand through
   `POST /redaktion/amtsblatt/:id/vorgeschichte`. What it is: context for the
   editor, collapsed under the row, every entry linking the canton's own PDF.
   What it is NOT: material for a model. It is in no prompt, by decision — a
   model that reads eight years of entries about an address writes about them,
   and then the newsroom has published a dossier nobody checked. The whole
   judgement sits in `suchbegriffFuer`: an address, a parcel or a company is
   asked for, a NAME never, and what is not recognisably an organisation counts
   as a person. Four states are told apart on the row and on screen — never
   asked (`vorgeschichte: null`), nothing to ask (`suche: null`), not connected
   (no `ZETTELKASTEN_TOKEN`), and asked but failed. None of them is shown as
   "nothing found".
   Two things the articles do that nothing else does: they carry TWO built
   links (the official PDF and the documents), and they keep the names of
   natural persons OUT by default — an official publication may name a private
   individual, a piece of journalism decides that for itself, and
   `personenWarnungen` reports it when the model does anyway. A procurement
   article differs in exactly three places, all of them in the same module:
   it names simap.ch rather than a gazette (`quellenName`,
   `attributionsWarnung`), it carries one link instead of two, and it DOES
   name the winning company with its price — a firm is not a private person,
   and `personen` stays empty on those rows so the check cannot fire on it.

   „Gemeindeseiten" is the ninth feed and the FOURTH desk: what a municipality
   publishes on its own website. One address per municipality
   (`gemeinden.news_url`, edited in the Gemeinden card, the first ten seeded by
   `migrations/20260914A`), read daily at 13:00 — the newsroom's fixed time,
   after noon and before two. The reader (`shared/gemeindeseite/`) recognises
   the page's template FROM THE HTML, never from the host — four families cover
   the nine sites (Weblication, i-web with a DataTables archive in one
   attribute, i-web cards, Backslash), an unrecognised page is a loud error on
   the municipality's own status line, and no municipality has code of its own. A page the server cannot get directly is tried through the crawler — the row says „Über den Crawler gelesen", the run's result names the host.
   The item's identity is its normalized list link; every new one is OPENED —
   the detail page, plus up to three same-site PDFs it links, text layer via
   unpdf — and stored whole, every cap declared on the row (`hinweise`,
   `text_abgeschnitten`, `anhaenge[].gelesen`). A first read of a page imports
   the last seven days, never the archive (three sites list their whole
   history on one page); a daily read looks back three days; detail pages per
   host are capped at fifteen and the rest is counted for tomorrow. Dates were
   the measured trap: one list prints the visit date on every entry (the real
   day sits in a month-and-day badge without a year), one `<time datetime>`
   carries the year 2626 on every card, so a date has to be a real
   calendar day no later than next year or it is null — but an OLD date is
   old, not null: an i-web list carries its whole archive, and treating a
   2022 row as undated put 2020 minutes on the desk as news. Undated entries
   are never opened, only named by title in the run's result; a page with
   no dated entry at all reaches the municipality's status line — and the
   DETAIL page's full date beats a badge whose year was inferred. One Sonnet Sichtung per municipality
   and run sorts the new items (titles AND an excerpt — „Aus dem Gemeinderat"
   says nothing), steered by the desk's rules, this municipality's decisions
   and — where an item talks about collections — its Abfuhrkalender: a
   Mitteilung that only repeats dates the calendar already has is no proposal
   (the reminder is the Entsorgung desk's), a cancelled or moved collection is
   one; the cross-check of named days against `entsorgungstermine` is code and
   stands in the prompt as a fact. Three decisions, all learning, under
   `bereich: gemeinde`; the Meldung is written in own words from the whole
   text with mandatory attribution to the municipality, the source line built
   by code names the item's own page (`url_kanonisch ?? url`) and the read
   documents, and the verbatim-overlap check runs against the municipality's
   text — its press release in its words is not our reporting. No
   private-person check: a municipality names its office-holders by design.
   The desk cleans itself (`aufraeumAktion`): unproposed rows go after seven
   days, undecided proposals lapse to `verfallen` after fourteen — news is
   perishable, unlike a permit with a deadline. The Dorfkönig sees these
   articles as `rubrik: gemeinde` with `quelle_url` = the municipality's page
   (SCHNITTSTELLE.md).

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
   **A broadcast has a SHAPE, and the Sichtung has to respect it.** The show
   opens by trailing every topic in one breath („… Das Land zahlt weniger …
   und: temporäre Kunst in Bottmingen"), covers each one at length later, and
   sometimes recaps at the end. So a municipality is typically named THREE
   times, and only the long passage is the story — which is why
   `beitraegeAusEdition` gives every topic its own slice of the transcript
   (`beitraegeAusPunkt6` always did). Handing the main contribution the whole
   text instead judged every „Ausserdem" topic twice: measured on 22
   candidates, SIX were duplicate pairs, and the copy from the full text
   carried no timestamp, so it pointed at no passage at all. The main
   contribution keeps everything the topics do not claim — that is where the
   stories the show never listed live, and they are worth real money (Tempo 30
   in Münchenstein, the Muttenz tram rebuild, the southern approach flights
   over Allschwil had no topic entry of their own). The trailed sentence stays
   there too, and the prompt's „HANDELT von" versus „ERWAEHNT bloss" is what
   keeps it from becoming a candidate.
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
   Three fixes originated HERE and belong in the sister project as copies.
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
   punkt6 dossiers before anyone noticed. Third: telebasel.ch publishes a
   fresh episode page WITHOUT its schema.org Clip blocks and adds them later
   (measured: the 31.08. page had video but zero `hasPart` ~17h after airing,
   the 30.08. page carried five) — so an episode that resolves with zero
   segments and a broadcast younger than three days keeps its dossier
   'pending' ('wartet' in the result): the edition already shows video and
   transcript, the daily run retries for the markers at no model cost, and the
   municipality Sichtung waits for the real Beiträge instead of judging one
   whole-show blob. After three days the unsegmented edition is final.
   Markers that DO exist are checked against the transcript before they are
   trusted: the web cut can be a DIFFERENT edit than the broadcast (measured
   the same day: an episode titled „31.08." carried next-day stories, one of
   five markers matching — the transcript had no Superblocks, no KSBL, no
   Hollywood). The lead call answers `passt` per Beitrag, and when most
   slices do not fit their headline the segmentation is rejected wholesale
   (`resolveBeitraege`) — confidently wrong chapter titles with wrong jump
   marks are worse than none. Rejection happens only on the model's explicit
   word; a failed lead call degrades to "no leads", never to "no
   segmentation". The daily retry resolves BY DATE from the archive page, so
   an episode re-published under a new id is found automatically. The
   Sichtung itself (`redaktion/sendunglauf.ts`, this project's own code) now
   diffs on reprocessing like the press review: an edition's OPEN candidates
   are replaced, decided ones stay and are never re-asked.
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
   **The Regionaljournal has a SECOND consumer, and it is a program in a
   hurry.** Sokrates — the AI helping the newsroom formulate the „Frage des
   Tages" — needs the day's broadcast UNREVIEWED and fast: the transcript mail
   lands around 14:32, so the Flow „Regionaljournal holen und verarbeiten"
   runs at 14:35 (with free idempotent retries at 14:42/14:49 and an evening
   pass — ingest dedupes on `source_subject`) and chains processing directly
   after the ingest in the same Flow. What it produces is served by
   `endpoints/sokrates/` (`GET /sokrates/sendungen`): each Sendung prepared as
   the same Abschnitte the Sichtung judges (`beitraegeAusEdition`, honest
   `nur_zusammenfassung` labels included) plus the WHOLE transcript. Nothing
   is published by serving it, and unreviewed content still never reaches the
   Dorfkönig API — this door is separate, non-public, and gated by
   `SOKRATES_API_KEY` in the `X-Sokrates-Key` header (unset → 503, wrong →
   401, compared timing-safe). NOT `Authorization`: that header belongs to
   Directus, whose auth middleware rejects a foreign Bearer token before any
   custom endpoint runs — measured on the running instance.

   „Gemeinden" is a flat, searchable list — not grouped by district. The
   districts were dropped because they hid what they organised: Riehen, the
   first municipality outside the five Basel-Landschaft districts, arrived as
   its own collapsed one-item accordion and was simply overlooked. Each active
   municipality also carries its own card: WHICH statistics portal serves it,
   read from the registered sources rather than from a district set in the
   code (the portals are cantonal, and `quellen.konfiguration.bezirke` says
   which `gemeinden.bezirk` values each one carries — an out-of-canton
   municipality like Riehen gets sport, waste and the press review, and the
   card names the gap on the statistics side outright instead of letting an
   editor wait; a portal that declares no districts is shown as serving none,
   because silence is not a promise), its `vereine` with
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

   **The SÜDANFLUG-QUOTE is the fourth thing in that list, and deliberately not
   a tenth tab.** The EuroAirport publishes one PDF a month saying how many of
   the month's IFR landings came in over the south — over runway 33, and
   therefore over Binningen and Allschwil, where it is the summer's standing
   argument. It is a statistic like the others, only from a different office,
   so it shares the desk: one row per month, dated by the sheet's own „Stand",
   a chip when a threshold was CROSSED, and below it one „Meldung erzeugen"
   button per affected municipality that turns into the article's card once it
   exists (`shared/euroairport/`, `redaktion/suedanflug.ts`). Nine things are
   worth knowing before touching it.
   **The reading is deterministic — no model touches the figure.** The 43,7
   percent the Binninger Wochenblatt printed for July 2026 stands in the PDF as
   `TOTAL 3778 1652 43,7%`, and that is the whole extraction.
   **Month and year come from the table cell, never from the file name.** The
   July 2023 sheet is called `…_2023_Juillet.pdf` and carries no month number
   at all; the August 2026 sheet sits in the upload folder `2026/09`. The
   addresses are read off the overview page and never guessed.
   **Three measured peculiarities, each with a consequence.** The figures stay
   provisional for ever (December 2025, updated 30 January 2026, still says
   „Provisorische Zahlen"), which is why the revision watchdog has a third case
   here and why every article has to SAY it is provisional — there is a check.
   The source contradicts itself (7 August 2026: 130 south landings on 128
   approaches, 101,6 percent, printed that way), which is reported as a Befund
   on the row and never smoothed. And a dash is not a missing value but no
   south landing, so those days count as zero.
   **The text layer does NOT come from `shared/pdf-text.ts`.** That module
   splits every page at `pageWidth/2` for the two-column SMD dossiers it was
   written for; this sheet is one landscape table 841.8 pt wide, and the split
   at 420.9 pt cut the quota and the Uhrzeit off all 31 day lines (measured).
   `extrahiereText` from `shared/wochenblatt` — the press review's, reused by
   the municipal-pages reader — takes pdfjs from the same single `unpdf` copy
   and returns the table intact. A test runs it against the real PDF.
   **The run is frugal and its cap is audible:** the overview once a day, and a
   month's PDF only when the month is new or its address moved (a re-upload
   lands under a new file name — that is the only signal the source gives).
   Twelve sheets per run, newest first, the rest named in the result.
   **The thresholds live in `quellen.konfiguration`,** not in the code and not
   in the prompt: `{monatsschwelle: 40, jahresschwellen: [8, 10]}`. 40 percent
   in a month is the NEWSROOM's threshold (Jolanda's word); 8 and 10 percent
   over the year are the runway-use agreement of 10 February 2006, and an
   article says whose each one is. The year thresholds propose only when they
   are CROSSED, because the canton's year has run above 10 percent every year
   the Schutzverband published (2022: 11,48; 2023: 13,79; 2024: 13,42) and a
   proposal on „is above" would fire every month for ever.
   **Who is affected is `gemeinden.suedanflug`,** maintained by hand like
   `plz`: the airport publishes one quota for itself and no breakdown by place.
   Empty means the row still appears and says so rather than showing a button
   into nothing.
   **The place rule is a CHECK, not only a prompt line, and it is the most
   important one here.** „In Binningen lag die Quote bei 43,7 Prozent" is
   fluent, plausible and false, and no reader can tell — the quota belongs to
   the airport. `ortsWarnungen` catches the locative, „für/von" and the
   genitive, each only inside a sentence that also carries a figure; the
   correct form („43,7 Prozent aller Landungen erfolgten über den Süden, also
   über Binningen") uses none of them.
   **No Meldung without a person's click.** A crossed threshold is a mark on
   the row, and the run makes no model call at all.

   When it turns us away, that is not silence: the workspace shows a banner
   naming the source, the reason and the date of the last attempt, with a link
   to the page and a form to type the entry in by hand
   (`POST /redaktion/ankuendigungen`, which updates an existing announcement
   rather than adding a second one). An absence is otherwise
   indistinguishable from "nothing was published".

   **A refusal is accepted — and the crawler is tried anyway.** Cloudflare
   fingerprints the TLS handshake, not just the User-Agent — measured on this
   host, `curl` gets through where Node's `undici` is refused with the
   identical header. We do not fake a browser or a fingerprint: if a host turns
   away our identified client, that is its answer. But since 17 September 2026
   the same page is ALSO tried through we.publish's crawler wherever a direct
   read fails (timeout, dead socket, 403, 429, 5xx) — the newsroom's decision
   after pratteln.ch answered the server with timeouts for two days while the
   same page loaded from anywhere else. The crawler is a separate we.publish
   product with its own rules and, for some sites, its own agreements with the
   publishers; those are not this project's, it stays a helper, and every page
   it delivered says so on the row („Über den Crawler gelesen") and in the
   run's result (`shared/crawler/fallback.ts`). Pages and text files only: a
   PDF comes back from it as escaped text (measured), so documents stay direct
   and a host that refuses those too leaves a declared gap. The agenda host
   keeps its hand-entry form either way. Every page reader goes through it: the
   Gemeindeseiten reader with its own protocol, and the agenda, statistik.bl,
   the Wochenblatt archives, the Amtsblatt's plan pages and telebasel through
   `fetchMitZweiterTuer` — a fetch with the door built in, handed to readers as
   their `fetchImpl` — while each run declares the hosts it needed
   (`ueberCrawler`, read from a process-wide record by the run's own window).
   Data APIs, documents and images never take the door (`fuerZweiteTuer`).

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

| The change is…                                      | Goes to                                                                                                                                                                                                                                                                            |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| a new collection, field, relation or role           | Directus admin UI, then `npm run schema:dump` — [apps/directus](apps/directus/)                                                                                                                                                                                                    |
| a calculation, validation or business rule          | extension bundle (endpoint or hook)                                                                                                                                                                                                                                                |
| anything that calls Claude                          | extension bundle, via `shared/claude.ts`                                                                                                                                                                                                                                           |
| something that must run nightly/hourly              | Flow with a Schedule trigger + a custom operation in the bundle                                                                                                                                                                                                                    |
| a screen, a form, a list, a chart                   | [apps/front](apps/front/) — MUI components, Apollo for data                                                                                                                                                                                                                        |
| a new query the UI needs                            | `apps/front/src/graphql/*.ts`                                                                                                                                                                                                                                                      |
| a new rule about what an article may say            | the prompt in `redaktion/prompt.ts` **and** a check next to it — a prompt is a request, a check is a rule (`zeitbezug.ts`, `zahlen.ts`, `attribution.ts`, `quelle.ts`)                                                                                                             |
| a table on statistik.bl.ch the newsroom wants       | paste its URL in the workspace — „statistik.bl" → „Auftrag …" — it becomes an ordinary dataset                                                                                                                                                                                     |
| a club whose results the newsroom wants             | „Gemeinden" → die Karte der Gemeinde → „Verein erfassen"; ohne Konnektor für die `quelle` bleibt er still erfasst. Bei `basketball` die Adresse der GRUPPE (`…/basketplan/showLeagueSchedule.do?…&leagueHoldingId=<n>`) plus die `teamId` als Kennung — und beides jede Saison neu |
| a new rule about what a match report may say        | `redaktion/spielbericht.ts` — the prompt **and** the check next to it                                                                                                                                                                                                              |
| which of a club's teams is followed at all          | `redaktion/mannschaft.ts` — the first team only, applied at the door by `sportresultate-holen`; mirrored in the workspace (`berichtenswerteSpiele`)                                                                                                                                |
| where a match report's source link comes from       | `redaktion/spielbericht.ts` — `verbandsQuelle`/`mitQuelle`, appended by code; the publish gate is `hatQuellenlink` in `redaktion/status.ts`                                                                                                                                        |
| an Abfuhrkalender the newsroom wants                | paste the PDF's address in the workspace — „Entsorgung" → „Abfuhrkalender erfassen"; one PDF per zone (Riehen) registers zone by zone into the same calendar                                                                                                                       |
| a weekly paper the newsroom wants read              | „Presseschau" → „Wochenblatt erfassen" with its archive URL; the platform decides the parser (`konnektor`: WordPress-Archivliste, lokalzeitungen.ch, issuu or Localpoint) — a fifth platform gets its own value in `shared/wochenblatt/`                                           |
| a new rule about what a press review may say        | `redaktion/presseschau.ts` — the prompt **and** the checks next to it (attribution, digits, verbatim overlap)                                                                                                                                                                      |
| a new rule about what a gazette article may say     | `redaktion/amtsblatt.ts` — the prompt **and** the checks (attribution, digits, absolute dates, no private names)                                                                                                                                                                   |
| a new rule about what a broadcast Meldung may say   | `redaktion/sendung.ts` — the prompt **and** the checks (attribution per show, digits, verbatim overlap against the transcript)                                                                                                                                                     |
| which names a broadcast is scanned for              | nothing — `gemeindeTreffer` uses the active `gemeinden` rows, so adding a municipality adds it to the scan                                                                                                                                                                         |
| which gazette rubrics reach the desk                | `GRUPPE_JE_UNTERRUBRIK`/`GRUPPE_JE_RUBRIK` in `shared/amtsblatt/parse.ts` — sub-rubric first, rubric second; an unmapped rubric is dropped, never guessed                                                                                                                          |
| a municipality's postcodes                          | „Gemeinden" → die Karte → Abschnitt „Amtsblatt"; ohne sie bleiben Handelsregister, Konkurse und Betreibungen dieser Gemeinde unsichtbar — und die Beschaffungen, die andere in ihr ausschreiben                                                                                    |
| a municipality's procurement offices on simap.ch    | `gemeinden.simap_vergabestellen` (JSON, Admin-UI) — die uuid aus `/procoffices/v1/po/public`, aber ERST gegen die PLZ ihrer Publikationen prüfen: das Verzeichnis nennt keinen Kanton. Leer heisst nicht blind, nur „keine eigenen"                                                |
| a new rule about what a procurement article says    | `redaktion/amtsblatt.ts` — derselbe Prompt und dieselben Checks, mit `quelleTyp: 'simap'` als Verzweigung für Attribution und Quellenzeile                                                                                                                                         |
| a new rule about what a reminder may say            | `redaktion/erinnerung.ts` — the prompt **and** the check next to it                                                                                                                                                                                                                |
| a one-off data repair or backfill                   | rows only: a one-shot Flow, else `apps/directus/migrations/*.mts` as a last resort                                                                                                                                                                                                 |
| a rule about what a desk proposes or how it writes  | say it — in the reject comment, the hand-up Begründung, the chat, or „Gelerntes" → „Regel erfassen"; it lands in `redaktionswissen` with `bereich` + `stufe`. Code: `redaktion/gedaechtnis.ts` (store), `redaktion/lernen.ts` (rules)                                              |
| the news page of a municipality's own website       | „Gemeinden" → die Karte → Abschnitt „Gemeindeseite" (the endpoint reads the page BEFORE it writes — a wrong address fails the form, not tomorrow's run); leer heisst: keine Mitteilungen von dieser Gemeinde                                                                       |
| a new rule about what a municipal-news Meldung says | `redaktion/gemeindeseite.ts` — the prompt **and** the checks (attribution to the Gemeinde, digits, absolute dates, no self-written links, verbatim overlap against the municipality's text)                                                                                        |
| a fifth CMS family among the municipal websites     | `shared/gemeindeseite/erkennung.ts` (fingerprint) + one list parser in `liste.ts` and one detail parser in `detail.ts`, each with a saved fixture — never a host name                                                                                                              |
| an agenda entry the crawler could not fetch         | the banner in the workspace → „Eintrag von Hand erfassen"                                                                                                                                                                                                                          |
| a municipality the newsroom covers                  | „Gemeinden" → „Gemeinde hinzufügen" — aus dem Verzeichnis, oder ausserkantonal neu erfasst (Name, BFS-Nummer, Bezirk)                                                                                                                                                              |
| which municipalities a weekly paper covers          | „Gemeinden" → die Karte → „Zuordnung ändern"; ein NEUES Blatt weiterhin im Reiter „Wochenblätter"                                                                                                                                                                                  |
| a change to what the Dorfkönig reads                | `endpoints/api/` in the bundle — the register drives the routes AND the docs; contract in [apps/directus/SCHNITTSTELLE.md](apps/directus/SCHNITTSTELLE.md)                                                                                                                         |
| who may enter from the We.Publish editor            | `redaktion/editorzugang.ts` — `rolleFuer` (which editor permission opens the door) and `pruefeToken` (whose token is accepted); the Directus user itself is created by hand in the admin UI, never here                                                                            |
| a second medium, or a second statistics portal      | [apps/directus/MEDIUM_ANLEGEN.md](apps/directus/MEDIUM_ANLEGEN.md) — a portal is a ROW in `quellen` (`basis_url` + `konfiguration`), never a constant and never an environment variable                                                                                            |
| which municipalities lie under the south approach   | „Gemeinden" → die Karte → `gemeinden.suedanflug`; die Quote gilt für den FLUGHAFEN, wer betroffen ist, entscheidet die Redaktion. Leer heisst: die Monatszeile steht da und sagt, dass niemand erfasst ist                                                                         |
| the thresholds of the Südanflug-Quote               | `quellen.konfiguration` der EuroAirport-Zeile (`{monatsschwelle, jahresschwellen}`) — 40 Prozent im Monat ist die Schwelle der Redaktion, 8 und 10 im Jahr die der Pistenbenutzungsvereinbarung von 2006                                                                           |
| a new rule about what a Südanflug-Meldung may say   | `redaktion/suedanflug.ts` — the prompt **and** the checks (Ortsregel, Provisorik, Attribution an den EuroAirport, Ziffern, absolute Daten, keine selbst geschriebenen Links)                                                                                                       |
| a new environment variable                          | `apps/directus/.env.example` **and** root `.env.example` **and** docker-compose.yml                                                                                                                                                                                                |

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
       ├─ shared/ods/     → the catalogue of EVERY active `ods` source, one
       │                    per portal, each with its own basis_url: what
       │                    changed? A page cap that bites is named in the
       │                    run's hinweise (`katalogKappung`) — the option is
       │                    sized for 188 datasets, data.bs.ch carries 361
       ├─ shared/agenda/  → the office's agenda: what is coming?
       │                    writes datensaetze + ankuendigungen
       ├─ shared/euroairport/ → die ILS-33-Uebersicht: neue Monate, bewegte
       │                    Adressen. Ein PDF je neuem Monat, hoechstens 12,
       │                    neueste zuerst; `bewerteMonat` markiert eine
       │                    gerissene Schwelle als VORSCHLAG (kein Modell).
       │                    Bewegte Zahlen → Revisionswaechter, dritter Fall
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
                                 cached system prompt, checked afterwards.
                                 A REVISION runs DEEP (the newsroom's explicit
                                 decision — an instruction is a deliberate,
                                 expensive step): Opus with adaptive thinking,
                                 a fresh fetch of the run's WHOLE period slice
                                 plus the municipality's complete history, and
                                 the full all-municipalities slice riding in
                                 the per-run cached system prompt
                                 (`buildTiefenSystemPrompt`) so "wie ist der
                                 Elektro-Anteil, verglichen mit den anderen?"
                                 is answerable. Shares and time changes MAY be
                                 computed there — from handed numbers only, and
                                 `ableitbareProzentangaben` pre-computes that
                                 space so every percentage still verifies.
                                 Measured before all this: Binningen's
                                 Motorfahrzeug slice is 56 rows, the prompt
                                 showed 40, "Personenwagen" sorted past the
                                 cut, and the model answered a car question
                                 from the Leichtmotorfahrzeug rows. Stage A
                                 stores the full slice plus the einordnung
                                 computed over ALL rows; the 400-row
                                 `alle_zeilen` sample is GONE — no fallback
                                 recomputes one: a row without a stored
                                 einordnung gets NULL, the prompt says "keine
                                 Vergleichszahlen", and the percentage check
                                 flags every claim.
                                 The same rule holds for the other feeds: a
                                 press-review revision sees the piece's pages,
                                 a broadcast revision the transcript —
                                 the overlap checks keep both in own words.

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
          in the user turn by the desk's RULES (redaktionswissen, numbered
          R1…Rn so an answer can cite one), the Bilanz of the last three
          issues (taken / handed up / rejected / left lying) and the decided
          rows as few-shot examples (lernsignale.ts loads all of it, the
          re-inventory button shares the loader)

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
       ├─ simap.ch VORAB, eigenes try/catch, eigene quellen-Zeile:
       │    ├─ je Gemeinde: issuedByOrganizations=<ihre Vergabestellen>
       │    │               → was sie SELBST ausschreibt und vergibt
       │    ├─ 1× für alle Kantone: orderAddressCantons + alle Untertypen
       │    │               → was ANDERE in ihr bauen, lokal per PLZ zugeordnet
       │    │                 (Kanton/Bund/IWB — publiziert die Gemeinde nie)
       │    └─ je neue Zeile 1 Detail-Abruf → angaben + frist, gleich beim Holen
       ├─ municipalityId=<BFS>        Ort-gebunden: Baugesuche, Planauflagen,
       │                              Verkehr, Grundbuch, Behoerdenbeschluesse
       ├─ municipalityZipCodes=<PLZ>  Adress-gebunden: Handelsregister,
       │                              Konkurse, Betreibungen — DISJUNKT zum
       │                              ersten, beide braucht es
       ├─ 1× Sonnet je Gemeinde  → Sichtung über BEIDE Quellen zusammen:
       │                           was lohnt einen Blick? sortiert, filtert
       │                           nie; die letzten ~20 Entscheide DIESER
       │                           Gemeinde als Beispiele
       └─ je Vorschlag: Einzel-XML (Angaben, Frist, Personennamen) und, wo
          BL Plaene auflegt, 1× Opus über die Planblätter als Bilder
          → planbefunde, jeder mit seinem Blatt
          (simap-Zeilen sind hier aussen vor: plan_status 'nicht_lesbar')

editor takes a publication over ── POST /redaktion/amtsblatt/:id/meldung
  └─ 1× Sonnet über die Angaben + Planbefunde → kurze Meldung; Attribution
     erzwungen (Prüfung + ein Nachfassen), zwei gebaute Links (amtliches PDF
     und die Unterlagen), absolute Fristen, Privatpersonen ungenannt.
     Ablehnen mit Grund und Weiterreichen an die Chefredaktion lehren die
     nächste Sichtung. „Unterlagen lesen" holt die Pläne für jede andere
     Zeile nach — 202 + detached, Fortschritt als plan_status.

Flow "Gemeindeseiten pruefen"  (0 13 * * *)
  └─ operations/gemeindeseiten-pruefen   je aktive Gemeinde mit news_url
       ├─ robots.txt einmal je Host, Pause je Host (robots' Crawl-delay
       │    verlaengert sie), Weiterleitungen nur auf dieselbe Site
       ├─ Uebersicht lesen → Plattform aus dem HTML erkennen → Liste parsen
       │    (unerkannt oder leer = lauter Fehler auf gemeinden.news_letzter_fehler)
       ├─ Fenster: 7 Tage beim ersten Lesen, sonst 3; Identitaet = Listen-Link;
       │    hoechstens 15 Detailseiten je Host, der Rest deklariert
       ├─ je neuem Eintrag: Detailseite (oder das direkt verlinkte PDF) samt bis
       │    zu drei eigenen PDFs (unpdf) → gemeindemitteilungen, Kappungen als
       │    hinweise auf der Zeile
       └─ 1× Sonnet je Gemeinde → Sichtung ueber die NEUEN Eintraege (Titel +
          Auszug): Regeln R1…Rn, Bilanz und Beispiele dieser Gemeinde, und wo
          eine Mitteilung von Abfuhren handelt, der Abfuhrkalender samt
          Abgleich der genannten Tage; sortiert, filtert nie

editor takes a Mitteilung over ── POST /redaktion/gemeindeseiten/:id/meldung
  └─ 1× Sonnet ueber den ganzen Wortlaut + gelesene Anhaenge → kurze Meldung in
     eigenen Worten; Attribution an die Gemeinde erzwungen (Pruefung + ein
     Nachfassen), Ziffern gegen das Material, absolute Daten, keine selbst
     geschriebenen Links, 8-Gramm-Ueberlappung gegen den Gemeindetext;
     Quellenzeile vom Code: die Unterseite der Gemeinde + die gelesenen
     Dokumente. Ablehnen mit Grund und Weiterreichen lehren die naechste
     Sichtung (bereich gemeinde).

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
       ├─ basketball   1 request per GROUP (swiss.basketball, XML), shared by
       │                 every club of that group; ordneBasketballZu() against
       │                 vereine.externe_id (the teamId), no model. An unplayed
       │                 match carries no result attribute at all — not "0".
       ├─ everything else — skipped, and the sports are named in the log
       ├─ ersteMannschaftAbgleich()  je Verein ueber Bestand UND Neues: was
       │                  unter der besten Liga liegt, wird nicht geschrieben —
       │                  und was schon dasteht, geloescht (ausser eine Meldung
       │                  zeigt darauf)
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

Flow "Entsorgung publizieren"  (0 12 * * *)
  └─ operations/entsorgung-publizieren   no model call, no outbound request
       ├─ freigegeben ∧ erscheint_am = TOMORROW → publiziert
       │    (noon on the day before is the newsroom's fixed time; the
       │     Dorfkönig turns the date into "morgen" when it composes the
       │     edition. Approved after noon → the „Jetzt publizieren" button)
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
inferred. **Three rules hold for every calendar, whatever its layout:** at most
one reminder per newsletter day; all collections of one collection DAY are ONE
Termin — in the list and in the facts — whether in the same zone (Altmetall and
Sonderabfall on one Wednesday) or in different ones (Reinach: Kreis West Papier,
Kreis Ost Karton), and the other-zone outlook stays away as soon as that zone
has its own date that day (`andereZoneFuer`, `abfuhrtage`, mirrored by
`termineNachTag` in the frontend); and a zone label covering every zone the
calendar declares is the whole municipality (`entfalteZone` — Allschwil's
"Sektor 1-4" was a fifth zone until it wasn't), while a label for some zones
unfolds into one row per zone and a single real zone stays a zone.

The prompt is handed the outcome, not just the two numbers: working out who won
means knowing which side the club played on, and that is arithmetic the model
must not do. Afterwards every figure in the text is checked against what was
handed over — a stray "Rang 7" is flagged, because a table position is exactly
the kind of number that quietly turns out wrong. A match report is deliberately
a SHORT NOTICE: a title and one paragraph, no lead — `hatInhalt` waives the
lead requirement for `spiel`-Meldungen and for them alone (the three-part
titel/lead/text parser the other feeds re-export lives on as
`parseMeldungstext`).

**A date written out in full is handed material, not arithmetic.** Measured on
the 170 published articles of 15 September 2026, the day after the Prüfsiegel
first made the warnings countable: 23 of the 32 number warnings were the DAY in
an absolute date. A report writes "am 6. September 2026" about an earlier match,
and `frueher` handed over that match's date but only its goals were ever
allowed. So the check quarrelled with the rule it serves, on the one form the
newsroom insists on. The earlier matches' dates now count, and the leading zero
of an ISO date is read away as the gazette desk has always done it.

**The number check learns from the editor.** Digits that arrive inside the
handed facts — the year in a club's name, the pitch number in the venue — are
allowed outright: flagging them taught the editor to ignore the warning. And
publishing a report that still carries a "Zahl … steht nicht in den Angaben"
warning is read as the editor's verdict: the meldung-status hook (an `action`,
after the write — a lost lesson must never block a publish) stores those numbers
in `vereine.akzeptierte_zahlen`, and the check never flags them again for that
club. Per club on purpose, so a wrong acceptance stays on its own desk; deleting
a number from the field turns the warning back on. Relative time references
deliberately do NOT learn — "am Samstag" is wrong afresh every time. But one of
them is not a time reference at all: German writes the adverb "morgen" small and
the noun "Morgen" capital, and a waste reminder saying "am Morgen des
Abfuhrtages" was reported for a rule it kept. `GROSS_IST_SUBSTANTIV` holds the
words whose capitalisation decides that, and at the start of a sentence, where
the capital says nothing, the word is still reported.

**Telegramme: the association's own match report, where it exists.** The Match
Center hangs a small icon next to some results (`…&tg=<id>`); the page behind it
carries scorers with minutes, cards, the event ticker AND the Spielnummer.
Discovery has two paths, cheapest first, and their limits are measured, not
guessed. Where the icon survives the markdown conversion (the "Resultate +
Ranglisten" view), `parseTelegramme` reads teams + score off the row and the
telegram attaches without another request. Where it is a JavaScript handler
(the club's front page — zero anchors in markdown), the FaaS-Crawler's `links`
format (v2.7.0, built for this) still carries the address (measured: 29 tg
links on a club page whose markdown had none), but bare — so those are PROBED:
fetch the page, read the Spielnummer it prints, attach it to the stored fixture
still waiting. The probe is bounded (15 per run, newest id first) and
early-stops on two brakes: no football fixture with a result and without a
telegram inside the last ten days means no request at all, and ids already
attached are never fetched twice. The report writer re-fetches the page and
TRUSTS it only if its printed Spielnummer matches (`parseTelegrammSeite`) —
scorers from the wrong match are worse than none. With a telegram the report
may grow to two paragraphs, its digits are handed material, the telegram page
becomes the source link, and a telegram arriving AFTER the report rewrites the
machine draft (status `entwurf` only — never behind an editor's back). Also
measured: the crawler caps markdown server-side (~96k even with a raised
`max_chars`) and reports it honestly per format — `scrape()` surfaces that as
`abgeschnitten`, and the run says so in `fehler` instead of reading a truncated
day as quiet.

**Only the first team is followed at all.** A village club fields four: SC
Binningen played four times on 29 August 2026 — 2. Liga interregional, a
4th-league side, a 5th-league side and a women's team, and the rows say only
„SC Binningen" for all of them. Three articles about the same club losing 0:2
and 0:12 and winning 7:0 on one Saturday are noise, so `redaktion/mannschaft.ts`
keeps the club's highest league (derived from its own matches, because
`vereine.liga` is an editor's free text — measured values include „3. und 4.
Liga" and null). Women's sides are not the club — **except where the club's
registered team IS one**: Sm'Aesch Pfeffingen plays Nationalliga A der Damen and
is the flagship of Aesch, and a blunt rule would have silenced it.

The rule used to decide only what got WRITTEN; everything was stored and shown,
on the theory that a fixture list is useful whole. It is not — the newsroom
watched women's and lower-league sides sit in the tab for months with no article
ever coming of them. **The filter is at the door now**
(`ersteMannschaftAbgleich`, applied in `operations/sportresultate-holen`): what
is below the club's best league is not written, and what is already stored below
it is deleted in the same run. Two things make that safe. The decision is taken
over the stored rows AND the newly read ones together — a weekend on which only
the fourth team plays must not promote it to first team for a day — and a
fixture some report already points at is spared, whatever league it turned out
to be in. The frontend keeps its mirror of the rule
(`berichtenswerteSpiele`) for the window before the next run and for clubs the
newsroom has since switched off, which the run no longer walks.

**Every match report carries the association page its result stands on.** It was
the one kind of article here that named no source a reader could open. The line
is appended by code — `mitQuelle` in `redaktion/spielbericht.ts`, the same
division of labour as the press review and the gazette — and `pruefeUebergang`
refuses to publish a report without it, which is what catches the drafts written
before the rule (a migration filled in the ones on the desk). The address is
`vereine.ergebnis_url` before `spiele.quelle_url`, and that order is not a
preference: for football the stored `quelle_url` is the association's "what's
on" page, which only looks FORWARD and no longer carries the match a week later
— the club page is where the score is read back from in the first place. On a
revision the line comes off before the prompt is built (`ohneQuelle`) and goes
back on after, or the model copies it and it ends up twice.

**Four sports have connectors: football, volleyball, handball, basketball.**
Chess, Schwingen, swimming, American football and curling are recorded as clubs
but no source is read for them, so the tab is legitimately right about football
and empty about chess at the same time. The run reports the gap in
`ohneKonnektor` rather than looking complete.

**Basketball is the one read off a different publisher's host, and that was a
newsroom decision.** `basketplan.ch` produces these data and turns us away: its
`robots.txt` is a blanket `Disallow: /` on both hosts (measured 17.09.2026,
`Last-Modified` 2022) and it documents no API, so the amtsblattportal exception
does not apply and `exportGames.do` is never fetched. Swiss Basketball publishes
its own championship under `swiss.basketball`, whose `robots.txt` allows
everything, and Jolanda decided on 17 September 2026 that we may read it there.
Four things measured that shape `shared/basketplan/`:

- One request per **GROUP**, not per team — the football pattern. The NL1 Men
  group East carries BC Arlesheim's men, BC Allschwil-Algon and Liestal Basket
  44 at once, so one request serves three municipalities and two clubs of one
  group share one `vereine.ergebnis_url`.
- Which match is whose is decided on **`vereine.externe_id`** — the team id at
  the source, not the club id: a club fields several teams under one `clubId`.
  A match nobody we cover played is counted in the log, never stored; a derby
  between two of our clubs goes to the HOME side, because `spielnummer` is
  unique and two rows would be two articles.
- **`GameRSS/@id`** is the identity at the source, six digits, so no composed
  key. An unplayed match carries **no `result` attribute at all** — not «0» —
  so the handball trap does not exist here; the clock still decides.
- **`@referees` names natural persons** and is dropped inside `attribute()`, the
  parser's own boundary, so nothing downstream can carry it. `findTeamById.do`
  is never called at all: its answer hands over a club official's private
  address and three mobile numbers, unasked. `istErlaubteQuelle` enforces both
  in code — the club form checks it too, so a wrong address fails while an
  editor is looking at it.

Two things follow from the XML being a machine door. The report's source link is
**inverted for this sport alone** (`XML_TUER` in `spielbericht.ts`):
`showLeagueSchedule.do` answers `text/xml` even without `xmlView=rss`, so the
article points at `spiele.quelle_url` — the association's own league page,
derived by `oeffentlicheLigaseite` from `leagueName` over the six pages the site
actually has, null for anything else. And the **group ids change every season**:
that is a yearly edit in the Gemeinden card, deliberately not an automatism that
would re-point itself at the wrong year. BC Arlesheim's first team is the
WOMEN's side (NLB Women) — the men play one tier lower — which is the Sm'Aesch
Pfeffingen case again; `mannschaft.ts` needs no change for it, because a group
is one league and all of a club's matches in it share one `wettbewerb`.

Why the others are not built, so nobody repeats the search:

- **Swimming** — `swimrankings.net` and `swiss-swimming.ch` both refuse us; the
  crawler gets 0 bytes even through Playwright. No reachable source.
- **American football** — `safv.ch` responds but publishes no results page.
- **Curling** — the entry is a facility hosting several clubs, not a team.
- **Chess** — `swisschess.ch/…/smm` is a _news feed_ about the championship. It
  names Riehen constantly in prose but carries no fixture table and no link to
  one. Needs a different URL, not a parser.

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
   `<portal>/explore/dataset/<id>/` or `<portal>/<id>`), the prompt dictates
   it, a check reports any other URL, and
   `repariereQuellenlink` forces every anchor onto it before the article is
   stored. A wrong address is the one error a reader can neither see nor check.
   **The portal and the office it speaks for come from the dataset's own
   source row**, not from a constant: `quellen.basis_url` and
   `quellen.konfiguration` (`{amt, bezirke}`, read by `redaktion/portale.ts`).
   Both belong to the RUN — one dataset, one period — so they may ride in the
   cached system prefix without breaking rule 1. Unset falls back to Baselland,
   so an empty configuration costs no article its link.
   The frontend renders that one anchor through `textStuecke`/`Artikeltext` —
   parsed, never `dangerouslySetInnerHTML`, so nothing else can become markup.

**The revision watchdog looks BACK, and it is the only thing here that does.**
Every other pass asks what is new. A statistics office revises — a provisional
figure becomes final, a municipality reports late, a category is
reclassified — and an article that was correct on the day it went out quietly
stops being correct, with nothing in the pipeline ever looking at it again.
So when `quellen-pruefen` finds a dataset whose NUMBERS moved (the same
`letzter_stand` fingerprint that reopens it, never a corrected description),
it re-reads the source and measures that dataset's already PUBLISHED articles
against the new rows — with the very function that cleared them,
`unbelegteProzentangaben` from `zahlen.ts`. No threshold of its own: a second
tolerance would drift from the first and the two would disagree about the same
article. The finding lands in `meldungen.revision_hinweis` and nowhere else.
**It states and never acts** — nothing is republished, rewritten or retracted
here, because a machine that silently pulls yesterday's journalism is worse
than one that says nothing. Three quiet rules make it safe: a municipality
missing from the fresh rows is skipped rather than flagged (a gap in the
source is not a wrong article), a source that cannot be re-read today writes
nothing at all — neither a finding nor the clearing of one — and a finding
that no longer holds IS cleared, so a later correction takes the flag away
again. Bounded at 50 articles per run, newest first; no model is called, only
the source is re-read. The desk shows it as a red «Zahlen revidiert» chip on the card
above every other warning and as the red counter on the statistik.bl tab
(`lib/revision.ts`).

**Since 17 September 2026 the SPORT desk has the same watchdog**, and it hangs
on the same field. An association revises too — a forfait, an upheld protest, a
typo in the score sheet — and `sportresultate-holen` reads the results afresh
every morning and writes the corrected figures onto the `spiele` row a published
report points at (`meldungen.spiel`). So the row as it stood is held BEFORE the
update and `redaktion/revisionsport.ts` measures the published reports against
both sides. Two nets, and the second one is the measured part: the digit check
is imported from `spielbericht.ts` whole, exactly as the statistics watchdog
imports `zahlen.ts` — but a correction routinely shares a digit with what it
replaced, and after 1:1 became 2:1 no single digit of «1:1» is unsupported while
the pair is plainly wrong, so the SCORELINE is compared as a pair as well. A
report that never named what moved gets nothing; a finding that no longer holds
is cleared. It states and never acts, like its neighbour. The desk shows it on
the report's own card, and the red counter now splits: `revisionZaehlerSport`
on „Sportresultate", `revisionZaehlerStatistik` on „statistik.bl" — one field,
two watchdogs, and a finding belongs on the desk that can open the article.

**And a THIRD case since the same day, which is the one the whole idea was
built for.** The EuroAirport's south-approach figures are not provisional until
they are final — they are provisional for ever: the sheet for December 2025,
updated on 30 January 2026, still says „Provisorische Zahlen", and a revised
month is simply re-uploaded under a new file name. So `quellen-pruefen`
measures the published articles of THAT month against the new state
(`redaktion/revisionsuedanflug.ts`). Two things differ from its neighbours and
both are measured. BOTH counts and the quota are compared, not just the
percentage: 3304 of 7556 is the same 43,7 percent and a different month, and an
article naming the absolute figures is wrong after such a correction while the
quota alone would have noticed nothing. And only what the text actually wrote
down counts — „Der Juli war laut" survives every revision, and flagging it
would teach the desk to ignore the chip. `revisionZaehlerStatistik` carries it
without a change, because a south-approach article has no `spiel`; that was
checked rather than assumed, and there is a test.

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
- `redaktionswissen` — the one rule store, for EVERY desk since September
  2026 (it was the statistics feed's alone before). Each rule carries its
  `bereich` (statistik · sport · entsorgung · presseschau · amtsblatt ·
  gemeinde · sendung · suedanflug), its `stufe` (`sichtung`: what gets proposed; `text`: how a
  Meldung is written), its `wirkung` (`hinweis`, or `weiterreichen` for a
  Sichtung rule that may hand matching proposals to the Chefredaktion by
  itself), its `herkunft` (chat · kommentar · entscheid · manuell) and a
  `beleg` — the editor's words, or the decisions it was distilled from.
  Written by `redaktion/gedaechtnis.ts`: `merkeWissenAus` for words (every
  chat branch, every reject comment, a hand-up Begründung, a Verwerfen
  reason), `lerneAusEntscheid` for decisions (`lernen.ts` holds the rules of
  that: doublette/veraltet/falsche Gemeinde never teach; a comment always
  asks; a bare click only after two earlier decisions of the same kind; a
  "neu" without either is downgraded to einmalig in code; `weiterreichen`
  survives only on a hand-up). Read by `ladeRegeln` per bereich/stufe,
  capped at 30 with an audible warning. Only `bereich: statistik` rules are
  scoped (dataset/portal) and only they reach the cached article prefix —
  desk rules are global within their desk and travel in the user turn, as
  numbered R1…Rn in a Sichtung, as „Redaktionelle Vorgaben" in an article
  prompt. „Gelerntes" (behind the gear) shows them all, grouped by desk, with
  beleg, a switch, the automation's switch and its track record, and a
  „Regel erfassen" dialog (`POST /redaktion/wissen`) — the cheapest learning
  of all.
- `suedanflugquoten` — one row per month of the EuroAirport's ILS-33 sheet:
  the two counts, the printed quota, every day line, the sheet's own
  contradictions (`befunde`), the address and the sha256 of the text layer.
  Identity `(jahr, monat)`, a composite unique in
  `migrations/20260917B-suedanflug.mts`, because the airport re-uploads a month
  when it revises it and two rows would split one month's history. The
  checksum is what says whether a re-upload actually changed anything; the
  stored day lines are what the year figure, the neighbours and the peak day
  are computed from, so an article is written from what the editor saw and not
  from a fresh fetch. `gemeinden.suedanflug` belongs here too — who lies under
  the approach is the newsroom's judgement, not a column of the source.
- `vereine` — which clubs speak for a municipality, and why. Recorded from the
  Gemeinden tab through `POST /redaktion/vereine`, whose one rule with teeth is
  that `swissvolley`, `handball` and `basketball` need an `ergebnis_url`: those
  three are read from exactly that address, and without it the morning run skips
  the club with a log line nobody reads. `basketball` needs a second thing, and
  the form and the endpoint both say so: `externe_id`, the team id at the
  source. Its address is a GROUP and a group carries several clubs, so without
  the id nothing says which match is whose. `bedeutung` splits
  them the way the newsroom does: `aushaengeschild` carries regional reach,
  `breitensport` is the village itself, and that changes how a result is framed.
  `notiz` holds the editor's own reasoning and belongs in the **user turn** of an
  article prompt, never in the cached system prefix — it is per-municipality, and
  interpolating it there would break the byte-identical guarantee. `liga` is a
  snapshot that goes stale every season. Clubs proposed by a connector arrive
  with `zuordnung_geprueft = false`, the same confirm-once pattern as
  `ankuendigungen`. `akzeptierte_zahlen` is the club's own lesson store: the
  numbers the editor published past the warning, written by the meldung-status
  hook, honoured by the report checks — delete one and the warning returns.
- `entsorgungskalender.extraktion` + `merkblatt` — what the PDF said and what was
  deliberately discarded as a regular collection. The second half is the one that
  matters later: without it, a category the model dropped by mistake is
  indistinguishable from one the calendar never had.
- `wochenblattkandidaten.entscheid` (uebernommen/abgelehnt/weitergereicht) +
  `ablehnungsgrund`/`ablehnungskommentar` +
  `wochenblattkandidaten.perle` + `wochenblattkandidaten.gemeinde_korrigiert` +
  `recherchehinweise.status`/`kommentar` — the press review's LOCAL memory
  is its decision rows (the rule store above is the general one).
  `redaktion/lernsignale.ts` loads them for the 09:00 run and the
  re-inventory button alike, windowed by the paper's last three issues, and
  `lernDigest` renders them into the next inventory's user turn — take (with
  „Meldung danach verworfen" where that happened), reject with reason AND
  comment, hand-ups read by the Chefredaktion's verdict (still on her desk /
  bestätigt / abgelegt — a hand-up she binned is a wrong proposal too, and a
  hand-up a RULE made is no example until she judged it, or the automation
  would feed itself), Perle verdicts across ALL papers (taste is the
  newsroom's; each paper alone holds two or three), municipality corrections,
  the inventory's own lead verdicts, and a Bilanz line plus the last ten
  `verfallen` titles. Every cap is declared („N weitere Entscheide nicht
  aufgeführt"). Never into the cached system prefix, and the examples stay
  per Blatt: what is a Doublette in Binningen says nothing about Muttenz.

- `amtsblattmeldungen.entscheid` + `ablehnungsgrund`/`ablehnungskommentar` —
  the gazette feed's memory is its decision rows too, and scoped PER
  MUNICIPALITY rather than per source: what counts as local news in Riehen says
  little about Pratteln. `lernDigest` renders the last ~20 into the next
  triage's user turn — reasons in words, the comment (stored since day one,
  read since September 2026), hand-ups by the Chefredaktion's verdict, a
  30-day Bilanz and the `verfallen` titles — never into the cached prefix.
  A proposal whose deadline passed undecided is marked `verfallen`
  (`aufraeumAktion`), not deleted; an unproposed stale row still goes.
  `vorschlag` + `vorschlag_begruendung` are the triage's own verdict, and
  null means "not judged" — the row still shows, it simply carries no
  recommendation.
- `amtsblattmeldungen.planbefunde` + `plan_fazit` — what the building plans
  actually said, each finding with the sheet it was read from. Kept because the
  plans come down when the objection period ends: the link dies, the reading
  outlives it. `gemeinden.plz` belongs here too — it is the key to half the
  feed, and its absence is silent rather than loud.
- `gemeinden.simap_vergabestellen` — which procurement offices speak for a
  municipality, including its communal enterprises (the Wärmeverbund Riehen AG,
  the Wasserwerk Reinach und Umgebung). Newsroom-maintained for a measured
  reason: simap's public directory names no canton, so the name search offers
  „Gemeinde Aesch LU" and two Reinach AG offices alongside the right ones, and
  a wrong entry files another canton's tenders on this desk without a trace.
  Each id was verified through the postcodes of its own publications; a
  municipality without an entry still gets everything built IN it, only not
  what it tenders itself.

- `gemeindemitteilungen.entscheid` + `ablehnungsgrund`/`ablehnungskommentar` —
  the municipal-news desk's memory, scoped PER MUNICIPALITY like the gazette's
  and loaded by the same code path (`ladeGemeindeSignale`, keyed on the item's
  `kategorie` where the gazette has a rubric). `lernDigest` renders the last
  ~20 into the next Sichtung's user turn with a 30-day Bilanz and the
  `verfallen` titles; undecided proposals lapse to `verfallen` after fourteen
  days, unproposed rows are deleted after seven (`aufraeumAktion` in
  `redaktion/gemeindeseite.ts`, mirrored by `abgelaufen` in the frontend).
  The rows also ARE the read: `text`, `anhaenge` and `hinweise` hold what the
  reader collected and what it could not — a Meldung is only ever written from
  them, never from a title. `gemeinden.news_url` belongs here too: the one
  address per municipality the feed reads, plus `news_letzte_pruefung` and
  `news_letzter_fehler`, so a page that stopped answering is a line on the
  desk and in the card, not silence.
- `sendungskandidaten.entscheid` + `ablehnungsgrund` — the broadcast feed's
  memory, scoped PER SHOW rather than per municipality: what counts as "only
  mentioned" is a property of how a programme talks, and the two talk very
  differently. `ablehnungsgrund: 'nur_erwaehnt'` is the one that teaches the
  next inventory exactly the distinction its prompt asks it to make (rendered
  in words: „nur am Rand erwähnt"). Undecided candidates are marked
  `verfallen` after seven days (`darfWeg`) — a broadcast is perishable, but
  the ignored ones count in the Bilanz — decided ones are never touched.
- `recherchehinweise.kandidat` / `.amtsblattmeldung` / `.gemeindemitteilung` /
  `.sendungskandidat` + `automatisch` + `regel` — where a lead came from, and
  whether a person or a rule handed it up. The origin link is what lets each
  desk's digest read the Chefredaktion's verdict back onto its own row
  (`weiterreichen.ts` builds the lead for all four desks), what „Zurück auf den Tisch"
  (`POST /redaktion/hinweise/:id/zurueck`, status `zurueckgegeben`) needs to
  reopen the row, and — via `regel` — what the automation's trip-wire counts:
  two rejections in a row (`kein_hinweis` or `zurueckgegeben`) drop the rule's
  `wirkung` back to `hinweis` and say so in its beleg
  (`pausiereAutomatikWennNoetig`). The rule stays; re-arming it is the
  editor's switch. Automation creates a lead, never a Meldung.

All of it is bounded on purpose: the rules feed prompts (the statistics ones
the cached prefix), and an unbounded memory would grow them without limit —
30 rules per desk and stufe, 20 examples, ten ignored titles, and every cap
that bites says so.

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

[code-review.yml](.github/workflows/code-review.yml) is the second gate and
checks a different thing: not that the code works, but that it is built the way
this repo is meant to be built, against the rules in
`.github/code-review-rules.yml`. It runs **on pull requests only**: it reviews a
change, and a change reaches `main` through a pull request that was already
reviewed. On a `push` event the action finds no task and exits in three seconds
without judging anything, which paired with the rule below turned every merge
into a red `main` (measured 15 September 2026). Three more things are
deliberate. It runs
on **Claude** — the official `anthropics/claude-code-action`, since September
2026; the action it used before could only speak to Gemini, which sat badly with
hard constraint 2. That constraint still means what it says for the
APPLICATION — `shared/claude.ts` is the only module that calls a model at
runtime — and CI tooling is simply not the application. It reads the **diff**,
not the whole tree: reviewing everything cost roughly 700'000 input tokens on
every push to `main`, and a push to `main` is a deploy here. And a missing
`ANTHROPIC_API_KEY` leaves it **quiet, not red** (the `CRAWLER_KEY` bargain) —
the old one failed on the missing secret and had been red on `main` for weeks
without once saying anything about the code. A review that RUNS and returns no
verdict is the opposite case and fails loudly: the gate reads `bestanden` out of
a JSON schema, and its fallback is `false`, because a fallback of `true` made a
broken review indistinguishable from a clean one — which is exactly how it
reported green twice while judging nothing.

On a server, deploy the same `docker-compose.yml` with real values in `.env`
(`KEY`, `SECRET`, `DB_PASSWORD`, `ADMIN_PASSWORD`, the public URLs) and a reverse
proxy in front for TLS.

**The actual Dokploy host does not consume the GHCR images at all**: the compose
file builds both apps from source (`build:` contexts), and Dokploy rebuilds and
redeploys the stack from the repository on every push to `main`. A push IS the
deploy — which is also why the GHCR publish workflows failing does not stop a
deploy: the server kept deploying normally throughout. **What they were failing
on was measured on 17 September 2026 and it was not the repository's Actions
settings.** All 36 runs of `build-backend-main.yml` since the very first on 4
August 2026 ended in `startup_failure` after 0 to 1 second, with no job created
and no log to read — the workflow never published an image at all. The cause is
structural: the two callers declared no `permissions`, and a called workflow can
only REDUCE the caller's `GITHUB_TOKEN`, never elevate it, so the reusable
builder's `packages: write` could not be granted and the run was refused before
it began. A capped token was the wrong suspect: `code-review.yml` elevates to
`pull-requests: write` in the same repository and runs green. Both callers (and
`build-production.yml`, which no `v*` tag has yet reached) now grant
`contents: read` + `packages: write` on the calling job. The images remain the
documented path for any host that pulls instead of builds.

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
