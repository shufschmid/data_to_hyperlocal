import type { Knex } from 'knex'

/**
 * Riehens offizieller Veranstaltungskalender ins Grundangebot.
 *
 * `20260919A` hat die Kalender der Gemeinden aus `gemeinden.veranstaltungen_url`
 * uebernommen — neun Zeilen. Riehen fehlte, weil sein Kalender gar nicht auf
 * der Gemeindeseite liegt: er hat eine eigene Domain und ein eigenes CMS
 * (Drupal mit einer JSON-Tuer). Die Redaktion hat am 20. September 2026
 * festgehalten, dass das trotzdem der Kalender DER GEMEINDE ist und in dieses
 * Angebot gehoert — nicht als Fremdplattform, die stillsteht, sondern als
 * `art: gemeinde`, die gelesen wird. Der Leser dafuer ist seit demselben Tag
 * da (`shared/veranstaltung/drupal.ts`).
 *
 * Erfasst wird die AGENDA-Seite und nicht die Startseite: sie ist die
 * Uebersicht, die eine Redaktorin auch von Hand eintragen wuerde, und ihr
 * Fingerabdruck ist die Komponente, die die Datentuer ruft.
 *
 * Idempotent: `ON CONFLICT DO NOTHING` auf `(gemeinde, url)`, und es wird nur
 * geschrieben, wo die Gemeinde ueberhaupt erfasst ist. Eine bereits von Hand
 * angelegte Zeile derselben Adresse wird auf `art: gemeinde` gehoben — genau
 * der Fall, den eine Redaktorin am 20.09. erzeugt hat, als der Leser noch
 * fehlte und die Karte nur „Plattform" anbot.
 */

const AGENDA = 'https://www.riehenevents.ch/de/page/agenda'
const NAME = 'Veranstaltungskalender der Gemeinde Riehen'

interface GemeindeZeile {
  id: string
}

export async function up(knex: Knex): Promise<void> {
  const gemeinde = (await knex('gemeinden')
    .select('id')
    .where({ name: 'Riehen' })
    .first()) as GemeindeZeile | undefined
  if (gemeinde === undefined) return

  // Eine schon erfasste Zeile desselben Kalenders wird GEHOBEN, nie
  // verdoppelt: wer ihn von Hand eintrug, als es den Leser noch nicht gab,
  // konnte ihn nur als Plattform erfassen — und diese Zeile ist dieselbe
  // Quelle, samt allem, was inzwischen an ihr haengt.
  const bestehend = await knex('veranstaltungsquellen')
    .where({ gemeinde: gemeinde.id })
    .whereRaw("url LIKE '%riehenevents.ch%'")
    .update({ art: 'gemeinde', aktiv: true, letzter_hinweis: null })

  if (bestehend > 0) return

  await knex('veranstaltungsquellen').insert({
    id: knex.raw('gen_random_uuid()'),
    gemeinde: gemeinde.id,
    name: NAME,
    url: AGENDA,
    art: 'gemeinde',
    aktiv: true,
    date_created: knex.fn.now()
  })
}

export async function down(): Promise<void> {
  // Die Zeile wieder zu entfernen hiesse, Riehen ohne Kalender zurueckzulassen
  // — und mit ihr gingen (CASCADE) alle Anlaesse und damit die Entscheide der
  // Redaktion daran verloren. Das ist keine Ruecknahme, das ist ein Verlust.
  throw new Error(
    'Nicht ruecknehmbar: Riehens Kalender traegt inzwischen Anlaesse und Entscheide.'
  )
}
