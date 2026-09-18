import { defineOperationApp } from '@directus/extensions-sdk'

export default defineOperationApp({
  id: 'abstimmungen-holen',
  name: 'Abstimmungsresultate holen',
  icon: 'how_to_vote',
  description:
    'Liest die Abstimmungsresultate des heutigen Tages je Gemeinde von den erfassten Portalen. An einen Flow mit Schedule-Trigger haengen, der nur am Abstimmungssonntag zwischen Mittag und Abend feuert. Kein Modellaufruf: ohne Abstimmung kostet ein Lauf einen Abruf und schreibt nichts.',
  overview: ({ hoechstens, datum }) => [
    { label: 'Hoechstens Vorlagen pro Lauf', text: String(hoechstens ?? 20) },
    { label: 'Datum', text: String(datum ?? 'heute') }
  ],
  options: [
    {
      field: 'hoechstens',
      name: 'Hoechstens Vorlagen pro Lauf',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Obergrenze fuer einen Durchlauf. Ein Abstimmungssonntag traegt eine Handvoll Vorlagen; 20 ist reichlich.'
      },
      schema: { default_value: 20 }
    },
    {
      field: 'datum',
      name: 'Datum',
      type: 'string',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Leer lassen: dann gilt der heutige Tag in Schweizer Zeit. Ein Datum (JJJJ-MM-TT) holt einen Abstimmungssonntag von Hand nach.'
      },
      schema: { default_value: null }
    }
  ]
})
