import type { Knex } from 'knex'

// Was der Katalog über einen Datensatz sagt — und wir bisher weggeworfen haben.
//
// Die Arbeitsteilung, die die Redaktion vorgeschlagen hat, verlangt es: die
// Maschine sortiert aus, was mechanisch entscheidbar ist, der Mensch entscheidet
// über den journalistischen Wert. Für das Zweite braucht er etwas zu sehen.
//
//   `rhythmus`     wie oft das Amt nachführt. Steht im DCAT-Block des Katalogs
//                  und beantwortet eine Frage, die kein Titel beantwortet: von
//                  181 Datensätzen werden 43 täglich oder öfter aktualisiert —
//                  Zefix, Motorfahrzeuge, Messwerte. Register ohne
//                  Berichtsperiode, über die sich nichts schreiben lässt, das
//                  in fünf Jahren noch stimmt.
//
//   `daten_stand`  wann sich die *Daten* zuletzt bewegt haben. Bisher zeigte die
//                  Zeitleiste `portal_modified`, und das springt auch bei einer
//                  korrigierten Beschreibung. Bei 10010 steht dort der 3.8.,
//                  während die Zahlen vom 21.7. sind — die Liste sah voller aus,
//                  als tatsächlich passiert war.
//
//   `zeilen`       wie viele Zeilen dahinterstehen. 349'626 gegenüber 86 sagt
//                  auf einen Blick, ob eine Tabelle eine Statistik ist oder
//                  eine Liste.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('datensaetze', (table) => {
    table.string('rhythmus', 40)
    table.timestamp('daten_stand', { useTz: true })
    table.integer('zeilen')
  })

  await knex('directus_fields').insert([
    {
      collection: 'datensaetze',
      field: 'rhythmus',
      interface: 'input',
      note: 'Aktualisierungsrhythmus laut Katalog: annual, daily, irregular …',
      readonly: true,
      sort: 24,
      width: 'half'
    },
    {
      collection: 'datensaetze',
      field: 'daten_stand',
      interface: 'datetime',
      display: 'datetime',
      display_options: JSON.stringify({ relative: true }),
      note: 'Wann sich die Daten selbst zuletzt geaendert haben — nicht die Beschreibung.',
      readonly: true,
      sort: 25,
      width: 'half'
    },
    {
      collection: 'datensaetze',
      field: 'zeilen',
      interface: 'input',
      note: 'Zeilen im Portal.',
      readonly: true,
      sort: 26,
      width: 'half'
    }
  ])
}

export async function down(knex: Knex): Promise<void> {
  await knex('directus_fields')
    .where({ collection: 'datensaetze' })
    .whereIn('field', ['rhythmus', 'daten_stand', 'zeilen'])
    .delete()

  await knex.schema.alterTable('datensaetze', (table) => {
    table.dropColumn('rhythmus')
    table.dropColumn('daten_stand')
    table.dropColumn('zeilen')
  })
}
