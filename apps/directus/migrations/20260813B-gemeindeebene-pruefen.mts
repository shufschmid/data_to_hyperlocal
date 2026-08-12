import type { Knex } from 'knex'

// Bezirk ist nicht Gemeinde — und die Metadaten sagen das nicht.
//
// `detectMunicipalityFields` erkannte die Gemeindespalte an der Konzept-URI
// `DV_KT_BEZ_GDE_SNAP`. Die steht für **K**anton, **BEZ**irk, **GE**meinde: sie
// markiert die Hierarchie, nicht die Ebene. Deshalb trug `bezirk_nummer` in
// "Baukosten nach ... Bezirk und Jahr" genau das Kennzeichen, das Gemeindedaten
// beweisen sollte.
//
// Gemessen gegen unsere eigenen 86 BFS-Nummern sind es genau zwei Datensätze —
// beide mit null Treffern, weil Bezirke 1301–1305 nummeriert sind:
//
//   10210  Durchschnittlicher Verkaufspreis von Eigentumswohnungen nach Bezirk
//   10240  Baukosten nach Art und Kategorie der Auftraggeber, Bezirk und Jahr
//
// Sie werden hier direkt korrigiert, weil das eine Messung ist und keine
// Beurteilung. `gemeinde_geprueft` hält fest, wann eine Spalte gegen echte
// Werte geprüft wurde; der Schritt in `quellen-pruefen` arbeitet den Rest ab
// und hält es künftig von selbst richtig.

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('datensaetze', (table) => {
    table.timestamp('gemeinde_geprueft', { useTz: true })
  })

  await knex('directus_fields').insert({
    collection: 'datensaetze',
    field: 'gemeinde_geprueft',
    interface: 'datetime',
    display: 'datetime',
    display_options: JSON.stringify({ relative: true }),
    note: 'Wann die Gemeindespalte gegen echte Werte geprueft wurde. Leeren, um erneut zu pruefen.',
    readonly: true,
    sort: 23,
    width: 'half'
  })

  await knex('datensaetze').whereIn('externe_id', ['10210', '10240']).update({
    hat_gemeinde: false,
    status: 'ignoriert',
    bewertung:
      'Nicht relevant: Der Datensatz ist nach Bezirk gegliedert, nicht nach Gemeinde.',
    gemeinde_geprueft: new Date().toISOString()
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex('datensaetze')
    .whereIn('externe_id', ['10210', '10240'])
    .update({ hat_gemeinde: true, status: 'neu', bewertung: null })

  await knex('directus_fields')
    .where({ collection: 'datensaetze', field: 'gemeinde_geprueft' })
    .delete()

  await knex.schema.alterTable('datensaetze', (table) => {
    table.dropColumn('gemeinde_geprueft')
  })
}
