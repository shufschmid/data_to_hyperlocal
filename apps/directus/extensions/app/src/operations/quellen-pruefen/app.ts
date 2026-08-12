import { defineOperationApp } from '@directus/extensions-sdk'

// How the operation presents itself inside the Flow editor. `options` become the
// fields an editor fills in; they arrive as the first argument of the api.ts
// handler.
export default defineOperationApp({
  id: 'quellen-pruefen',
  name: 'Quellen auf neue Datensaetze pruefen',
  icon: 'travel_explore',
  description:
    'Fragt jede aktive Quelle nach neuen oder geaenderten Datensaetzen und bewertet offene mit der Claude-API. Fuer den taeglichen Lauf an einen Flow mit Schedule-Trigger haengen.',
  overview: ({
    seiten,
    bewertungen,
    zuordnungen,
    tabellen,
    gemeindepruefungen,
    model
  }) => [
    { label: 'Katalogseiten je Quelle', text: String(seiten ?? 2) },
    { label: 'Bewertungen pro Lauf', text: String(bewertungen ?? 10) },
    { label: 'Zuordnungen pro Lauf', text: String(zuordnungen ?? 10) },
    { label: 'Verlinkte Tabellen pro Lauf', text: String(tabellen ?? 5) },
    {
      label: 'Gemeindepruefungen pro Lauf',
      text: String(gemeindepruefungen ?? 25)
    },
    { label: 'Modell', text: model || 'Standard (ANTHROPIC_MODEL)' }
  ],
  options: [
    {
      field: 'seiten',
      name: 'Katalogseiten je Quelle',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Je Seite 100 Datensaetze. Zwei Seiten decken data.bl.ch heute vollstaendig ab.'
      },
      schema: { default_value: 2 }
    },
    {
      field: 'bewertungen',
      name: 'Bewertungen pro Lauf',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Obergrenze fuer Claude-Aufrufe. Offene Datensaetze werden ueber mehrere Laeufe abgearbeitet.'
      },
      schema: { default_value: 10 }
    },
    {
      field: 'zuordnungen',
      name: 'Zuordnungen pro Lauf',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Obergrenze fuer Claude-Aufrufe, die einen Agenda-Eintrag dem passenden Datensatz zuordnen. Der Katalog liegt im gecachten Prompt-Praefix, die Aufrufe sind entsprechend guenstig.'
      },
      schema: { default_value: 10 }
    },
    {
      field: 'tabellen',
      name: 'Verlinkte Tabellen pro Lauf',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Agenda-Eintraege, die direkt auf eine Tabelle von statistik.bl.ch zeigen. Die Tabelle wird gelesen, auf Gemeindegliederung geprueft und als Datensatz uebernommen — ohne Modellaufruf.'
      },
      schema: { default_value: 5 }
    },
    {
      field: 'gemeindepruefungen',
      name: 'Gemeindepruefungen pro Lauf',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Prueft die erkannte Gemeindespalte gegen die echten Werte — eine kleine Abfrage je Datensatz, einmalig. Die Metadaten unterscheiden Bezirk und Gemeinde nicht.'
      },
      schema: { default_value: 25 }
    },
    {
      field: 'model',
      name: 'Modell',
      type: 'string',
      meta: {
        width: 'full',
        interface: 'input',
        note: 'Leer lassen, um ANTHROPIC_MODEL aus der Umgebung zu verwenden.'
      }
    }
  ]
})
