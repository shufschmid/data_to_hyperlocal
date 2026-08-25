import { defineOperationApp } from '@directus/extensions-sdk'

// How the operation presents itself inside the Flow editor. Hang it on a
// Schedule trigger at 09:00 — every paper publishes on its own weekday, and a
// daily look is what catches each of them the morning after.
export default defineOperationApp({
  id: 'wochenblatt-pruefen',
  name: 'Wochenblaetter pruefen',
  icon: 'newspaper',
  description:
    'Liest die Archive der registrierten Wochenblaetter. Eine neue Ausgabe wird geholt, abgelegt und zu Kandidaten inventarisiert — Meldungen entstehen erst, wenn die Redaktion Kandidaten uebernimmt.',
  overview: ({ blaetter }) => [
    { label: 'Blaetter pro Lauf', text: String(blaetter ?? 10) }
  ],
  options: [
    {
      field: 'blaetter',
      name: 'Blaetter pro Lauf',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Obergrenze, damit ein Lauf nicht unbegrenzt liest.'
      },
      schema: { default_value: 10 }
    }
  ]
})
