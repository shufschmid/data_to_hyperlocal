import { defineOperationApp } from '@directus/extensions-sdk'

// How the operation presents itself inside the Flow editor. Hang it on a
// Schedule trigger at 14:45 and 16:45 — SMD mails the dossier at 14:30
// (measured over fourteen days, 14:30 or 14:34), the second slot is the free
// retry: the fetch dedups on the subject.
export default defineOperationApp({
  id: 'smd-pruefen',
  name: 'SMD pruefen',
  icon: 'newspaper',
  description:
    'Holt die SMD-Dossiers der gespeicherten Recherche «gemeinden» aus dem Postfach, liest jedes PDF ueber sein Inhaltsverzeichnis in Dokumente, zerlegt Newsblogs in ihre neuen Eintraege, behaelt nur, was eine bespielte Gemeinde beim Namen nennt, sucht den Online-Artikel ueber die Verlagstuer und sichtet je Gemeinde die neuen Zeilen. Meldungen entstehen erst, wenn die Redaktion uebernimmt.',
  overview: ({ limit, blogFenster }) => [
    { label: 'Mails je Lauf', text: String(limit ?? 3) },
    { label: 'Blog-Fenster in Tagen', text: String(blogFenster ?? 3) }
  ],
  options: [
    {
      field: 'limit',
      name: 'Mails je Lauf',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Ein Tag bringt eine Mail; eine verpasste Woche wird in wenigen Laeufen aufgearbeitet. Hoechstens 10.'
      },
      schema: { default_value: 3 }
    },
    {
      field: 'blogFenster',
      name: 'Blog-Fenster in Tagen',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Ein Blog kommt jedes Mal ganz; nur Eintraege, die hoechstens so viele Tage vor dem Dossier liegen, sind neu. Aeltere werden gezaehlt, nie gespeichert.'
      },
      schema: { default_value: 3 }
    },
    {
      field: 'maxSeiten',
      name: 'Verlagsseiten je Lauf',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Wie viele Artikelseiten der Verlage ein Lauf hoechstens liest, um den Online-Artikel zu finden. Die BaZ listet sechs bis acht eigene Artikel am Tag.'
      },
      schema: { default_value: 30 }
    },
    {
      field: 'model',
      name: 'Modell der Sichtung',
      type: 'string',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Leer: das Modell der Umgebung. Eine Modell-ID ueberschreibt es fuer diese Sichtung.'
      },
      schema: { default_value: null }
    }
  ]
})
