import { defineOperationApp } from '@directus/extensions-sdk'

// How the operation presents itself inside the Flow editor. Hang it on a
// Schedule trigger — once a day is enough, since the sources only ever show the
// coming few weeks.
//
// There is deliberately no "Sportart" option: which source gets asked is decided
// per club by `vereine.quelle`, so a Flow does not have to be duplicated for
// every sport. Clubs whose sport has no connector yet are skipped and named in
// the log.
export default defineOperationApp({
  id: 'sportresultate-holen',
  name: 'Sportresultate holen',
  icon: 'scoreboard',
  description:
    'Liest die Spiele aller aktiven Vereine und legt sie als Resultate und kommende Begegnungen ab. Fussball braucht einen Aufruf fuer alle Vereine, Volleyball einen pro Team.',
  overview: ({ hoechstens }) => [
    { label: 'Spiele pro Lauf', text: String(hoechstens ?? 200) }
  ],
  options: [
    {
      field: 'hoechstens',
      name: 'Spiele pro Lauf',
      type: 'integer',
      meta: {
        width: 'half',
        interface: 'input',
        note: 'Obergrenze, damit ein Lauf nicht unbegrenzt schreibt.'
      },
      schema: { default_value: 200 }
    }
  ]
})
