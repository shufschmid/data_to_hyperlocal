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

This is the important part, and it is not symmetric:

| Folder                                                                                                                | Owned by             | Applied by `schema:load`?     |
| --------------------------------------------------------------------------------------------------------------------- | -------------------- | ----------------------------- |
| `collections/` — flows, operations, roles, policies, permissions, settings, presets, dashboards, panels, translations | **this folder**      | **yes**                       |
| `snapshot/` — collections, fields, relations                                                                          | **`../migrations/`** | **no** (`push --no-snapshot`) |

`snapshot/` is dumped so the data model is readable in a diff and so `schema:diff`
can prove a migration wrote what Directus itself would have written. It is
deliberately **not** pushed.

The reason is a sharp edge: `directus-sync push` treats the snapshot as the whole
truth and **deletes any collection that is not in it**. Add a migration, boot the
container before re-dumping, and the push silently drops the collections that
migration just created — tables gone, no error in the log. Excluding the snapshot
from the push removes that failure mode entirely.

## The one rule

Every collection is owned by exactly one mechanism — either this folder or
`../migrations/`. Never both. In this project the split is fixed:

- **Data model** (tables, fields, relations) → migrations, always.
- **Configuration** (Flows and their cron triggers, roles, permissions, settings)
  → this folder, always.

After changing a migration, run `npm run schema:dump` and check that
`npm run schema:diff` comes back with no changes. That is the gate: an empty diff
means the migration and Directus agree. See `apps/directus/CLAUDE.md`.
