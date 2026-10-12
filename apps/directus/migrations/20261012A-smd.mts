import type { Knex } from 'knex'

/**
 * The SMD desk, 12 October 2026 — indexes only. The two collections
 * (`smd_dossiers`, `smd_beitraege`) and the origin fields on `meldungen` and
 * `recherchehinweise` live in `schema/`, as every collection does.
 *
 * Three things the schema sync does not carry:
 *
 * - The dossier's identity, its mail subject: the dedup of the mailbox fetch
 *   runs against THIS database's own rows, never the mailbox's seen flag —
 *   the two shows' rule — and a second row for one mail would be two reads
 *   of one dossier.
 *
 * - The piece's identity, `(schluessel, gemeinde)`: SMD's 26-hour window
 *   sends the same piece in two dossiers, and a blog comes whole every time
 *   one entry changed — so the same piece naming the same municipality must
 *   land on its row, and a piece naming three municipalities is three rows.
 *
 * - The desk's one-article rule on `meldungen.smd_beitrag`, enforced by the
 *   database like the reminders' and the Kanton desk's.
 *
 * No source row: the desk's configuration is the mailbox (`IMAP_*`,
 * `SMD_IMAP_SUBJECT_FILTER`), and its publishers' doors are a table in code
 * (`shared/verlage/`), each one a measured decision.
 */

const INDIZES: ReadonlyArray<{ tabelle: string; sql: string }> = [
  {
    tabelle: 'smd_dossiers',
    sql: 'CREATE UNIQUE INDEX IF NOT EXISTS smd_dossiers_subject_uniq ON smd_dossiers (source_subject)'
  },
  {
    tabelle: 'smd_beitraege',
    sql: 'CREATE UNIQUE INDEX IF NOT EXISTS smd_beitraege_schluessel_gemeinde_uniq ON smd_beitraege (schluessel, gemeinde)'
  },
  {
    tabelle: 'meldungen',
    sql: "CREATE UNIQUE INDEX IF NOT EXISTS meldungen_smd_beitrag_uniq ON meldungen (smd_beitrag) WHERE smd_beitrag IS NOT NULL AND status <> 'verworfen'"
  }
]

export async function up(knex: Knex): Promise<void> {
  for (const index of INDIZES) {
    if (!(await knex.schema.hasTable(index.tabelle))) continue
    if (
      index.tabelle === 'meldungen' &&
      !(await knex.schema.hasColumn('meldungen', 'smd_beitrag'))
    )
      continue
    await knex.raw(index.sql)
  }
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS smd_dossiers_subject_uniq')
  await knex.raw('DROP INDEX IF EXISTS smd_beitraege_schluessel_gemeinde_uniq')
  await knex.raw('DROP INDEX IF EXISTS meldungen_smd_beitrag_uniq')
}
