import { defineEndpoint } from '@directus/extensions-sdk'
import { optionalEnv } from '../../shared/env'
import {
  baueAntwort,
  FORMAT,
  KOPF,
  LESEFENSTER_TAGE,
  parseAbfrage,
  plusTage,
  pruefeZugang,
  type GemeindeZeile,
  type KalenderZeile,
  type VorschauZeile
} from './tuer'
import { heuteIso } from '../../redaktion/feiertage'

// The events door — a protected, read-only API over the collected Anlässe,
// mounted at `/veranstaltungen/v1/…`, for an outside events site.
//
// It serves UNREVIEWED material: what the calendar run and the weekly-paper
// inventory collected, the moment they collected it, without a Meldung and
// without the counter-check. That is why it is a door of its own and not a
// route of `/api/v1`, which promises that everything it serves is published.
// The rules live in `tuer.ts`; this file only reads and answers.
//
// Endpoints are public by default (mounted before Directus' permission
// layer), so this one carries its own gate — the Sokrates pattern:
// `VERANSTALTUNGEN_API_KEY` in the `X-Veranstaltungen-Key` header, compared
// timing-safe. Not `Authorization`: Directus' auth middleware rejects a
// foreign Bearer token before this code runs. Unset means 503 — off is a
// configuration, never a silent yes. The services run as the system because
// the caller is a keyed program, not a person with an account; the field
// lists below and the projection in `tuer.ts` bound what it can read.

const KALENDER_FELDER = [
  'id',
  'gemeinde',
  'quelle.id',
  'quelle.name',
  'quelle.art',
  'quelle.aktiv',
  'quelle.letzte_pruefung',
  'quelle.letzter_fehler',
  'quelle.letzter_hinweis',
  'titel',
  'termine',
  'von',
  'bis',
  'zeit',
  'lokalitaet',
  'adresse',
  'ort',
  'ort_ausserhalb',
  'veranstalter',
  'rhythmus',
  'anker',
  'anker_am',
  'anker_grund',
  'entscheid',
  'ablehnungsgrund',
  'url',
  'zuletzt_gesehen_am'
]

const VORSCHAU_FELDER = [
  'id',
  'titel',
  'seite',
  'zusammenfassung',
  'zeitbezug',
  'typ',
  'anlass_am',
  'entscheid',
  'ablehnungsgrund',
  'gemeinde',
  'ausgabe.nummer',
  'ausgabe.pdf_url',
  'ausgabe.seite_url',
  'ausgabe.wochenblatt.name',
  'ausgabe.wochenblatt.gemeinde'
]

interface Antwortlich {
  status(code: number): Antwortlich
  json(body: unknown): void
  setHeader(name: string, wert: string): void
}

function fehler(
  res: Antwortlich,
  status: number,
  code: string,
  meldung: string
): void {
  res.status(status).json({ fehler: { code, meldung } })
}

export default defineEndpoint((router, { services, getSchema, logger }) => {
  const { ItemsService } = services

  router.use((_req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive')
    next()
  })

  // Deliberately without a key and without data: it answers WHETHER the door
  // is configured, so a failing consumer can tell "no key set" from "wrong key".
  router.get('/v1/gesundheit', (_req, res) => {
    const konfiguriert = optionalEnv('VERANSTALTUNGEN_API_KEY', '') !== ''
    res.json({
      dienst: 'veranstaltungen',
      format: FORMAT,
      status: konfiguriert ? 'ok' : 'nicht_konfiguriert'
    })
  })

  router.get('/v1/anlaesse', async (req, res) => {
    // Read per request: switching the door is an environment change, never a code change.
    const zugang = pruefeZugang(
      req.headers[KOPF.toLowerCase()],
      optionalEnv('VERANSTALTUNGEN_API_KEY', '')
    )
    if (zugang === 'nicht_konfiguriert') {
      fehler(
        res,
        503,
        'nicht_konfiguriert',
        'Die Veranstaltungs-Schnittstelle ist nicht eingerichtet: VERANSTALTUNGEN_API_KEY fehlt.'
      )
      return
    }
    if (zugang === 'verweigert') {
      fehler(
        res,
        401,
        'nicht_berechtigt',
        `Der Schluessel in ${KOPF} fehlt oder stimmt nicht.`
      )
      return
    }

    const jetzt = new Date()
    let gemeinden: GemeindeZeile[]
    let kalender: KalenderZeile[]
    let vorschauen: VorschauZeile[]
    try {
      const schema = await getSchema()
      const heute = heuteIso(jetzt)
      gemeinden = (await new ItemsService('gemeinden', { schema }).readByQuery({
        filter: { aktiv: { _eq: true } },
        fields: ['id', 'name', 'bfs_nummer'],
        limit: -1
      })) as GemeindeZeile[]
      kalender = (await new ItemsService('veranstaltungen', {
        schema
      }).readByQuery({
        filter: {
          zuletzt_gesehen_am: { _gte: plusTage(heute, -LESEFENSTER_TAGE) }
        },
        fields: KALENDER_FELDER,
        limit: -1
      })) as KalenderZeile[]
      vorschauen = (await new ItemsService('wochenblattkandidaten', {
        schema
      }).readByQuery({
        filter: { zeitbezug: { _eq: 'vorschau' }, anlass_am: { _gte: heute } },
        fields: VORSCHAU_FELDER,
        limit: -1
      })) as VorschauZeile[]
    } catch (problem) {
      logger.error(problem, 'veranstaltungen: Anlaesse nicht lesbar')
      fehler(
        res,
        500,
        'interner_fehler',
        'Die Anlässe konnten nicht gelesen werden.'
      )
      return
    }

    const abfrage = parseAbfrage(
      (req.query ?? {}) as Record<string, unknown>,
      gemeinden
    )
    if ('fehler' in abfrage) {
      fehler(res, 400, 'ungueltige_eingabe', abfrage.fehler)
      return
    }
    res.json(
      baueAntwort({
        jetzt,
        gemeinden,
        kalender,
        vorschauen,
        gemeinde: abfrage.gemeinde
      })
    )
  })

  router.use((_req, res) => {
    fehler(
      res as unknown as Antwortlich,
      404,
      'nicht_gefunden',
      'Diesen Weg gibt es nicht.'
    )
  })
})
