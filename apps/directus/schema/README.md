# schema/ — the data model, in version control

This folder is written by [directus-sync](https://tractr.github.io/directus-sync/). It
is generated, never hand-edited.

```bash
npm run schema:dump   # live Directus  →  this folder   (after changing the model in the admin UI)
npm run schema:diff   # show what a push would change
npm run schema:load   # this folder    →  live Directus  (on a colleague's machine, in CI, on boot)
```

Both commands talk to a **running** Directus over HTTP and need credentials —
`DIRECTUS_URL` plus either `DIRECTUS_TOKEN` or `DIRECTUS_ADMIN_EMAIL`/`DIRECTUS_ADMIN_PASSWORD`
in `.env`. The container entrypoint uses the admin credentials.

After the first `schema:dump` you get:

```
schema/
├── snapshot/          collections, fields, relations
├── flows/             Flows incl. their Schedule (cron) triggers
├── operations/        the steps inside those Flows
├── roles/  policies/  permissions/
├── settings/ presets/ dashboards/ panels/ translations/
└── directus-sync.id-map.json   maps local ids to remote ids — commit it
```

`npm run schema:load` is a **diff-and-apply**, so it is safe to run repeatedly.

## The one rule

Every collection is owned by exactly one mechanism — either this folder or
`../migrations/`. Never both: a `schema:load` that tries to create a collection a
migration already created fails with "collection already exists". See
`apps/directus/CLAUDE.md` for which to pick.
