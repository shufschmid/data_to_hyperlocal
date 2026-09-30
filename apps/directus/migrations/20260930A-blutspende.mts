import type { Knex } from 'knex'

/**
 * Die Blutspende-Termine der zehn bespielten Gemeinden auf den Veranstaltungstisch.
 *
 * Die Redaktion hat am 30. September 2026 entschieden: die Termine von
 * Blutspende SRK kommen in den Veranstaltungs-Reiter jeder Gemeinde, und
 * eine Blutspende bekommt DREI Aufrufe — zwei Wochen davor, in der Woche,
 * am Tag (`redaktion/termin.ts`, `planeDreiAufrufe`).
 *
 * Gelesen wird blutspende.ch, gemessen am selben Tag: keine der beiden
 * Seiten (die regionale blutspende-nordwestschweiz.ch und die nationale) hat
 * eine API, aber die nationale hat eine Suche nach POSTLEITZAHL mit Radius 0
 * — und 4147 ist nur Aesch BL, waehrend eine Suche nach dem Namen 8904/8412/
 * 6287 Aesch und 4556/3703 Aeschi zurueckgibt. Darum je Gemeinde EINE Zeile
 * mit ihrer Postleitzahl in der Adresse: die Liste ist dann schon die ihre,
 * nichts muss nach Ort gefiltert werden. Eine Gemeinde mit mehreren
 * Postleitzahlen bekommt weitere Zeilen von Hand in der Karte.
 *
 * `art: organisation` ist der vierte Wert der Spalte und der erste ausser
 * `gemeinde` mit einem Leser (`shared/gemeindeseite/erkennung.ts`,
 * `blutspende_termine`). `plattform` wird gleich gestempelt, damit die Karte
 * die Zeile nicht als „noch kein Leser" zeigt, bevor der erste Lauf war.
 *
 * Aktiv gesaet, weil die Redaktion genau diese zehn verlangt hat. Idempotent:
 * `ON CONFLICT DO NOTHING` auf `(gemeinde, url)` (der Index aus 20260919A),
 * und nur, wo die Gemeinde erfasst ist.
 */

const NAME = 'Blutspende SRK Schweiz'

/** BFS-Nummer → Postleitzahl, gegen die Terminseiten geprueft (30.09.2026). */
const POSTLEITZAHLEN: ReadonlyArray<{ bfs: number; plz: string }> = [
  { bfs: 2761, plz: '4147' }, // Aesch
  { bfs: 2762, plz: '4123' }, // Allschwil
  { bfs: 2763, plz: '4144' }, // Arlesheim
  { bfs: 2765, plz: '4102' }, // Binningen
  { bfs: 2767, plz: '4103' }, // Bottmingen — heute ohne Termin, die Zeile sagt es
  { bfs: 2769, plz: '4142' }, // Muenchenstein
  { bfs: 2770, plz: '4132' }, // Muttenz
  { bfs: 2773, plz: '4153' }, // Reinach
  { bfs: 2831, plz: '4133' }, // Pratteln
  { bfs: 2703, plz: '4125' } // Riehen
]

export function terminlisteAdresse(plz: string): string {
  const url = new URL(
    'https://www.blutspende.ch/de/blutspendetermine/terminliste'
  )
  url.searchParams.set('location_search_form[radius]', '0')
  url.searchParams.set('location_search_form[term]', plz)
  return url.toString()
}

interface GemeindeZeile {
  id: string
}

export async function up(knex: Knex): Promise<void> {
  for (const { bfs, plz } of POSTLEITZAHLEN) {
    const gemeinde = (await knex('gemeinden')
      .select('id')
      .where({ bfs_nummer: bfs })
      .first()) as GemeindeZeile | undefined
    if (gemeinde === undefined) continue
    await knex('veranstaltungsquellen')
      .insert({
        id: knex.raw('gen_random_uuid()'),
        gemeinde: gemeinde.id,
        name: NAME,
        url: terminlisteAdresse(plz),
        art: 'organisation',
        aktiv: true,
        plattform: 'blutspende_termine',
        date_created: knex.fn.now()
      })
      .onConflict(['gemeinde', 'url'])
      .ignore()
  }
}

export async function down(): Promise<void> {
  // Die Zeilen tragen nach dem ersten Lauf Anlaesse und die Entscheide der
  // Redaktion daran (CASCADE) — sie zu entfernen waere keine Ruecknahme,
  // sondern ein Verlust. Ausschalten geht in der Karte der Gemeinde.
  throw new Error(
    'Nicht ruecknehmbar: die Blutspende-Kalender tragen Anlaesse und Entscheide.'
  )
}
