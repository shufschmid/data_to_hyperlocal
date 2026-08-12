import { defineHook } from '@directus/extensions-sdk'
import { agendaSchluessel } from '../../shared/agenda'

// Derives `ankuendigungen.schluessel` from the title, on every write path.
//
// It has to be a hook rather than something the operation does, because the
// operation is not the only writer: when the agenda page turns the crawler away
// — it sits behind a bot check — a person opens the page and types the entry
// into the admin UI instead. A key computed only in the operation would leave
// those rows without one, and the next automated run would then create a
// duplicate instead of recognising the entry.
//
// `filter` and not `action`: this is the last point at which the payload can
// still be changed before it is stored.
export default defineHook(({ filter }) => {
  const ableiten = (
    payload: Record<string, unknown>
  ): Record<string, unknown> => {
    const titel = payload['titel']
    if (typeof titel !== 'string' || titel.trim() === '') return payload

    return {
      ...payload,
      schluessel: agendaSchluessel({
        datum: null,
        quartal: null,
        titel,
        link: null,
        status: 'geplant'
      })
    }
  }

  filter('ankuendigungen.items.create', (payload) =>
    ableiten(payload as Record<string, unknown>)
  )

  // On update the title may change; the key follows it so the row keeps
  // matching what the agenda page now calls this statistic.
  filter('ankuendigungen.items.update', (payload) =>
    ableiten(payload as Record<string, unknown>)
  )
})
