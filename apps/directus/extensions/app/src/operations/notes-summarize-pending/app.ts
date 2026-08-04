import { defineOperationApp } from '@directus/extensions-sdk'

// The admin-UI half of the operation: what it looks like inside the Flow editor.
// `options` become the fields an operator fills in; they arrive as the first
// argument of the api.ts handler.
export default defineOperationApp({
  id: 'notes-summarize-pending',
  name: 'Notizen zusammenfassen (offene)',
  icon: 'auto_awesome',
  description:
    'Fasst veroeffentlichte Notizen ohne Zusammenfassung ueber die Claude-API zusammen. Fuer zeitgesteuerte Ausfuehrung an einen Flow mit Schedule-Trigger haengen.',
  overview: ({ limit, model }) => [
    { label: 'Maximal pro Lauf', text: String(limit ?? 10) },
    { label: 'Modell', text: model || 'Standard (ANTHROPIC_MODEL)' }
  ],
  options: [
    {
      field: 'limit',
      name: 'Maximal pro Lauf',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Obergrenze fuer die Anzahl Claude-Aufrufe pro Lauf.'
      },
      schema: { default_value: 10 }
    },
    {
      field: 'model',
      name: 'Modell',
      type: 'string',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Leer lassen, um ANTHROPIC_MODEL aus der Umgebung zu verwenden.'
      }
    }
  ]
})
