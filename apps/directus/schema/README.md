# schema/ — Directus configuration, in version control

This folder is written by [directus-sync](https://tractr.github.io/directus-sync/). It
is generated, never hand-edited.

```bash
npm run schema:dump   # live Directus  →  this folder
npm run schema:diff   # show what differs between this folder and live Directus
npm run schema:load   # this folder    →  live Directus  (colleague's machine, CI, boot)
```

All three talk to a **running** Directus over HTTP and need credentials —
`DIRECTUS_URL` plus either `DIRECTUS_TOKEN` or `DIRECTUS_ADMIN_EMAIL`/`DIRECTUS_ADMIN_PASSWORD`
in `.env`. The container entrypoint uses the admin credentials.

## What is applied, and what is only recorded

Since August 2026 both halves are applied — the earlier split (snapshot owned by
migrations, pushed with `--no-snapshot`) is gone, together with the model
migrations:

| Folder                                                                                                                | Owned by        | Applied by `schema:load`? |
| --------------------------------------------------------------------------------------------------------------------- | --------------- | ------------------------- |
| `collections/` — flows, operations, roles, policies, permissions, settings, presets, dashboards, panels, translations | **this folder** | **yes**                   |
| `snapshot/` — collections, fields, relations                                                                          | **this folder** | **yes**                   |

`npm run schema:load` is a plain `directus-sync push`, and the container runs it
on every boot. That has a consequence worth knowing: **hand-written snapshot
files are applied.** The practice in this repo is to write a new field's
`snapshot/fields/<collection>/<field>.json` (and its `relations/…` file for an
m2o) next to the code that needs it — copied from a sibling file, `sort` and
`max_length` checked — and to let `schema:dump` regenerate `specs/` afterwards;
`schema:diff` against a running instance is the gate that proves the file says
what Directus would have written.

The sharp edge that used to justify the split still exists: `directus-sync push`
treats the snapshot as the whole truth and **deletes any collection that is not
in it**. Never create a collection outside the snapshot, and never run
`schema:load` against an instance whose model is newer than this folder.

## The one rule

Structure is owned by this folder, never by `../migrations/`:

- **Data model** (tables, fields, relations) → `snapshot/`, built in the admin UI
  and dumped, or written by hand as described above.
- **Configuration** (Flows and their cron triggers, roles, permissions, settings)
  → `collections/`, always dumped.
- **Migrations** → row data and the indexes Directus does not manage (partial
  unique indexes), nothing else.

After any change, run `npm run schema:dump` and check that `npm run schema:diff`
comes back with no changes. That is the gate: an empty diff means this folder and
Directus agree. See `apps/directus/CLAUDE.md`.
