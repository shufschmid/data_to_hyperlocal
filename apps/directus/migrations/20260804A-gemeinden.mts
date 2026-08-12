import type { Knex } from 'knex'

/**
 * The municipalities «Die Redaktion» can write about.
 *
 * Reference data, so it is seeded here rather than typed in by hand: a fresh
 * install has all 86 Basel-Landschaft municipalities, and Sämi flips `aktiv` on
 * the ones the Dorfkönig covers.
 *
 * `bfs_nummer` is the identity, not `name`. The federal municipality number is
 * what every dataset on data.bl.ch carries alongside its `gemeinde` label, and
 * that label is *not* reliable: six of the 86 arrive with a canton suffix
 * ("Aesch (BL)", "Oberwil (BL)", "Reinach (BL)", "Kilchberg (BL)",
 * "Rickenbach (BL)", "Oberdorf (BL)"). Names here are the clean, publishable
 * form; matching an external row to a municipality always goes through the
 * number.
 */

// Districts are contiguous blocks of BFS numbers — this is the official
// numbering, not a convenience. Deriving them beats a second column in the
// seed list that could drift out of step with the numbers.
const BEZIRKE: ReadonlyArray<{ von: number; bis: number; name: string }> = [
  { von: 2761, bis: 2775, name: 'Arlesheim' },
  { von: 2781, bis: 2793, name: 'Laufen' },
  { von: 2821, bis: 2834, name: 'Liestal' },
  { von: 2841, bis: 2869, name: 'Sissach' },
  { von: 2881, bis: 2895, name: 'Waldenburg' }
]

const GEMEINDEN: ReadonlyArray<readonly [number, string]> = [
  [2761, 'Aesch'],
  [2762, 'Allschwil'],
  [2763, 'Arlesheim'],
  [2764, 'Biel-Benken'],
  [2765, 'Binningen'],
  [2766, 'Birsfelden'],
  [2767, 'Bottmingen'],
  [2768, 'Ettingen'],
  [2769, 'Münchenstein'],
  [2770, 'Muttenz'],
  [2771, 'Oberwil'],
  [2772, 'Pfeffingen'],
  [2773, 'Reinach'],
  [2774, 'Schönenbuch'],
  [2775, 'Therwil'],
  [2781, 'Blauen'],
  [2782, 'Brislach'],
  [2783, 'Burg im Leimental'],
  [2784, 'Dittingen'],
  [2785, 'Duggingen'],
  [2786, 'Grellingen'],
  [2787, 'Laufen'],
  [2788, 'Liesberg'],
  [2789, 'Nenzlingen'],
  [2790, 'Roggenburg'],
  [2791, 'Röschenz'],
  [2792, 'Wahlen'],
  [2793, 'Zwingen'],
  [2821, 'Arisdorf'],
  [2822, 'Augst'],
  [2823, 'Bubendorf'],
  [2824, 'Frenkendorf'],
  [2825, 'Füllinsdorf'],
  [2826, 'Giebenach'],
  [2827, 'Hersberg'],
  [2828, 'Lausen'],
  [2829, 'Liestal'],
  [2830, 'Lupsingen'],
  [2831, 'Pratteln'],
  [2832, 'Ramlinsburg'],
  [2833, 'Seltisberg'],
  [2834, 'Ziefen'],
  [2841, 'Anwil'],
  [2842, 'Böckten'],
  [2843, 'Buckten'],
  [2844, 'Buus'],
  [2845, 'Diepflingen'],
  [2846, 'Gelterkinden'],
  [2847, 'Häfelfingen'],
  [2848, 'Hemmiken'],
  [2849, 'Itingen'],
  [2850, 'Känerkinden'],
  [2851, 'Kilchberg'],
  [2852, 'Läufelfingen'],
  [2853, 'Maisprach'],
  [2854, 'Nusshof'],
  [2855, 'Oltingen'],
  [2856, 'Ormalingen'],
  [2857, 'Rickenbach'],
  [2858, 'Rothenfluh'],
  [2859, 'Rümlingen'],
  [2860, 'Rünenberg'],
  [2861, 'Sissach'],
  [2862, 'Tecknau'],
  [2863, 'Tenniken'],
  [2864, 'Thürnen'],
  [2865, 'Wenslingen'],
  [2866, 'Wintersingen'],
  [2867, 'Wittinsburg'],
  [2868, 'Zeglingen'],
  [2869, 'Zunzgen'],
  [2881, 'Arboldswil'],
  [2882, 'Bennwil'],
  [2883, 'Bretzwil'],
  [2884, 'Diegten'],
  [2885, 'Eptingen'],
  [2886, 'Hölstein'],
  [2887, 'Lampenberg'],
  [2888, 'Langenbruck'],
  [2889, 'Lauwil'],
  [2890, 'Liedertswil'],
  [2891, 'Niederdorf'],
  [2892, 'Oberdorf'],
  [2893, 'Reigoldswil'],
  [2894, 'Titterten'],
  [2895, 'Waldenburg']
]

function bezirkFor(bfsNummer: number): string {
  const treffer = BEZIRKE.find(
    (bezirk) => bfsNummer >= bezirk.von && bfsNummer <= bezirk.bis
  )
  if (treffer === undefined) {
    throw new Error(`No district covers BFS number ${bfsNummer}`)
  }
  return treffer.name
}

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('gemeinden', (table) => {
    table.uuid('id').primary().defaultTo(knex.raw('gen_random_uuid()'))
    table.integer('bfs_nummer').notNullable().unique()
    table.string('name', 120).notNullable()
    table.string('bezirk', 32).notNullable()
    // Off by default: a fresh install lists every municipality, and the
    // editorial team decides which ones are actually covered.
    table.boolean('aktiv').notNullable().defaultTo(false)
    table.timestamp('date_created', { useTz: true }).defaultTo(knex.fn.now())
    table.timestamp('date_updated', { useTz: true })
  })

  await knex('directus_collections').insert({
    collection: 'gemeinden',
    icon: 'location_city',
    note: 'Gemeinden des Kantons Basel-Landschaft. "Aktiv" steuert, fuer welche Gemeinden Meldungen erzeugt werden.',
    display_template: '{{ name }}',
    sort_field: 'name',
    archive_field: null,
    archive_value: null,
    unarchive_value: null,
    archive_app_filter: true,
    accountability: 'all',
    singleton: false,
    hidden: false,
    collapse: 'open',
    versioning: false
  })

  await knex('directus_fields').insert([
    {
      collection: 'gemeinden',
      field: 'id',
      special: 'uuid',
      interface: 'input',
      readonly: true,
      hidden: true,
      sort: 1,
      width: 'full'
    },
    {
      collection: 'gemeinden',
      field: 'bfs_nummer',
      interface: 'input',
      note: 'Offizielle BFS-Gemeindenummer. Verbindet die Gemeinde mit den Datensaetzen von data.bl.ch.',
      required: true,
      readonly: true,
      sort: 2,
      width: 'half'
    },
    {
      collection: 'gemeinden',
      field: 'name',
      interface: 'input',
      required: true,
      readonly: true,
      sort: 3,
      width: 'half'
    },
    {
      collection: 'gemeinden',
      field: 'bezirk',
      interface: 'select-dropdown',
      options: JSON.stringify({
        choices: BEZIRKE.map((bezirk) => ({
          text: bezirk.name,
          value: bezirk.name
        }))
      }),
      display: 'labels',
      readonly: true,
      sort: 4,
      width: 'half'
    },
    {
      collection: 'gemeinden',
      field: 'aktiv',
      interface: 'boolean',
      options: JSON.stringify({
        label: 'Wird bespielt'
      }),
      display: 'boolean',
      note: 'Nur aktive Gemeinden bekommen Meldungen.',
      sort: 5,
      width: 'half'
    },
    {
      collection: 'gemeinden',
      field: 'date_created',
      special: 'date-created',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      hidden: true,
      sort: 6,
      width: 'half'
    },
    {
      collection: 'gemeinden',
      field: 'date_updated',
      special: 'date-updated',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      readonly: true,
      hidden: true,
      sort: 7,
      width: 'half'
    }
  ])

  await knex('gemeinden').insert(
    GEMEINDEN.map(([bfsNummer, name]) => ({
      bfs_nummer: bfsNummer,
      name,
      bezirk: bezirkFor(bfsNummer),
      aktiv: false
    }))
  )
}

export async function down(knex: Knex): Promise<void> {
  await knex('directus_fields').where({ collection: 'gemeinden' }).delete()
  await knex('directus_collections').where({ collection: 'gemeinden' }).delete()
  await knex.schema.dropTableIfExists('gemeinden')
}
