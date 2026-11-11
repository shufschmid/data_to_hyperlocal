import { defineOperationApp } from '@directus/extensions-sdk'

// How the operation presents itself inside the Flow editor. Hang it on a
// Schedule trigger at 12:00, with 13:00 and 14:00 as free retries — the
// Buschtelefon releases one fixed state a day, at the end of its collecting
// run and no later than 11:55 (contract, section 2).
export default defineOperationApp({
  id: 'buschtelefon-abholen',
  name: 'Buschtelefon abholen',
  icon: 'forum',
  description:
    'Holt beim Buschtelefon ab, was seit dem Lesezeichen neu ist oder sich geaendert hat: Beitraege aus den Facebook-Gruppen der Doerfer samt Bildtexten und Kommentaren. Ein unentschiedener Fund wird durch den neuen Stand ersetzt, ein entschiedener bleibt. Danach raeumt der Lauf auf (die Zeile bleibt, das Material geht), benotet je Gemeinde die neuen und geaenderten Funde und schreibt zu jedem Vorschlag mit Gemeinde einen Entwurf. Publiziert wird nichts ohne Entscheid einer Person.',
  overview: ({ limit, entwuerfe }) => [
    { label: 'Funde je Seite', text: String(limit ?? 200) },
    { label: 'Entwuerfe je Lauf', text: String(entwuerfe ?? 20) }
  ],
  options: [
    {
      field: 'limit',
      name: 'Funde je Seite',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Wie viele Eintraege die Tuer je Seite liefert; der Lauf blaettert, bis nichts mehr folgt. Hoechstens 500.'
      },
      schema: { default_value: 200 }
    },
    {
      field: 'entwuerfe',
      name: 'Entwuerfe je Lauf',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Ein Modellaufruf je Entwurf. Was der Deckel liegen laesst, wird genannt und am naechsten Tag geschrieben.'
      },
      schema: { default_value: 20 }
    }
  ]
})
