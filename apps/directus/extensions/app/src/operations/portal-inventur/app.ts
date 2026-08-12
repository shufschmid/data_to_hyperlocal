import { defineOperationApp } from '@directus/extensions-sdk'

// How the inventory presents itself in the Flow editor.
//
// The page budget is the important field and the note says why: this walks a
// host that gives us no API and no conditional requests, so the speed of the
// walk is a decision about someone else's server, not about our patience.
export default defineOperationApp({
  id: 'portal-inventur',
  name: 'Statistikportal inventarisieren',
  icon: 'travel_explore',
  description:
    'Geht das Statistikportal einmal durch und ordnet jede Seite ein: Gemeindetabelle? Schon als Open Data vorhanden? Schon in der Agenda? Daraus ergibt sich, welche Zweige taeglich geprueft werden.',
  overview: ({ seiten, abdeckungen, model }) => [
    { label: 'Seiten pro Lauf', text: String(seiten ?? 200) },
    { label: 'Abdeckungspruefungen pro Lauf', text: String(abdeckungen ?? 40) },
    { label: 'Modell', text: model || 'Standard (ANTHROPIC_MODEL)' }
  ],
  options: [
    {
      field: 'seiten',
      name: 'Seiten pro Lauf',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Das ganze Portal sind rund 2800 Seiten. Sie werden ueber mehrere Laeufe geholt, eine Anfrage pro Sekunde. Der Lauf setzt fort, wo er stand.'
      },
      schema: { default_value: 200 }
    },
    {
      field: 'abdeckungen',
      name: 'Abdeckungspruefungen pro Lauf',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Obergrenze fuer Claude-Aufrufe: je gefundener Gemeindetabelle einer, gegen Datensatzkatalog und Agenda. Beide liegen im gecachten Prompt-Praefix.'
      },
      schema: { default_value: 40 }
    },
    {
      field: 'model',
      name: 'Modell',
      type: 'string',
      meta: {
        width: 'full',
        interface: 'input',
        note: 'Leer lassen, um ANTHROPIC_MODEL aus der Umgebung zu verwenden.'
      }
    }
  ]
})
