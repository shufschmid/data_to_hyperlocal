import type { Knex } from 'knex'

// Zurück in die Bewertung: was die alte Zeitachsen-Erkennung zu Unrecht
// aussortiert hat.
//
// `detectPeriodField` verlangte genau eine Spalte vom Typ `date` und gab sonst
// auf. Vier gemeindescharfe Datensätze fielen dabei durch, obwohl sie eine
// Zeitachse haben:
//
//   11970  Arealstatistik nach Gemeinde (seit 1982)  `erhebungsjahr_e` ist Text
//   12150  Wohnbevölkerung (1699–2000)               `jahr` ist Text
//   12780  Wahlen: Kandidierendenresultate           zwei Datumsspalten, eine
//   12490  Wahlen Gemeindepräsidien 2024             davon ein Geburtsjahr
//
// Dazu vier, die ihren Grund verloren haben: `uebernehme()` leert bei einer
// Datenänderung `bewertung`, behält aber den Status — übrig blieb „ignoriert,
// ohne dass jemand sagt warum".
//
// Sie gehen auf `neu` mit leerer Bewertung, nicht auf `relevant`. Die
// Relevanzprüfung urteilt neu; diese Migration entscheidet nichts über den
// journalistischen Wert, sie macht nur eine Fehlentscheidung rückgängig.

const ZU_UNRECHT = ['11970', '12150', '12780', '12490']
const OHNE_BEGRUENDUNG = ['12160', '12170', '12180', '12990']

export async function up(knex: Knex): Promise<void> {
  await knex('datensaetze')
    .whereIn('externe_id', [...ZU_UNRECHT, ...OHNE_BEGRUENDUNG])
    .andWhere({ status: 'ignoriert' })
    .update({ status: 'neu', bewertung: null })
}

export async function down(knex: Knex): Promise<void> {
  await knex('datensaetze')
    .whereIn('externe_id', [...ZU_UNRECHT, ...OHNE_BEGRUENDUNG])
    .andWhere({ status: 'neu' })
    .update({
      status: 'ignoriert',
      bewertung: 'Nicht relevant: von 20260813A zurueckgesetzt.'
    })
}
