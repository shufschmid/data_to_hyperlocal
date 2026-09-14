import { defineOperationApp } from '@directus/extensions-sdk'

export default defineOperationApp({
  id: 'entsorgung-publizieren',
  name: 'Entsorgungserinnerungen publizieren',
  icon: 'schedule_send',
  description:
    'Publiziert freigegebene Entsorgungserinnerungen am Vortag ihres Erscheinungstags um 12 Uhr — die feste Zeit der Redaktion. An einen Flow mit Schedule-Trigger um 12:00 haengen (0 12 * * *). Kein Modellaufruf, keine Kosten.',
  overview: ({ hoechstens }) => [
    { label: 'Hoechstens pro Lauf', text: String(hoechstens ?? 50) }
  ],
  options: [
    {
      field: 'hoechstens',
      name: 'Hoechstens pro Lauf',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Obergrenze fuer einen Durchlauf. 50 reicht fuer alle Gemeinden an einem Tag.'
      },
      schema: { default_value: 50 }
    }
  ]
})
