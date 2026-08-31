import { defineOperationApp } from '@directus/extensions-sdk'

export default defineOperationApp({
  id: 'dossiers-ingest-imap',
  name: 'Dossiers aus Mailbox abrufen',
  icon: 'mail',
  description:
    'Holt ungelesene E-Mails mit PDF-Anhang aus der konfigurierten Mailbox (IMAP_*-Umgebungsvariablen) und legt dafuer neue Dossiers an (Status "pending"). Fuer zeitgesteuerte Ausfuehrung an einen Flow mit Schedule-Trigger haengen.',
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
        note: 'Obergrenze fuer die Anzahl E-Mails, die pro Lauf abgeholt werden.'
      },
      schema: { default_value: 5 }
    }
  ]
})
