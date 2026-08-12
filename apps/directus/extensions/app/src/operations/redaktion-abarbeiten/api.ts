import { defineOperationApi } from '@directus/extensions-sdk'
import { drain, eroeffneLaeufe, type DrainKontext } from '../../redaktion/drain'

// The production half of the pipeline, on a schedule.
//
// Attach to a Flow with a Schedule trigger, every two to five minutes, and set
// the Flow's "Activity and Logs Tracking" to **Do not track** — a job this
// frequent would otherwise write a few hundred thousand directus_activity rows
// a year for nothing.
//
// This is the safety net, not the main path. When an editor starts a run from
// the UI the endpoint calls the same `drain()` immediately, so the wait is
// seconds. What the schedule adds is recovery: a container killed mid-article
// leaves rows claimed with an expired lease, and the next tick reclaims them.
// `drain()` is single-flight within the process, so a tick landing on top of a
// running pass joins it rather than doubling the work.

export interface Options {
  laeufe: number
  meldungen: number
  briefing_modell?: string | null
}

export default defineOperationApi<Options>({
  id: 'redaktion-abarbeiten',
  handler: async (
    { laeufe, meldungen, briefing_modell },
    { services, database, getSchema, logger }
  ) => {
    const kontext: DrainKontext = {
      database,
      services: services as DrainKontext['services'],
      schema: await getSchema(),
      logger
    }

    const eroeffnet = await eroeffneLaeufe(kontext)
    const ergebnis = await drain(kontext, {
      laeufe: laeufe ?? 1,
      meldungen: meldungen ?? 5,
      ...(briefing_modell ? { briefingModell: briefing_modell } : {})
    })

    return {
      laeufe_eroeffnet: eroeffnet.eroeffnet,
      briefings: ergebnis.laeufe,
      meldungen: ergebnis.meldungen,
      offen: ergebnis.offen,
      fehler: [...eroeffnet.fehler, ...ergebnis.fehler]
    }
  }
})
