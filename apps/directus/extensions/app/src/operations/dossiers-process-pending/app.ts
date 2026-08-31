import { defineOperationApp } from '@directus/extensions-sdk'

export default defineOperationApp({
  id: 'dossiers-process-pending',
  name: 'Dossiers verarbeiten (ausstehende)',
  icon: 'auto_awesome',
  description:
    'Verarbeitet ausstehende Dossiers zu Sendungen (PDF parsen, Audio via SRGSSR aufloesen, Ausserdem-Themen via Claude zuordnen). Fuer zeitgesteuerte Ausfuehrung an einen Flow mit Schedule-Trigger haengen.',
  overview: ({ limit }) => [
    { label: 'Maximal pro Lauf', text: String(limit ?? 5) }
  ],
  options: [
    {
      field: 'limit',
      name: 'Maximal pro Lauf',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Obergrenze fuer die Anzahl Dossiers pro Lauf. Jeder Eintrag kostet einen PDF-Parse sowie mehrere SRGSSR- und Claude-Aufrufe, darum niedriger als bei einfacheren Batch-Jobs.'
      },
      schema: { default_value: 5 }
    }
  ]
})
