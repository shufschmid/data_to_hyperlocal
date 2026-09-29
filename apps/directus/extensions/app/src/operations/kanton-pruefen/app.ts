import { defineOperationApp } from '@directus/extensions-sdk'

// How the operation presents itself inside the Flow editor. Hang it on a
// Schedule trigger at 12:00 — the newsroom's time (29 September 2026), after
// the canton's own morning (measured news_dates: 10:00 for a press release,
// 11:15 for a police notice) and before the 13:00 municipal run.
export default defineOperationApp({
  id: 'kanton-pruefen',
  name: 'Kanton pruefen',
  icon: 'account_balance',
  description:
    'Liest die zwei Listen des Kantons Basel-Landschaft (Medienmitteilungen, Polizeimeldungen) ueber die Datentuer, die die Seite selbst ruft, oeffnet jeden neuen Eintrag und behaelt nur, was eine bespielte Gemeinde beim Namen nennt — eine Zeile je Gemeinde. Je Gemeinde sortiert eine Sichtung die neuen Zeilen, und jeder Vorschlag bekommt seinen Entwurf. Die oeffentliche Seite wird nur verlinkt, nie geholt.',
  overview: ({ bSize, nachlauf }) => [
    { label: 'Eintraege je Liste', text: String(bSize ?? 50) },
    { label: 'Nachlauf in Tagen', text: String(nachlauf ?? 3) }
  ],
  options: [
    {
      field: 'bSize',
      name: 'Eintraege je Liste',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Die erste Seite jeder Liste, neueste zuerst. 50 deckt eine Woche bei ein bis zwei Eintraegen am Tag; hoechstens 100.'
      },
      schema: { default_value: 50 }
    },
    {
      field: 'nachlauf',
      name: 'Nachlauf in Tagen',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Wie weit ein Lauf zurueckschaut. Eintraege ohne bespielte Gemeinde werden im Fenster jeden Tag erneut geoeffnet.'
      },
      schema: { default_value: 3 }
    },
    {
      field: 'erstlauf',
      name: 'Erster Lauf in Tagen',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Was eine Liste beim ersten Lesen importiert. Nie das Archiv — die Listen reichen Jahre zurueck.'
      },
      schema: { default_value: 7 }
    },
    {
      field: 'pause',
      name: 'Pause zwischen Anfragen (ms)',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Abstand zwischen zwei Anfragen an die Datentuer.'
      },
      schema: { default_value: 2000 }
    }
  ]
})
