import { defineOperationApp } from '@directus/extensions-sdk'

// How the operation presents itself inside the Flow editor. Hang it on a
// Schedule trigger every hour: the Buschtelefon collects in runs (Facebook
// Sunday to Thursday from 13:00, Instagram daily at 12:00, TikTok after the
// round is uploaded), so asking more often brings nothing.
export default defineOperationApp({
  id: 'buschtelefon-abholen',
  name: 'Buschtelefon abholen',
  icon: 'forum',
  description:
    'Holt die Rohfunde des Buschtelefons (Facebook-Gruppen, Instagram, TikTok der Gemeinden) über dessen Übergabetür und speichert sie je Fund einmal (Upsert über die Kennung). Gelesen wird ab dem letzten Stand minus zwei Stunden, seitenweise. Fehlen die Zugangsdaten (BUSCHTELEFON_*), läuft nichts und der Lauf nennt, was fehlt. Die Funde sind Rohmaterial von Privatpersonen und nur für die Redaktion lesbar.',
  overview: ({ limit }) => [
    { label: 'Funde je Seite', text: String(limit ?? 200) }
  ],
  options: [
    {
      field: 'limit',
      name: 'Funde je Seite',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Höchstzahl der Funde einer Antwort der Übergabetür. Vorgabe 200, höchstens 1000. Weitere Seiten folgen von selbst.'
      },
      schema: { default_value: 200 }
    }
  ]
})
