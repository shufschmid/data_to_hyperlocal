import { defineOperationApp } from '@directus/extensions-sdk'

export default defineOperationApp({
  id: 'redaktion-abarbeiten',
  name: 'Meldungen erzeugen (offene Arbeit)',
  icon: 'edit_note',
  description:
    'Eroeffnet Laeufe fuer freigegebene Datensaetze, erstellt das Briefing und schreibt die Meldungen. An einen Flow mit Schedule-Trigger haengen (alle 2 bis 5 Minuten) und die Aktivitaets-Protokollierung dieses Flows abschalten.',
  overview: ({ laeufe, meldungen }) => [
    { label: 'Briefings pro Durchlauf', text: String(laeufe ?? 1) },
    { label: 'Meldungen pro Durchlauf', text: String(meldungen ?? 5) }
  ],
  options: [
    {
      field: 'laeufe',
      name: 'Briefings pro Durchlauf',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Je Briefing ein Aufruf des grossen Modells. Eins pro Durchlauf reicht.'
      },
      schema: { default_value: 1 }
    },
    {
      field: 'meldungen',
      name: 'Meldungen pro Durchlauf',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Je Meldung ein guenstiger Aufruf. Hoeher heisst schneller fertig, aber laengere Durchlaeufe.'
      },
      schema: { default_value: 5 }
    },
    {
      field: 'briefing_modell',
      name: 'Modell fuer das Briefing',
      type: 'string',
      meta: {
        width: 'full',
        interface: 'input',
        note: 'Leer lassen fuer claude-opus-5. Auf claude-sonnet-5 umstellen, wenn Opus ueberlastet ist — ein Briefing von Sonnet ist besser als keines.'
      }
    }
  ]
})
