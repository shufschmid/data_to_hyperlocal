import type { Knex } from 'knex'

/**
 * Repair: the procurement offices `20260918F` wrote in the wrong shape, and
 * the foreign tenders that shape let onto the desk.
 *
 * `20260918F` seeded Allschwil's and Reinach's `simap_vergabestellen` as bare
 * uuid STRINGS. The column holds `{id, name, typ}` objects, and the run read
 * `.id` off each entry: `undefined`, joined into an EMPTY
 * `issuedByOrganizations`. simap ignores an empty filter and answers with
 * every publication in Switzerland (measured 27 September 2026: twenty rows
 * and another page for two days), so each morning's run collected five full
 * pages, filed them as the municipality's OWN tenders, triaged them, and
 * reported «mehr Publikationen, als ein Lauf liest». The run now reads both
 * shapes and never sends an empty filter (`vergabestellenIds`); this puts the
 * data right and takes the foreign rows off the desk.
 *
 * Two steps, both narrow on purpose:
 *
 * 1. **The offices, into the object form.** Only entries that are plain
 *    strings are rewritten; an editor's objects stay as they are. The names
 *    are the directory's own for the two verified uuids; an unknown string
 *    keeps its uuid as its name rather than being guessed.
 * 2. **The foreign rows, gone — but only what nobody touched.** A simap row
 *    of Allschwil or Reinach, created since the seed (18 September 2026),
 *    still `offen`, with no Meldung and no lead pointing at it, that names
 *    NEITHER the municipality NOR its postcode anywhere — not in the title,
 *    not as the office, not in its fact lines. A genuine row of the
 *    place-of-performance query was matched BY that postcode, and a genuine
 *    own tender carries the municipality's name as office, so both survive
 *    this test. Decided rows are memory and are never deleted.
 *
 * `down` restores nothing: the deleted rows were never the municipality's.
 */

const BEKANNT: Record<string, { name: string; typ: string }> = {
  '1c10de22-1d6a-4088-a86f-bdeb81b729b3': {
    name: 'Einwohnergemeinde Allschwil',
    typ: 'communal'
  },
  'd1048e1d-637d-43d5-aa5d-f7019df30cf8': {
    name: 'Gemeinde Reinach, Technische Verwaltung',
    typ: 'communal'
  }
}

const SEIT = '2026-09-18'
const BETROFFEN = [2762, 2773] // Allschwil, Reinach (BFS)

function alsObjekte(roh: unknown): unknown[] | null {
  if (!Array.isArray(roh)) return null
  let geaendert = false
  const neu = roh.map((eintrag) => {
    if (typeof eintrag !== 'string') return eintrag
    geaendert = true
    const id = eintrag.trim()
    return { id, ...(BEKANNT[id] ?? { name: id, typ: 'communal' }) }
  })
  return geaendert ? neu : null
}

function alsJson(wert: unknown): unknown {
  if (typeof wert !== 'string') return wert
  try {
    return JSON.parse(wert)
  } catch {
    return null
  }
}

export async function up(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasTable('gemeinden'))) return
  if (!(await knex.schema.hasColumn('gemeinden', 'simap_vergabestellen')))
    return

  // 1. The offices.
  const gemeinden = (await knex('gemeinden')
    .whereNotNull('simap_vergabestellen')
    .select('id', 'name', 'simap_vergabestellen')) as Array<{
    id: string
    name: string
    simap_vergabestellen: unknown
  }>
  for (const g of gemeinden) {
    const neu = alsObjekte(alsJson(g.simap_vergabestellen))
    if (neu === null) continue
    await knex('gemeinden')
      .where({ id: g.id })
      .update({ simap_vergabestellen: JSON.stringify(neu) })
    console.log(
      `simap: Vergabestellen von ${g.name} in die Objektform gebracht.`
    )
  }

  // 2. The foreign rows.
  if (!(await knex.schema.hasTable('amtsblattmeldungen'))) return
  const betroffen = (await knex('gemeinden')
    .whereIn('bfs_nummer', BETROFFEN)
    .select('id', 'name', 'plz')) as Array<{
    id: string
    name: string
    plz: string | null
  }>

  for (const g of betroffen) {
    const merkmale = [
      g.name,
      ...(g.plz ?? '')
        .split(',')
        .map((p) => p.trim())
        .filter((p) => p !== '')
    ]
    const kandidaten = (await knex('amtsblattmeldungen as a')
      .where('a.gemeinde', g.id)
      .where('a.quelle_typ', 'simap')
      .where('a.entscheid', 'offen')
      .where('a.date_created', '>=', SEIT)
      .whereNotExists(
        knex('meldungen as m').whereRaw('m.amtsblattmeldung = a.id')
      )
      .select('a.id', 'a.titel', 'a.amt', 'a.angaben')) as Array<{
      id: string
      titel: string | null
      amt: string | null
      angaben: unknown
    }>

    const mitHinweis = (await knex.schema.hasColumn(
      'recherchehinweise',
      'amtsblattmeldung'
    ))
      ? new Set(
          (
            (await knex('recherchehinweise')
              .whereIn(
                'amtsblattmeldung',
                kandidaten.map((k) => k.id)
              )
              .select('amtsblattmeldung')) as Array<{
              amtsblattmeldung: string
            }>
          ).map((h) => h.amtsblattmeldung)
        )
      : new Set<string>()

    const fremd = kandidaten.filter((k) => {
      if (mitHinweis.has(k.id)) return false
      const text = [
        k.titel ?? '',
        k.amt ?? '',
        typeof k.angaben === 'string'
          ? k.angaben
          : JSON.stringify(k.angaben ?? '')
      ]
        .join(' ')
        .toLowerCase()
      return !merkmale.some((m) => text.includes(m.toLowerCase()))
    })
    if (fremd.length === 0) continue

    await knex('amtsblattmeldungen')
      .whereIn(
        'id',
        fremd.map((k) => k.id)
      )
      .delete()
    console.log(
      `simap: ${fremd.length} fremde Beschaffungen vom Tisch von ${g.name} entfernt (${kandidaten.length - fremd.length} behalten).`
    )
  }
}

export async function down(): Promise<void> {
  // Nothing to restore: the removed rows were never this municipality's, and
  // the object form is the column's intended shape.
}
