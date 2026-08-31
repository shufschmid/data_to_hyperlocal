import { defineOperationApp } from '@directus/extensions-sdk'

export default defineOperationApp({
  id: 'punkt6-dossiers-process-pending',
  name: 'Punkt6-Dossiers verarbeiten (ausstehende)',
  icon: 'auto_awesome',
  description:
    'Verarbeitet ausstehende Punkt6-Dossiers zu Beitraegen (PDF parsen, Video via telebasel.ch aufloesen, Lead via Claude schreiben). Fuer zeitgesteuerte Ausfuehrung an einen Flow mit Schedule-Trigger haengen.',
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
        note: 'Obergrenze fuer die Anzahl Dossiers pro Lauf. Jeder Eintrag kostet einen PDF-Parse sowie Aufrufe an telebasel.ch und optional Claude.'
      },
      schema: { default_value: 5 }
    }
  ]
})
