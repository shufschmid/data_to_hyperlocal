import { defineOperationApp } from '@directus/extensions-sdk'

// How the operation presents itself inside the Flow editor. Hang it on a
// Schedule trigger at 13:00 — the newsroom's rule: after noon, before two.
// Municipalities publish in the morning; the midday run collects the morning
// the same day, and the three-day look-back catches what appears later.
export default defineOperationApp({
  id: 'gemeindeseiten-pruefen',
  name: 'Gemeindeseiten pruefen',
  icon: 'campaign',
  description:
    'Liest die Newsseite jeder bespielten Gemeinde, die eine registriert hat: neue Eintraege werden erkannt, jede Unterseite samt verlinkten PDFs eingesammelt, und eine Sichtung je Gemeinde sortiert, was einen Blick lohnt. robots.txt wird befolgt, jede Kappung deklariert. Meldungen entstehen erst, wenn die Redaktion uebernimmt.',
  overview: ({ gemeinden, details }) => [
    { label: 'Gemeinden pro Lauf', text: String(gemeinden ?? 20) },
    { label: 'Unterseiten pro Gemeinde', text: String(details ?? 15) }
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
      field: 'details',
      name: 'Unterseiten pro Gemeinde',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Wie viele neue Eintraege je Gemeinde und Lauf geoeffnet werden. Was darueber liegt, wird gezaehlt und morgen weitergelesen.'
      },
      schema: { default_value: 15 }
    },
    {
      field: 'nachlauf',
      name: 'Nachlauf in Tagen',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Wie weit ein Lauf zurueckschaut. Die Seiten datieren auf den Tag — etwas Ueberlappung faengt Nachzuegler.'
      },
      schema: { default_value: 3 }
    },
    {
      field: 'erstlauf',
      name: 'Erster Lauf in Tagen',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Was eine neu registrierte Seite beim ersten Lesen importiert. Nie das Archiv — einige Seiten listen Hunderte Eintraege.'
      },
      schema: { default_value: 7 }
    },
    {
      field: 'pause',
      name: 'Pause je Host (ms)',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Abstand zwischen zwei Anfragen an denselben Host. Ein Crawl-delay in robots.txt erhoeht ihn, senkt ihn nie.'
      },
      schema: { default_value: 2000 }
    }
  ]
})
