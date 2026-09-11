import { defineEndpoint } from '@directus/extensions-sdk'
import { optionalEnv } from '../../shared/env'
import {
  parseAbfrage,
  pruefeZugang,
  sokratesSendung,
  type SokratesEditionZeile
} from './sokrates'

// The Sokrates door — a protected, non-public API over the day's
// Regionaljournal Sendungen, mounted at `/sokrates/…`.
//
// Why it exists although the blog already has an API: Sokrates (the AI helping
// with the "Frage des Tages") needs the broadcast UNREVIEWED and fast — the
// transcript mail lands around 14:32, the 14:35 Flow ingests and processes it,
// and the question is due shortly after. Unreviewed content never reaches the
// Dorfkoenig API, and that stays so; what Sokrates gets instead is the show
// itself, prepared as Abschnitte plus the whole transcript. Nothing here is a
// Meldung and nothing gets published by serving it.
//
// Endpoints are public by default (mounted before Directus' permission layer),
// so this one carries its own gate: `SOKRATES_API_KEY` in the `X-Sokrates-Key`
// header, compared timing-safe in `pruefeZugang`. Not `Authorization` — that
// header belongs to Directus, whose auth middleware rejects a foreign Bearer
// token before this code ever runs (measured: 401 INVALID_CREDENTIALS from
// Directus itself). Unset means every content route answers 503 — off is a
// configuration, never a silent yes (the same stance as `BLOG_API_OFFEN`).
// The service runs as the system because the caller is a keyed program, not a
// person with an account; the projection in `sokrates.ts` is what bounds what
// it can read.

const FELDER = [
  'id',
  'broadcast_date',
  'edition_label',
  'headline',
  'lead',
  'audio_url',
  'transcript',
  'extra_topics',
  'date_created'
] as const

export default defineEndpoint((router, { services, getSchema, logger }) => {
  const { ItemsService } = services

  // Deliberately unauthenticated and data-free: it answers WHETHER the door is
  // configured, so a failing consumer can tell "no key set" from "wrong key".
  router.get('/gesundheit', (_req, res) => {
    const konfiguriert = optionalEnv('SOKRATES_API_KEY', '') !== ''
    res.json({
      dienst: 'sokrates',
      status: konfiguriert ? 'ok' : 'nicht konfiguriert'
    })
  })

  router.get('/sendungen', async (req, res) => {
    // Read per request: turning the door on or off is an environment change
    // and a restart, never a code change.
    const zugang = pruefeZugang(
      req.headers['x-sokrates-key'],
      optionalEnv('SOKRATES_API_KEY', '')
    )
    if (zugang === 'nicht_konfiguriert') {
      res.status(503).json({
        fehler:
          'Die Sokrates-Schnittstelle ist nicht konfiguriert (SOKRATES_API_KEY fehlt).'
      })
      return
    }
    if (zugang === 'verweigert') {
      res.status(401).json({ fehler: 'Kein gültiger Schlüssel.' })
      return
    }

    const abfrage = parseAbfrage((req.query ?? {}) as Record<string, unknown>)
    if ('fehler' in abfrage) {
      res.status(400).json({ fehler: abfrage.fehler })
      return
    }

    try {
      const editionen = new ItemsService('editions', {
        schema: await getSchema()
      })
      const zeilen = (await editionen.readByQuery({
        filter:
          abfrage.ab === null ? {} : { broadcast_date: { _gte: abfrage.ab } },
        fields: [...FELDER],
        // Newest broadcast first; within a day, the edition that arrived last.
        sort: ['-broadcast_date', '-date_created'],
        limit: abfrage.limit
      })) as unknown as SokratesEditionZeile[]

      res.json({
        stand: new Date().toISOString(),
        sendungen: zeilen.map(sokratesSendung)
      })
    } catch (problem) {
      logger.error(problem, 'sokrates: Sendungen nicht lesbar')
      res.status(500).json({ fehler: 'Interner Fehler.' })
    }
  })
})
