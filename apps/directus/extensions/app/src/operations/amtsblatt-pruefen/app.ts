import { defineOperationApp } from '@directus/extensions-sdk'

// How the operation presents itself inside the Flow editor. Hang it on a
// Schedule trigger at 07:00 — the cantonal gazettes publish in the morning, and
// a deadline is worth more the day it appears than the day after.
export default defineOperationApp({
  id: 'amtsblatt-pruefen',
  name: 'Amtsblatt pruefen',
  icon: 'gavel',
  description:
    'Liest die amtlichen Publikationen der bespielten Gemeinden aus dem Amtsblattportal — kantonal und SHAB. Eine Sichtung sortiert, was einen Blick lohnt; zu den Vorschlaegen werden die aufgelegten Plaene angesehen. Meldungen entstehen erst, wenn die Redaktion uebernimmt.',
  overview: ({ gemeinden, plaene }) => [
    { label: 'Gemeinden pro Lauf', text: String(gemeinden ?? 20) },
    { label: 'Planlesungen pro Lauf', text: String(plaene ?? 6) }
  ],
  options: [
    {
      field: 'gemeinden',
      name: 'Gemeinden pro Lauf',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Obergrenze, damit ein Lauf nicht unbegrenzt liest.'
      },
      schema: { default_value: 20 }
    },
    {
      field: 'plaene',
      name: 'Planlesungen pro Lauf',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Wie viele Vorschlaege ihre aufgelegten Plaene angesehen bekommen. Ein Opus-Aufruf mit Bildern je Stueck — hier bremst die Rechnung, nicht die Technik.'
      },
      schema: { default_value: 6 }
    },
    {
      field: 'nachlauf',
      name: 'Nachlauf in Tagen',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Wie weit ein Lauf zurueckschaut. Das Portal datiert auf den Tag genau, nicht auf die Stunde — ein bisschen Ueberlappung kostet nichts und faengt Nachzuegler.'
      },
      schema: { default_value: 2 }
    }
  ]
})
