import type { Knex } from 'knex'

/**
 * The Kanton desk: two indexes Directus does not manage, and the source row.
 *
 * `kantonsmitteilungen` is one row per (cantonal notice, municipality it
 * names) — a press release naming Münchenstein and Bottmingen is two rows
 * with the same `url`, so `url` alone is not unique and the identity is the
 * pair. The partial unique on `meldungen(kantonsmitteilung)` is the desk's
 * one-article rule, enforced by the database like the reminders' is.
 *
 * The source row is what the run reads: the canton's data door (the Plone
 * REST API the Nuxt frontend of www.baselland.ch itself calls — measured 28/29
 * September 2026, JSON without the Cloudflare challenge that turns away
 * direct page reads) and its two listing blocks. A portal is a ROW, never a
 * constant: the general Medienmitteilungen block (tag BL-Home, which carries
 * every directorate's releases) and the Polizeimeldungen block, which are
 * not in it. The public site is only ever linked.
 *
 * Insert-only for the row: an existing `kanton` row — switched off, or with
 * other lists — is never touched. Seeded ACTIVE because the newsroom decided
 * on 29 September 2026; switching it off is one click.
 */

const INDIZES = [
  'CREATE UNIQUE INDEX IF NOT EXISTS kantonsmitteilungen_url_gemeinde_uniq ON kantonsmitteilungen (url, gemeinde)',
  "CREATE UNIQUE INDEX IF NOT EXISTS meldungen_kantonsmitteilung_uniq ON meldungen (kantonsmitteilung) WHERE kantonsmitteilung IS NOT NULL AND status <> 'verworfen'"
]

const QUELLE = {
  name: 'Kanton Basel-Landschaft — Medien- und Polizeimeldungen',
  typ: 'kanton',
  basis_url: 'https://bl-api.webcloud7.ch',
  konfiguration: JSON.stringify({
    listen: [
      {
        kennung: 'medienmitteilung',
        pfad: '/startseite/ftw-news-newslistingblock',
        name: 'Kanton Basel-Landschaft'
      },
      {
        kennung: 'polizeimeldung',
        pfad: '/startseite/ftw-news-newslistingblock-1',
        name: 'Polizei Basel-Landschaft'
      }
    ],
    seite: 'https://www.baselland.ch'
  }),
  aktiv: true
}

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasTable('kantonsmitteilungen')) {
    for (const anweisung of INDIZES) await knex.raw(anweisung)
  }

  if (!(await knex.schema.hasTable('quellen'))) return
  const vorhanden = await knex('quellen').where({ typ: 'kanton' }).first('id')
  if (vorhanden !== undefined) return
  await knex('quellen').insert(QUELLE)
  console.log(`Kanton: Quelle ${QUELLE.basis_url} eingetragen (aktiv).`)
}

export async function down(knex: Knex): Promise<void> {
  // The indexes go; the source row stays — it carries the newsroom's setting
  // (active or not), and a down that deleted it would lose that.
  await knex.raw('DROP INDEX IF EXISTS kantonsmitteilungen_url_gemeinde_uniq')
  await knex.raw('DROP INDEX IF EXISTS meldungen_kantonsmitteilung_uniq')
}
