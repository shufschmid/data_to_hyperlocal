import { defineOperationApi } from '@directus/extensions-sdk'
import { holeFunde } from '../../redaktion/buschtelefonlauf'
import { liesZugang, type FetchLike } from '../../shared/buschtelefon/client'

// The hourly look at what the Buschtelefon collected.
//
// One read of the hand-over door from the stored stand minus two hours,
// paged, stored once per find (upsert by `kennung`), then the cleanup. No
// model call: the finds are raw material, and the newsroom decides at the
// desk. The Meldung is written on the click.
//
// Without the BUSCHTELEFON_* variables the run does nothing and says what is
// missing in its result — no error, and no log line per hour. A failure is
// logged once and again only when its text changes, so an hour-by-hour
// outage fills the log once, not 24 times a day.

interface Optionen {
  limit?: number
}

/** The last thing this process logged about the door — to log a state change, not a state. */
let zuletztGemeldet: string | null = null

function meldeEinmal(schluessel: string, melde: () => void): void {
  if (zuletztGemeldet === schluessel) return
  zuletztGemeldet = schluessel
  melde()
}

export default defineOperationApi<Optionen>({
  id: 'buschtelefon-abholen',
  handler: async (optionen, { services, getSchema, logger }) => {
    const { ItemsService } = services
    const schema = await getSchema()
    const limit =
      typeof optionen.limit === 'number' && optionen.limit > 0
        ? Math.min(1000, Math.floor(optionen.limit))
        : undefined

    const ergebnis = await holeFunde({
      funde: new ItemsService('buschtelefon_funde', { schema }) as never,
      gemeinden: new ItemsService('gemeinden', { schema }) as never,
      zugang: liesZugang(),
      holen: fetch as unknown as FetchLike,
      ...(limit === undefined ? {} : { limit }),
      logger
    })

    if (ergebnis.status === 'fehler') {
      meldeEinmal(`fehler:${ergebnis.fehler.join('|')}`, () =>
        logger.warn(`buschtelefon: ${ergebnis.fehler.join(' · ')}`)
      )
    } else {
      if (zuletztGemeldet !== null && ergebnis.status === 'ok')
        logger.info('buschtelefon: Abholung läuft wieder.')
      zuletztGemeldet = null
      if (ergebnis.neu > 0 || ergebnis.aktualisiert > 0)
        logger.info(
          `buschtelefon: ${ergebnis.neu} neu, ${ergebnis.aktualisiert} aktualisiert, ${ergebnis.unveraendert} unverändert.`
        )
    }
    return ergebnis
  }
})
