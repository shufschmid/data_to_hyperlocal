import { createError } from '@directus/errors'
import { defineEndpoint } from '@directus/extensions-sdk'
import type { NextFunction, Response } from 'express'
import { completeChatJson, completeJson } from '../../shared/claude'
import { isAuthenticated, type ApiRequest } from '../../shared/http'
import { drain, eroeffneLaeufe, type DrainKontext } from '../../redaktion/drain'
import {
  buildSpielberichtPrompt,
  buildSpielberichtRevision,
  parseSpielbericht,
  SPIELBERICHT_SYSTEM_PROMPT,
  zahlWarnungen,
  zeitWarnungen
} from '../../redaktion/spielbericht'
import {
  buildWissenPrompt,
  parseWissen,
  WISSEN_SCHEMA,
  WISSEN_SYSTEM_PROMPT,
  wissenFelder
} from '../../redaktion/wissen'
import {
  ablaufDatum,
  befundText,
  createToken,
  evaluateToken,
  freigabeLink,
  hashToken
} from '../../redaktion/token'
import {
  buildExtraktionMessages,
  diffTermine,
  EXTRAKTION_SCHEMA,
  EXTRAKTION_SYSTEM_PROMPT,
  merkblattGesamt,
  parseExtraktion,
  wochentagWarnung,
  type ExtrahierterTermin,
  type GespeicherterTermin
} from '../../redaktion/entsorgung'
import {
  baueFakten,
  buildErinnerungPrompt,
  buildErinnerungRevision,
  datengrundlageErinnerung,
  ERINNERUNG_SYSTEM_PROMPT,
  erinnerungKorrekturHinweis,
  parseErinnerung,
  planeErinnerungen,
  zahlWarnungenErinnerung,
  zeitPruefungErinnerung,
  type ErinnerungsFakten,
  type PlanTermin
} from '../../redaktion/erinnerung'
import { heuteIso } from '../../redaktion/feiertage'
import {
  attributionsWarnung,
  brauchtTextTransport,
  buildInventarMessages,
  buildPresseschauPrompt,
  buildPresseschauRevision,
  INVENTAR_SCHEMA,
  INVENTAR_SYSTEM_PROMPT,
  lernDigest,
  mitQuelle,
  parseInventar,
  parsePresseschau,
  PRESSESCHAU_SYSTEM_PROMPT,
  ueberlappungsWarnungen,
  zahlWarnungenPresseschau,
  type FaehrtenUrteil,
  type GemeindeKorrektur,
  type InventarQuelle,
  type LernEintrag,
  type PresseschauFakten
} from '../../redaktion/presseschau'
import {
  extrahiereText,
  fetchAusgabenliste,
  type WochenblattKonnektor
} from '../../shared/wochenblatt'
import quellenPruefen from '../../operations/quellen-pruefen/api'
import sportresultateHolen from '../../operations/sportresultate-holen/api'
import wochenblattPruefen from '../../operations/wochenblatt-pruefen/api'
import { agendaSchluessel } from '../../shared/agenda'
import { ladeTabelle, StatblFehler, tabellenId } from '../../shared/statbl'
import { tabellenFelder } from '../../shared/statbl/parse'
import { baueFreigabeNachricht, LinkNotifier } from '../../shared/notify'
import { optionalEnv } from '../../shared/env'
import type { Datensatz, Lauf, Meldung } from '../../types/schema'

// What the editorial workspace calls.
//
// Every route here is thin on purpose: it validates, writes the state the queue
// reads, and answers. The work itself happens in `redaktion/drain.ts`, kicked
// off without awaiting so the editor gets an answer in milliseconds instead of
// minutes. The scheduled Flow calls the same `drain()` as a safety net, and
// `drain()` is single-flight, so the two cannot double up.
//
// Endpoints are mounted before the permission layer, so every one of them says
// out loud who may call it. That is the most common security hole in a Directus
// extension.

interface SpielZeile {
  id: string
  datum: string
  heim: string
  gast: string
  tore_heim: number | null
  tore_gast: number | null
  wettbewerb: string
  ort: string | null
  gemeinde: { id: string; name: string }
  verein: {
    id: string
    name: string
    liga: string | null
    notiz: string | null
  }
}

const NichtAngemeldet = createError('FORBIDDEN', 'Anmeldung erforderlich.', 401)
const UngueltigeId = createError('INVALID_ID', 'Ungueltige Id.', 400)
const NichtGefunden = createError(
  'FORBIDDEN',
  'Nicht gefunden oder nicht freigegeben.',
  403
)
const LeereAnweisung = createError(
  'EMPTY_INSTRUCTION',
  'Die Anweisung ist leer.',
  400
)
const NichtsZuTun = createError('NOTHING_TO_DO', 'Es gibt nichts zu tun.', 400)
// Provider errors never reach the browser verbatim — they can carry the
// prompt. The detail lands in meldungen.fehler for the admin instead.
const UeberarbeitungFehlgeschlagen = createError(
  'REVISION_FAILED',
  'Die Ueberarbeitung ist fehlgeschlagen. Details stehen an der Meldung im Feld Fehler.',
  502
)
const UngueltigeEntscheidung = createError(
  'INVALID_DECISION',
  'Die Entscheidung muss "ja" oder "nein" sein.',
  400
)

const LeererTitel = createError(
  'EMPTY_TITLE',
  'Der Titel des Eintrags fehlt.',
  400
)
const KeineAgendaQuelle = createError(
  'NO_AGENDA_SOURCE',
  'Die Quelle "Publikationsagenda" fehlt.',
  500
)
const KeineTabelle = createError(
  'INVALID_TABLE_URL',
  'Das ist keine Tabellen-Adresse von statistik.bl.ch, z. B. https://statistik.bl.ch/web_portal/7_1_1_3',
  400
)
const TabelleUnlesbar = createError(
  'TABLE_UNREADABLE',
  'Die Tabelle konnte nicht gelesen werden. Steht auf der Seite eine Tabelle nach Gemeinden?',
  502
)
const KeineTabellenQuelle = createError(
  'NO_TABLE_SOURCE',
  'Die Quelle "Statistik BL — Tabellen" fehlt.',
  500
)

const KeinePdf = createError(
  'NO_PDF',
  'Erfassen Sie den Abfuhrkalender als Link oder als Datei.',
  400
)
const PdfNichtLadbar = createError(
  'PDF_UNREADABLE',
  'Das PDF konnte unter dieser Adresse nicht geladen werden.',
  502
)
const PdfZuGross = createError(
  'PDF_TOO_LARGE',
  'Das PDF ist zu gross. Erfassen Sie es als Link statt als Datei.',
  413
)
const UngueltigesJahr = createError(
  'INVALID_YEAR',
  'Das Kalenderjahr fehlt oder ist unplausibel.',
  400
)
const NochNichtGeprueft = createError(
  'NOT_CONFIRMED',
  'Bestaetigen Sie zuerst die Termine des Kalenders.',
  409
)
const KeinPdfAmKalender = createError(
  'NO_PDF_STORED',
  'Zu diesem Kalender ist kein PDF hinterlegt.',
  400
)
const ExtraktionLaeuftBereits = createError(
  'EXTRACTION_RUNNING',
  'Dieser Kalender wird gerade ausgelesen.',
  409
)
const QuellenLaufLaeuftBereits = createError(
  'SOURCES_RUN_RUNNING',
  'Ein Quellen-Lauf ist bereits unterwegs.',
  409
)
const UngueltigesWochenblatt = createError(
  'INVALID_PAPER',
  'Gemeinde, Name und Archiv-Adresse sind erforderlich.',
  400
)
const ArchivNichtLesbar = createError(
  'ARCHIVE_UNREADABLE',
  'Das Archiv konnte nicht gelesen werden. Bitte die Adresse pruefen.',
  400
)
const WochenblattLaufLaeuftBereits = createError(
  'PAPER_RUN_RUNNING',
  'Ein Wochenblatt-Lauf ist bereits unterwegs.',
  409
)
const InventarLaeuftBereits = createError(
  'INVENTORY_RUNNING',
  'Diese Ausgabe wird gerade inventarisiert.',
  409
)
const KeinPdfAnAusgabe = createError(
  'NO_ISSUE_PDF',
  'Zu dieser Ausgabe ist kein PDF hinterlegt.',
  400
)
const KandidatSchonUebernommen = createError(
  'CANDIDATE_TAKEN',
  'Zu diesem Kandidaten gibt es schon eine Meldung.',
  409
)
const UngueltigerAblehnungsgrund = createError(
  'INVALID_REASON',
  'Unbekannter Ablehnungsgrund.',
  400
)

/** 15 MB is what Directus accepts as a payload; the base64 form is a third bigger. */
const PDF_MAX_BYTES = 10 * 1024 * 1024

const UUID = /^[0-9a-f-]{36}$/i

// One extraction per calendar at a time. The run is detached from the request —
// reading a dense year grid with Opus outlives any proxy timeout — so the brake
// has to live in the process, not in the connection.
const laufendeExtraktionen = new Set<string>()

export default defineEndpoint(
  (router, { services, database, getSchema, logger }) => {
    const { ItemsService } = services

    async function kontext(): Promise<DrainKontext> {
      return {
        database,
        services: services as unknown as DrainKontext['services'],
        schema: await getSchema(),
        logger
      }
    }

    /** Runs a drain pass without making the caller wait for it. */
    function anstossen(ctx: DrainKontext): void {
      // Deliberately not awaited: the response has already gone out. Never touch
      // `res` after this, and always catch — an unhandled rejection here would
      // take the process down.
      void drain(ctx, { meldungen: 5 }).catch((error: unknown) => {
        logger.error(error, 'redaktion: Hintergrundlauf fehlgeschlagen')
      })
    }

    function pruefeId(wert: unknown): string {
      if (typeof wert !== 'string' || !UUID.test(wert)) throw new UngueltigeId()
      return wert
    }

    // --- the "run every scrape now" button -----------------------------------
    //
    // The workspace's Gemeinden tab can start the two scheduled scrapes by hand:
    // the source check (portal, statbl, data.bl.ch catalogue, agenda) and the
    // sport results. Waste calendars are deliberately absent — those are
    // registered one PDF at a time by an editor.
    //
    // The endpoint calls the very same operation handlers the two Flows run,
    // with the same options the committed Flows carry, so a button press and a
    // nightly run are indistinguishable in behaviour. Like the Flows it runs as
    // the system: the results land in collections the editor reads through
    // their own permissions anyway.
    //
    // Detached and single-flight, like the calendar extraction: a full pass
    // takes minutes (the agenda alone backs off for up to a minute), and the
    // status lives in the process because it describes the process.

    interface QuellenLaufStatus {
      laeuft: boolean
      gestartet_um: string | null
      beendet_um: string | null
      quellen: Record<string, unknown> | null
      sport: Record<string, unknown> | null
      fehler: string | null
    }

    const quellenLauf: QuellenLaufStatus = {
      laeuft: false,
      gestartet_um: null,
      beendet_um: null,
      quellen: null,
      sport: null,
      fehler: null
    }

    router.get(
      '/quellen/lauf',
      (req: ApiRequest, res: Response, next: NextFunction) => {
        if (!isAuthenticated(req)) return next(new NichtAngemeldet())
        return res.json({ data: quellenLauf })
      }
    )

    router.post(
      '/quellen/lauf',
      async (req: ApiRequest, res: Response, next: NextFunction) => {
        if (!isAuthenticated(req)) return next(new NichtAngemeldet())
        if (quellenLauf.laeuft) return next(new QuellenLaufLaeuftBereits())

        quellenLauf.laeuft = true
        quellenLauf.gestartet_um = new Date().toISOString()
        quellenLauf.beendet_um = null
        quellenLauf.quellen = null
        quellenLauf.sport = null
        quellenLauf.fehler = null

        // The operation handlers only read these four fields of the Flow
        // context; the cast keeps the SDK's full context type out of here.
        const kontext = { services, getSchema, logger, database } as Parameters<
          typeof quellenPruefen.handler
        >[1]

        const ausfuehren = async (): Promise<void> => {
          // The same options as the committed Flows (see
          // schema/collections/operations.json) — the button is the nightly
          // run, just now.
          quellenLauf.quellen = (await quellenPruefen.handler(
            {
              seiten: 2,
              bewertungen: 10,
              zuordnungen: 10,
              tabellen: 5,
              gemeindepruefungen: 25
            },
            kontext
          )) as Record<string, unknown>

          quellenLauf.sport = (await sportresultateHolen.handler(
            { hoechstens: 200 },
            kontext as Parameters<typeof sportresultateHolen.handler>[1]
          )) as Record<string, unknown>
        }

        void ausfuehren()
          .catch((fehler: unknown) => {
            logger.error(fehler, 'redaktion: Quellen-Lauf fehlgeschlagen')
            quellenLauf.fehler =
              fehler instanceof Error ? fehler.message : String(fehler)
          })
          .finally(() => {
            quellenLauf.laeuft = false
            quellenLauf.beendet_um = new Date().toISOString()
          })

        return res.status(202).json({ data: { gestartet: true } })
      }
    )

    // --- the press review: weekly papers, issues, candidates ------------------
    //
    // Registration and the manual check share one detached runner — the very
    // operation handler the 09:00 Flow runs, so a button press and the
    // scheduled morning are indistinguishable. Meldungen are written only per
    // picked candidate, one Sonnet call each, straight through like the match
    // reports.

    let wochenblattLaufAktiv = false
    const laufendeInventare = new Set<string>()

    function starteWochenblattLauf(): boolean {
      if (wochenblattLaufAktiv) return false
      wochenblattLaufAktiv = true

      const kontext = { services, getSchema, logger, database } as Parameters<
        typeof wochenblattPruefen.handler
      >[1]
      void Promise.resolve(
        wochenblattPruefen.handler({ blaetter: 10 }, kontext)
      )
        .then((ergebnis: unknown) =>
          logger.info(ergebnis, 'redaktion: Wochenblatt-Lauf beendet')
        )
        .catch((fehler: unknown) =>
          logger.error(fehler, 'redaktion: Wochenblatt-Lauf fehlgeschlagen')
        )
        .finally(() => {
          wochenblattLaufAktiv = false
        })
      return true
    }

    router.post(
      '/wochenblaetter',
      async (req: ApiRequest, res: Response, next: NextFunction) => {
        if (!isAuthenticated(req)) return next(new NichtAngemeldet())

        const koerper = (req.body ?? {}) as {
          gemeinde?: unknown
          gemeinden?: unknown
          name?: unknown
          archiv_url?: unknown
        }
        const name = typeof koerper.name === 'string' ? koerper.name.trim() : ''
        const archivUrl =
          typeof koerper.archiv_url === 'string'
            ? koerper.archiv_url.trim()
            : ''
        // One paper can cover several municipalities (the Muttenzer & Prattler
        // Anzeiger has two). The first named is the main one.
        const gemeindeIds: string[] = Array.isArray(koerper.gemeinden)
          ? koerper.gemeinden.filter(
              (g): g is string => typeof g === 'string' && UUID.test(g)
            )
          : typeof koerper.gemeinde === 'string' && UUID.test(koerper.gemeinde)
            ? [koerper.gemeinde]
            : []
        if (
          gemeindeIds.length === 0 ||
          name === '' ||
          !/^https?:\/\//.test(archivUrl)
        ) {
          return next(new UngueltigesWochenblatt())
        }

        // The platform decides the parser: lokalzeitungen.ch pages carry one
        // "/ausgabe/…-DD-MM-YYYY/" link, wochenblatt.ch lists issuu readers
        // (the PDF comes through issuu's publisher-enabled download API),
        // bibo.ch runs on Localpoint's CMS (issue list embedded as JSON, the
        // PDF on files.localpoint.ch), everything else is read as a WordPress
        // archive list. A fifth platform gets its own value here.
        const host = new URL(archivUrl).host
        const konnektor: WochenblattKonnektor =
          /(^|\.)lokalzeitungen\.ch$/i.test(host)
            ? 'lokalzeitungen'
            : /(^|\.)wochenblatt\.ch$/i.test(host)
              ? 'issuu'
              : /(^|\.)bibo\.ch$/i.test(host)
                ? 'localpoint'
                : 'wordpress-archiv'

        // Read the archive BEFORE writing anything: a mistyped address should
        // fail the form, not become a row that errors every morning at nine.
        try {
          await fetchAusgabenliste(konnektor, archivUrl, {
            kontakt: optionalEnv('AGENDA_KONTAKT', 'it@bajour.ch')
          })
        } catch (fehler) {
          logger.warn(
            fehler,
            'redaktion: Wochenblatt-Archiv beim Registrieren nicht lesbar'
          )
          return next(new ArchivNichtLesbar())
        }

        try {
          const schema = await getSchema()
          const blaetter = new ItemsService('wochenblaetter', {
            schema,
            accountability: req.accountability
          })
          const abdeckungen = new ItemsService('wochenblattgemeinden', {
            schema,
            accountability: req.accountability
          })
          const id = (await blaetter.createOne({
            gemeinde: gemeindeIds[0],
            name,
            archiv_url: archivUrl,
            konnektor,
            aktiv: true
          })) as string
          for (const gemeindeId of gemeindeIds) {
            await abdeckungen.createOne({
              wochenblatt: id,
              gemeinde: gemeindeId
            })
          }

          // The newest issue is processed right away — that was the deal:
          // current one in, backlog ignored forever.
          starteWochenblattLauf()

          return res.status(202).json({ data: { wochenblatt: id } })
        } catch (error) {
          return next(uebersetze(error))
        }
      }
    )

    router.post(
      '/wochenblaetter/pruefen',
      (req: ApiRequest, res: Response, next: NextFunction) => {
        if (!isAuthenticated(req)) return next(new NichtAngemeldet())
        if (!starteWochenblattLauf()) {
          return next(new WochenblattLaufLaeuftBereits())
        }
        return res.status(202).json({ data: { gestartet: true } })
      }
    )

    router.post(
      '/ausgaben/:id/inventar',
      async (req: ApiRequest, res: Response, next: NextFunction) => {
        if (!isAuthenticated(req)) return next(new NichtAngemeldet())

        let id: string
        try {
          id = pruefeId(req.params['id'])
        } catch (error) {
          return next(uebersetze(error))
        }

        const schema = await getSchema()
        const ausgaben = new ItemsService('wochenblattausgaben', {
          schema,
          accountability: req.accountability
        })

        let ausgabe: {
          id: string
          nummer: string | null
          schluessel: string
          datum: string | null
          seiten: number | null
          pdf: string | null
          wochenblatt: {
            id: string
            name: string
            gemeinde: { id: string; name: string }
            abdeckungen: Array<{ gemeinde: { id: string; name: string } }>
          }
        }
        try {
          ausgabe = (await ausgaben.readOne(id, {
            fields: [
              'id',
              'nummer',
              'schluessel',
              'datum',
              'seiten',
              'pdf',
              'wochenblatt.id',
              'wochenblatt.name',
              'wochenblatt.gemeinde.id',
              'wochenblatt.gemeinde.name',
              'wochenblatt.abdeckungen.gemeinde.id',
              'wochenblatt.abdeckungen.gemeinde.name'
            ]
          })) as typeof ausgabe
        } catch (error) {
          return next(uebersetze(error))
        }
        if (ausgabe.pdf === null) return next(new KeinPdfAnAusgabe())
        if (laufendeInventare.has(id)) return next(new InventarLaeuftBereits())
        laufendeInventare.add(id)

        try {
          await ausgaben.updateOne(id, { status: 'liest', fehler: null })
        } catch (error) {
          laufendeInventare.delete(id)
          return next(uebersetze(error))
        }

        // Detached like the calendar extraction: an Opus read of a whole
        // issue takes minutes, and the caller polls the status instead.
        const inventarisieren = async (): Promise<void> => {
          const system = new ItemsService('wochenblattausgaben', { schema })
          const kandidatenService = new ItemsService('wochenblattkandidaten', {
            schema
          })
          const meldungenService = new ItemsService('meldungen', { schema })

          try {
            const pdfDaten = await lesePdf(schema, ausgabe.pdf as string)
            const digest = lernDigest(
              ...(await ladeLernEintraege(schema, ausgabe.wochenblatt.id))
            )

            // Covered municipalities, main one first — names and ids in step.
            const abdeckung = [ausgabe.wochenblatt.gemeinde]
            for (const eintrag of ausgabe.wochenblatt.abdeckungen ?? []) {
              if (eintrag.gemeinde.id !== ausgabe.wochenblatt.gemeinde.id) {
                abdeckung.push(eintrag.gemeinde)
              }
            }
            const gemeindeIds = new Map(abdeckung.map((g) => [g.name, g.id]))

            // Same transport rule as the 09:00 run: a file past the API's
            // request limit travels as its text layer, page by page.
            const quelle: InventarQuelle = brauchtTextTransport(pdfDaten.length)
              ? {
                  art: 'seitentexte',
                  seitenTexte: (await extrahiereText(pdfDaten)).seitenTexte
                }
              : { art: 'pdf', base64: pdfDaten.toString('base64') }

            const antwort = await completeChatJson<unknown>({
              system: INVENTAR_SYSTEM_PROMPT,
              messages: buildInventarMessages(
                quelle,
                {
                  name: ausgabe.wochenblatt.name,
                  gemeinden: abdeckung.map((g) => g.name),
                  nummer: ausgabe.nummer,
                  datum: ausgabe.datum
                },
                digest
              ),
              model: 'claude-opus-5',
              // Same budget as the operation — see the comment there.
              maxTokens: 32000,
              schema: INVENTAR_SCHEMA
            })
            const inventar = parseInventar(
              antwort,
              ausgabe.seiten,
              abdeckung.map((g) => g.name)
            )

            // Diff instead of replace: a candidate the editor already decided
            // on, or one that became a Meldung, is not up for debate again.
            const bestehende = (await kandidatenService.readByQuery({
              filter: { ausgabe: { _eq: id } },
              fields: ['id', 'titel', 'seite', 'entscheid'],
              limit: -1
            })) as Array<{
              id: string
              titel: string
              seite: number | null
              entscheid: string
            }>
            const verknuepfte = (await meldungenService.readByQuery({
              filter: { kandidat: { _in: bestehende.map((k) => k.id) } },
              fields: ['kandidat'],
              limit: -1
            })) as Array<{ kandidat: string }>
            const mitMeldung = new Set(verknuepfte.map((m) => m.kandidat))

            const schluessel = (titel: string, seite: number | null): string =>
              `${titel.toLowerCase()}|${seite ?? ''}`
            const neuNachSchluessel = new Map(
              inventar.kandidaten.map((k) => [schluessel(k.titel, k.seite), k])
            )

            for (const alt of bestehende) {
              const neu = neuNachSchluessel.get(
                schluessel(alt.titel, alt.seite)
              )
              if (neu !== undefined) {
                neuNachSchluessel.delete(schluessel(alt.titel, alt.seite))
                await kandidatenService.updateOne(alt.id, {
                  typ: neu.typ,
                  frontseite: neu.frontseite,
                  warum_exklusiv: neu.warum_exklusiv,
                  zusammenfassung: neu.zusammenfassung,
                  perle_vorschlag: neu.perle_vorschlag,
                  perle_begruendung: neu.perle_begruendung
                })
              } else if (alt.entscheid === 'offen' && !mitMeldung.has(alt.id)) {
                await kandidatenService.deleteOne(alt.id)
              }
            }
            for (const neu of neuNachSchluessel.values()) {
              await kandidatenService.createOne({
                ausgabe: id,
                titel: neu.titel,
                seite: neu.seite,
                typ: neu.typ,
                gemeinde:
                  gemeindeIds.get(neu.gemeinde) ??
                  ausgabe.wochenblatt.gemeinde.id,
                frontseite: neu.frontseite,
                warum_exklusiv: neu.warum_exklusiv,
                zusammenfassung: neu.zusammenfassung,
                perle_vorschlag: neu.perle_vorschlag,
                perle_begruendung: neu.perle_begruendung,
                entscheid: 'offen'
              })
            }

            // Research leads: only genuinely new ones are added — a verdict
            // the newsroom already gave is never asked for twice.
            const hinweiseService = new ItemsService('recherchehinweise', {
              schema
            })
            const bestehendeFaehrten = (await hinweiseService.readByQuery({
              filter: { ausgabe: { _eq: id } },
              fields: ['titel'],
              limit: -1
            })) as Array<{ titel: string }>
            const bekannteFaehrten = new Set(
              bestehendeFaehrten.map((f) => f.titel.toLowerCase())
            )
            for (const faehrte of inventar.recherchehinweise) {
              if (bekannteFaehrten.has(faehrte.titel.toLowerCase())) continue
              await hinweiseService.createOne({
                ausgabe: id,
                gemeinde:
                  faehrte.gemeinde === null
                    ? null
                    : (gemeindeIds.get(faehrte.gemeinde) ?? null),
                titel: faehrte.titel,
                fundort: faehrte.fundort,
                begruendung: faehrte.begruendung,
                status: 'offen'
              })
            }

            await system.updateOne(id, {
              status: 'inventarisiert',
              inventar: inventar as unknown as Record<string, unknown>,
              fehler: null
            })
          } catch (fehler) {
            logger.error(fehler, 'redaktion: Ausgaben-Inventar fehlgeschlagen')
            try {
              await system.updateOne(id, {
                status: 'fehler',
                fehler: fehlerText(fehler)
              })
            } catch (schreibfehler) {
              logger.warn(
                schreibfehler,
                'redaktion: Inventar-Fehler nicht notiert'
              )
            }
          }
        }

        void inventarisieren().finally(() => {
          laufendeInventare.delete(id)
        })

        return res.status(202).json({ data: { gestartet: true } })
      }
    )

    router.post(
      '/kandidaten/:id/meldung',
      async (req: ApiRequest, res: Response, next: NextFunction) => {
        if (!isAuthenticated(req)) return next(new NichtAngemeldet())

        try {
          const id = pruefeId(req.params['id'])
          const schema = await getSchema()
          const kandidatenService = new ItemsService('wochenblattkandidaten', {
            schema,
            accountability: req.accountability
          })
          const meldungenService = new ItemsService('meldungen', {
            schema,
            accountability: req.accountability
          })

          const geladen = await ladePresseschauFakten(schema, id)

          const vorhandene = (await meldungenService.readByQuery({
            filter: {
              kandidat: { _eq: id },
              status: { _neq: 'verworfen' }
            },
            fields: ['id'],
            limit: 1
          })) as { id: string }[]
          if (vorhandene.length > 0) return next(new KandidatSchonUebernommen())

          const { bericht, warnungen } = await schreibePresseschau(
            geladen.fakten,
            geladen.volltext
          )

          const meldungId = (await meldungenService.createOne({
            kandidat: id,
            gemeinde: geladen.gemeindeId,
            titel: bericht.titel,
            lead: bericht.lead,
            text: mitQuelle(bericht.text, geladen.fakten),
            status: 'entwurf',
            verarbeitung: 'idle',
            zeit_warnungen: warnungen.length > 0 ? warnungen : null,
            datengrundlage: {
              quelle: 'wochenblatt',
              blatt: geladen.fakten.blatt,
              nummer: geladen.fakten.nummer,
              datum: geladen.fakten.datum,
              seite: geladen.fakten.seite,
              beitrag: geladen.fakten.titel,
              pdf_url: geladen.fakten.pdfUrl
            }
          })) as string

          await kandidatenService.updateOne(id, { entscheid: 'uebernommen' })

          return res.json({ data: { meldung: meldungId, warnungen } })
        } catch (error) {
          const status = (error as { status?: unknown }).status
          if (
            status === 403 ||
            status === 404 ||
            status === 400 ||
            status === 409
          ) {
            return next(uebersetze(error))
          }
          logger.error(error, 'redaktion: Presseschau-Meldung fehlgeschlagen')
          return next(new UeberarbeitungFehlgeschlagen())
        }
      }
    )

    router.post(
      '/kandidaten/:id/ablehnen',
      async (req: ApiRequest, res: Response, next: NextFunction) => {
        if (!isAuthenticated(req)) return next(new NichtAngemeldet())

        const GRUENDE = [
          'nicht_relevant',
          'doublette',
          'veraltet',
          'falsche_gemeinde',
          'andere'
        ]
        const koerper = (req.body ?? {}) as {
          grund?: unknown
          kommentar?: unknown
        }
        if (
          typeof koerper.grund !== 'string' ||
          !GRUENDE.includes(koerper.grund)
        ) {
          return next(new UngueltigerAblehnungsgrund())
        }
        const kommentar =
          typeof koerper.kommentar === 'string' &&
          koerper.kommentar.trim() !== ''
            ? koerper.kommentar.trim()
            : null

        try {
          const id = pruefeId(req.params['id'])
          const kandidatenService = new ItemsService('wochenblattkandidaten', {
            schema: await getSchema(),
            accountability: req.accountability
          })

          // This is the learning signal: reason and comment ride into the
          // next inventory's digest as a negative example.
          await kandidatenService.updateOne(id, {
            entscheid: 'abgelehnt',
            ablehnungsgrund: koerper.grund,
            ablehnungskommentar: kommentar
          })

          return res.json({ data: { kandidat: id, entscheid: 'abgelehnt' } })
        } catch (error) {
          return next(uebersetze(error))
        }
      }
    )

    router.post(
      '/kandidaten/:id/gemeinde',
      async (req: ApiRequest, res: Response, next: NextFunction) => {
        if (!isAuthenticated(req)) return next(new NichtAngemeldet())

        const koerper = (req.body ?? {}) as { gemeinde?: unknown }
        if (
          typeof koerper.gemeinde !== 'string' ||
          !UUID.test(koerper.gemeinde)
        ) {
          return next(new UngueltigeId())
        }

        try {
          const id = pruefeId(req.params['id'])
          const kandidatenService = new ItemsService('wochenblattkandidaten', {
            schema: await getSchema(),
            accountability: req.accountability
          })

          // The reassignment itself; the `kandidat-gemeinde` hook stamps
          // `gemeinde_korrigiert` — the signal the next inventory learns from.
          await kandidatenService.updateOne(id, { gemeinde: koerper.gemeinde })

          return res.json({ data: { kandidat: id } })
        } catch (error) {
          return next(uebersetze(error))
        }
      }
    )

    router.post(
      '/hinweise/:id/bewerten',
      async (req: ApiRequest, res: Response, next: NextFunction) => {
        if (!isAuthenticated(req)) return next(new NichtAngemeldet())

        const koerper = (req.body ?? {}) as {
          brauchbar?: unknown
          kommentar?: unknown
        }
        if (typeof koerper.brauchbar !== 'boolean') {
          return next(new UngueltigerAblehnungsgrund())
        }
        const kommentar =
          typeof koerper.kommentar === 'string' &&
          koerper.kommentar.trim() !== ''
            ? koerper.kommentar.trim()
            : null

        try {
          const id = pruefeId(req.params['id'])
          const hinweise = new ItemsService('recherchehinweise', {
            schema: await getSchema(),
            accountability: req.accountability
          })

          // The other half of the lead loop: "war das ein Recherchehinweis
          // oder nicht?" — the verdict teaches the next inventory.
          await hinweise.updateOne(id, {
            status: koerper.brauchbar ? 'brauchbar' : 'kein_hinweis',
            kommentar
          })

          return res.json({
            data: {
              hinweis: id,
              status: koerper.brauchbar ? 'brauchbar' : 'kein_hinweis'
            }
          })
        } catch (error) {
          return next(uebersetze(error))
        }
      }
    )

    // --- an agenda entry, typed in by hand -----------------------------------
    //
    // The fallback for a source we cannot read: the agenda host sits behind a
    // bot check, and when it turns us away for good, a person opens the page
    // and enters what is there.
    //
    // Not a GraphQL mutation, for a reason that is not style: `create_
    // ankuendigungen_item` types the `quelle` relation as `create_quellen_input`
    // and therefore wants a whole new source, not a reference to the existing
    // one. Here the source is looked up instead, so the browser never has to
    // know its id.

    router.post(
      '/ankuendigungen',
      async (req: ApiRequest, res: Response, next: NextFunction) => {
        if (!isAuthenticated(req)) return next(new NichtAngemeldet())

        const koerper = (req.body ?? {}) as {
          titel?: unknown
          datum?: unknown
          quartal?: unknown
          link?: unknown
        }

        const titel =
          typeof koerper.titel === 'string' ? koerper.titel.trim() : ''
        if (titel === '') return next(new LeererTitel())

        const datum =
          typeof koerper.datum === 'string' &&
          /^\d{4}-\d{2}-\d{2}$/.test(koerper.datum)
            ? koerper.datum
            : null

        try {
          const schema = await getSchema()
          const ankuendigungen = new ItemsService('ankuendigungen', {
            schema,
            accountability: req.accountability
          })
          const quellen = new ItemsService('quellen', { schema })

          const agenda = (
            (await quellen.readByQuery({
              filter: { typ: { _eq: 'agenda' } },
              fields: ['id'],
              limit: 1
            })) as { id: string }[]
          )[0]

          if (agenda === undefined) return next(new KeineAgendaQuelle())

          // A date means the statistic is out; without one it is announced for
          // a quarter. `schluessel` is deliberately not written here — the
          // `ankuendigung-schluessel` hook derives it from the title on every
          // write, so this row and a later fetched one are the same row.
          const felder = {
            titel,
            status: datum === null ? 'geplant' : 'publiziert',
            datum,
            quartal:
              typeof koerper.quartal === 'string' &&
              koerper.quartal.trim() !== ''
                ? koerper.quartal.trim()
                : null,
            link:
              typeof koerper.link === 'string' && koerper.link.trim() !== ''
                ? koerper.link.trim()
                : null
          }

          // Most of the time the statistic is already on the list as announced,
          // and what the editor is saying is "this one is out now, here is the
          // date". A second row for that is exactly what the unique key on
          // (quelle, schluessel) exists to prevent — so this updates instead of
          // failing with a database error nobody can act on, the same move the
          // daily fetch makes when an entry goes from announced to published.
          const schluessel = agendaSchluessel({
            datum: null,
            quartal: null,
            titel,
            link: null,
            status: 'geplant'
          })

          const bestehend = (
            (await ankuendigungen.readByQuery({
              filter: {
                quelle: { _eq: agenda.id },
                schluessel: { _eq: schluessel }
              },
              fields: ['id'],
              limit: 1
            })) as { id: string }[]
          )[0]

          if (bestehend !== undefined) {
            await ankuendigungen.updateOne(bestehend.id, {
              ...felder,
              ...(datum === null
                ? {}
                : { publiziert_seit: new Date().toISOString() })
            })

            return res
              .status(200)
              .json({ data: { id: bestehend.id, titel, aktualisiert: true } })
          }

          const id = await ankuendigungen.createOne({
            quelle: agenda.id,
            ...felder,
            erstmals_gesehen: new Date().toISOString(),
            publiziert_seit: datum === null ? null : new Date().toISOString()
          })

          return res
            .status(201)
            .json({ data: { id, titel, aktualisiert: false } })
        } catch (error) {
          return next(uebersetze(error))
        }
      }
    )

    // --- register a portal table ---------------------------------------------
    //
    // The editor pastes the URL of a table on statistik.bl.ch and it becomes an
    // ordinary dataset. This exists because the open-data portal does not carry
    // everything the office publishes — agriculture has no dataset there at all
    // — and because only a person can say which table answers an announcement.

    router.post(
      '/tabellen',
      async (req: ApiRequest, res: Response, next: NextFunction) => {
        if (!isAuthenticated(req)) return next(new NichtAngemeldet())

        const eingabe = (req.body as { url?: unknown } | undefined)?.url
        const id = typeof eingabe === 'string' ? tabellenId(eingabe) : null

        if (id === null) {
          return next(new KeineTabelle())
        }

        try {
          const schema = await getSchema()
          const datensaetze = new ItemsService('datensaetze', {
            schema,
            accountability: req.accountability
          })
          const quellen = new ItemsService('quellen', { schema })

          // Fetched before anything is written: a URL that turns out not to be
          // a municipality table must fail here, with a message an editor can
          // act on, and not later inside a run.
          const tabelle = await ladeTabelle(id)

          const quelle = (
            (await quellen.readByQuery({
              filter: { typ: { _eq: 'statbl' } },
              fields: ['id'],
              limit: 1
            })) as { id: string }[]
          )[0]

          if (quelle === undefined) return next(new KeineTabellenQuelle())

          const vorhanden = (await datensaetze.readByQuery({
            filter: {
              quelle: { _eq: quelle.id },
              externe_id: { _eq: id }
            },
            fields: ['id'],
            limit: 1
          })) as { id: string }[]

          const vorgabe = leseVorgabe(req)
          const felder = tabellenFelder(tabelle)

          const gemeinsam = {
            titel: tabelle.titel,
            beschreibung: `Tabelle ${id} auf statistik.bl.ch, Jahrgaenge ${tabelle.jahre.join(', ')}`,
            felder,
            hat_gemeinde: true,
            // The table has no BFS numbers, only names — so the column is named
            // here rather than guessed later.
            gemeindefeld: 'gemeinde',
            letzter_stand: tabelle.jahr,
            // Der Stand, den das Amt selbst nennt — nicht unsere Lesezeit.
            // Mit letzterer stand eine Tabelle vom November 2025 zuoberst in
            // der Zeitleiste, als waere sie heute erschienen.
            daten_stand: tabelle.stand,
            zeilen: tabelle.zeilen.length,
            status: 'relevant',
            ...(vorgabe === null ? {} : { standard_vorgabe: vorgabe })
          }

          const datensatzId =
            vorhanden[0] === undefined
              ? ((await datensaetze.createOne({
                  quelle: quelle.id,
                  externe_id: id,
                  bewertung: 'Von Hand als Tabelle erfasst.',
                  ...gemeinsam
                })) as string)
              : ((await datensaetze.updateOne(
                  vorhanden[0].id,
                  gemeinsam
                )) as string)

          return res.status(200).json({
            data: {
              datensatz: datensatzId,
              titel: tabelle.titel,
              jahr: tabelle.jahr,
              jahre: tabelle.jahre,
              gemeinden: tabelle.zeilen.length,
              spalten: tabelle.spalten
            }
          })
        } catch (error) {
          if (error instanceof StatblFehler) {
            logger.warn(`redaktion: Tabelle ${id} — ${error.message}`)
            return next(new TabelleUnlesbar())
          }
          return next(uebersetze(error))
        }
      }
    )

    router.post(
      '/datensaetze/:id/lauf',
      async (req: ApiRequest, res: Response, next: NextFunction) => {
        if (!isAuthenticated(req)) return next(new NichtAngemeldet())

        try {
          const id = pruefeId(req.params['id'])
          const schema = await getSchema()
          const datensaetze = new ItemsService('datensaetze', {
            schema,
            accountability: req.accountability
          })

          // Optional, and only sent by the manual path in the workspace: the
          // instruction for this run, and the municipality column when the
          // portal's metadata did not give us one.
          const vorgabe = leseVorgabe(req)
          const gemeindefeld = leseGemeindefeld(req)

          // Marking it relevant is what makes it eligible; `eroeffneLaeufe` picks
          // it up from there, so the two paths cannot disagree about the period.
          await datensaetze.updateOne(id, {
            status: 'relevant',
            ...(gemeindefeld === null ? {} : { gemeindefeld })
          })

          const ctx = await kontext()
          const eroeffnet = await eroeffneLaeufe(ctx, 1, id, vorgabe)
          anstossen(ctx)

          return res.status(202).json({
            data: {
              eroeffnet: eroeffnet.eroeffnet,
              hinweise: eroeffnet.fehler
            }
          })
        } catch (error) {
          return next(uebersetze(error))
        }
      }
    )

    // --- start a run ----------------------------------------------------------

    // --- chat: revise a whole run --------------------------------------------

    router.post(
      '/laeufe/:id/chat',
      async (req: ApiRequest, res: Response, next: NextFunction) => {
        if (!isAuthenticated(req)) return next(new NichtAngemeldet())

        try {
          const id = pruefeId(req.params['id'])
          const anweisung = leseAnweisung(req)
          const schema = await getSchema()

          const laeufe = new ItemsService('laeufe', {
            schema,
            accountability: req.accountability
          })
          const meldungen = new ItemsService('meldungen', { schema })
          const chat = new ItemsService('chat_nachrichten', { schema })

          const lauf = (await laeufe.readOne(id, {
            fields: ['id', 'datensatz']
          })) as Pick<Lauf, 'id' | 'datensatz'>

          const betroffen = (await meldungen.readByQuery({
            filter: {
              lauf: { _eq: id },
              status: { _in: ['entwurf', 'in_pruefung', 'freigegeben'] }
            },
            fields: ['id'],
            limit: -1
          })) as Pick<Meldung, 'id'>[]

          if (betroffen.length === 0) throw new NichtsZuTun()

          const position = await naechstePosition(chat, { lauf: { _eq: id } })
          await chat.createOne({
            lauf: id,
            rolle: 'user',
            inhalt: anweisung,
            position
          })

          // The instruction rides on the message itself, so the queue applies it
          // exactly once per article and it survives a restart.
          for (const meldung of betroffen) {
            await meldungen.updateOne(meldung.id, {
              anweisung,
              verarbeitung: 'geplant',
              versuche: 0
            })
          }

          await chat.createOne({
            lauf: id,
            rolle: 'assistant',
            inhalt: `Wird auf ${betroffen.length} Meldungen angewendet.`,
            position: position + 1
          })

          const ctx = await kontext()
          void merkeWissen(anweisung, lauf.datensatz)
          anstossen(ctx)

          return res.status(202).json({ data: { meldungen: betroffen.length } })
        } catch (error) {
          return next(uebersetze(error))
        }
      }
    )

    // --- chat: revise one article --------------------------------------------

    router.post(
      '/meldungen/:id/chat',
      async (req: ApiRequest, res: Response, next: NextFunction) => {
        if (!isAuthenticated(req)) return next(new NichtAngemeldet())

        try {
          const id = pruefeId(req.params['id'])
          const anweisung = leseAnweisung(req)
          const schema = await getSchema()

          const meldungen = new ItemsService('meldungen', {
            schema,
            accountability: req.accountability
          })
          const chat = new ItemsService('chat_nachrichten', { schema })

          const meldung = (await meldungen.readOne(id, {
            fields: [
              'id',
              'spiel',
              'erscheint_am',
              'kandidat',
              'titel',
              'lead',
              'text'
            ]
          })) as {
            id: string
            spiel: string | null
            erscheint_am: string | null
            kandidat: string | null
            titel: string | null
            lead: string | null
            text: string | null
          }

          const position = await naechstePosition(chat, {
            meldung: { _eq: id }
          })
          await chat.createOne({
            meldung: id,
            rolle: 'user',
            inhalt: anweisung,
            position
          })

          // A match report is revised right here, not queued: the queue is the
          // statistics drain, and it loads per-run material a match report does
          // not have (`lauf` is null — `ladeLaufMaterial(null)` would throw).
          // One model call over facts already held; nothing to schedule.
          if (meldung.spiel !== null) {
            await meldungen.updateOne(id, { verarbeitung: 'laeuft', anweisung })
            try {
              const warnungen = await ueberarbeiteSpielbericht(
                meldung,
                meldung.spiel,
                anweisung
              )
              await chat.createOne({
                meldung: id,
                rolle: 'assistant',
                inhalt:
                  warnungen.length === 0
                    ? 'Neu formuliert.'
                    : `Neu formuliert — mit Hinweisen: ${warnungen.join(' · ')}`,
                position: position + 1
              })
              merkeWissenSport(anweisung, id)
              return res.json({ data: { meldung: id, warnungen } })
            } catch (fehler) {
              await meldungen.updateOne(id, {
                verarbeitung: 'idle',
                fehler: fehlerText(fehler)
              })
              logger.error(
                fehler,
                'redaktion: Spielbericht-Ueberarbeitung fehlgeschlagen'
              )
              throw new UeberarbeitungFehlgeschlagen()
            }
          }

          // A press review is revised here too — it has no run, so the
          // statistics queue cannot carry it. The source line is re-appended
          // by code after every revision; the model never owns it.
          if (meldung.kandidat !== null) {
            await meldungen.updateOne(id, { verarbeitung: 'laeuft', anweisung })
            try {
              const warnungen = await ueberarbeitePresseschau(
                meldung,
                meldung.kandidat,
                anweisung
              )
              await chat.createOne({
                meldung: id,
                rolle: 'assistant',
                inhalt:
                  warnungen.length === 0
                    ? 'Neu formuliert.'
                    : `Neu formuliert — mit Hinweisen: ${warnungen.join(' · ')}`,
                position: position + 1
              })
              return res.json({ data: { meldung: id, warnungen } })
            } catch (fehler) {
              await meldungen.updateOne(id, {
                verarbeitung: 'idle',
                fehler: fehlerText(fehler)
              })
              logger.error(
                fehler,
                'redaktion: Presseschau-Ueberarbeitung fehlgeschlagen'
              )
              throw new UeberarbeitungFehlgeschlagen()
            }
          }

          // A reminder is revised here too, and for the same reason: it has no
          // run either, so the statistics queue cannot carry it.
          if (meldung.erscheint_am !== null) {
            await meldungen.updateOne(id, { verarbeitung: 'laeuft', anweisung })
            try {
              const warnungen = await ueberarbeiteErinnerung(meldung, anweisung)
              await chat.createOne({
                meldung: id,
                rolle: 'assistant',
                inhalt:
                  warnungen.length === 0
                    ? 'Neu formuliert.'
                    : `Neu formuliert — mit Hinweisen: ${warnungen.join(' · ')}`,
                position: position + 1
              })
              return res.json({ data: { meldung: id, warnungen } })
            } catch (fehler) {
              await meldungen.updateOne(id, {
                verarbeitung: 'idle',
                fehler: fehlerText(fehler)
              })
              logger.error(
                fehler,
                'redaktion: Erinnerungs-Ueberarbeitung fehlgeschlagen'
              )
              throw new UeberarbeitungFehlgeschlagen()
            }
          }

          await meldungen.updateOne(id, {
            anweisung,
            verarbeitung: 'geplant',
            versuche: 0
          })

          await chat.createOne({
            meldung: id,
            rolle: 'assistant',
            inhalt: 'Wird auf diese Meldung angewendet.',
            position: position + 1
          })

          anstossen(await kontext())

          return res.status(202).json({ data: { meldung: id } })
        } catch (error) {
          return next(uebersetze(error))
        }
      }
    )

    // --- status changes -------------------------------------------------------
    //
    // These only ever write `status`. The transition itself is judged by the
    // `meldung-status` hook, which sees every write path — so a rejection here
    // reads the same as a rejection from the admin UI.

    router.post(
      '/meldungen/:id/:aktion(publizieren|pruefung|verwerfen|freigeben)',
      async (req: ApiRequest, res: Response, next: NextFunction) => {
        if (!isAuthenticated(req)) return next(new NichtAngemeldet())

        try {
          const id = pruefeId(req.params['id'])
          const ziel = zielStatus(req.params['aktion'])
          const meldungen = new ItemsService('meldungen', {
            schema: await getSchema(),
            accountability: req.accountability
          })

          // Sending an article out is the moment a link has to exist. Minted
          // before the status change, so a message can never sit in
          // `in_pruefung` with no way for anyone to answer.
          const zustellung =
            ziel === 'in_pruefung' ? await mintFreigabe(meldungen, id) : null

          // Publishing a press review is also the Perle decision: "als Perle
          // publizieren" or plain publishing. Explicitly false when unsaid —
          // an unpublished or silently published piece is never a Perle.
          let perleFelder: Record<string, unknown> = {}
          if (ziel === 'publiziert') {
            const zeile = (await meldungen.readOne(id, {
              fields: ['kandidat']
            })) as { kandidat: string | null }
            if (zeile.kandidat !== null) {
              const koerper = (req.body ?? {}) as { perle?: unknown }
              perleFelder = { perle: koerper.perle === true }
            }
          }

          await meldungen.updateOne(id, { status: ziel, ...perleFelder })

          return res.json({
            data: {
              id,
              status: ziel,
              ...(zustellung === null ? {} : { zustellung })
            }
          })
        } catch (error) {
          return next(uebersetze(error))
        }
      }
    )

    router.post(
      '/laeufe/:id/:aktion(publizieren|pruefung|verwerfen)',
      async (req: ApiRequest, res: Response, next: NextFunction) => {
        if (!isAuthenticated(req)) return next(new NichtAngemeldet())

        try {
          const id = pruefeId(req.params['id'])
          const ziel = zielStatus(req.params['aktion'])
          const schema = await getSchema()
          const meldungen = new ItemsService('meldungen', {
            schema,
            accountability: req.accountability
          })

          const betroffen = (await meldungen.readByQuery({
            filter: { lauf: { _eq: id } },
            fields: ['id', 'status'],
            limit: -1
          })) as Pick<Meldung, 'id' | 'status'>[]

          // One article that cannot make the transition must not sink the rest —
          // a run where two of twenty are still missing text should still publish
          // the eighteen. What could not be done is reported, not swallowed.
          const erledigt: string[] = []
          const abgelehnt: { id: string; grund: string }[] = []

          for (const meldung of betroffen) {
            if (meldung.status === ziel) continue
            try {
              await meldungen.updateOne(meldung.id, { status: ziel })
              erledigt.push(meldung.id)
            } catch (error) {
              abgelehnt.push({
                id: meldung.id,
                grund: error instanceof Error ? error.message : String(error)
              })
            }
          }

          return res.json({ data: { erledigt: erledigt.length, abgelehnt } })
        } catch (error) {
          return next(uebersetze(error))
        }
      }
    )

    // --- the approval link ----------------------------------------------------
    //
    // Two routes, and the split between them is the security design:
    //
    //   GET  /freigabe/:token   reads. Safe for a link scanner to fetch, because
    //                           it changes nothing.
    //   POST /freigabe          decides. Token in the *body*, so it never lands
    //                           in an access log, a Referer header or a browser
    //                           history alongside the act of using it.
    //
    // Both are deliberately public — `isAuthenticated` is not called, and must
    // not be added. The counter-checker has no account; the token is the whole
    // credential. Equally, a signed-in session grants nothing extra here.

    // --- the public blog ------------------------------------------------------
    //
    // Also deliberately public: published articles are, by definition, meant to
    // be read without an account — the Dorfkönig already consumes them.
    //
    // The safety argument is the narrowness of the projection, not the caller:
    // the filter is hard-wired to `status = publiziert`, and the field list
    // names only what a reader may see. No drafts, no `fehler`, no `anweisung`,
    // no chat, no approval tokens — none of those columns are even mentioned.
    // The service runs as the system on purpose, because an anonymous caller
    // has no accountability to act under.
    router.get(
      '/blog',
      async (_req: ApiRequest, res: Response, next: NextFunction) => {
        try {
          const schema = await getSchema()
          const meldungen = new ItemsService('meldungen', { schema })

          const beitraege = (await meldungen.readByQuery({
            filter: { status: { _eq: 'publiziert' } },
            fields: [
              'id',
              'titel',
              'lead',
              'text',
              'publiziert_am',
              'gemeinde.name',
              'spiel.sportart',
              'spiel.heim',
              'spiel.gast',
              'spiel.datum'
            ],
            sort: ['-publiziert_am'],
            // Bounded: a public route must not become an unbounded dump. The
            // newest 200 are more than any municipal blog page needs.
            limit: 200
          })) as unknown[]

          return res.json({ data: beitraege })
        } catch (error) {
          logger.error(error, 'redaktion: Blog konnte nicht gelesen werden')
          return next(error)
        }
      }
    )

    router.get(
      '/freigabe/:token',
      async (req: ApiRequest, res: Response, next: NextFunction) => {
        try {
          const token = req.params['token']
          if (typeof token !== 'string' || token.length < 20) {
            return res.status(404).json({
              errors: [
                {
                  message: befundText({ gueltig: false, grund: 'unbekannt' })
                }
              ]
            })
          }

          const schema = await getSchema()
          // No accountability: this route has no user by design.
          const meldungen = new ItemsService('meldungen', { schema })

          const treffer = (await meldungen.readByQuery({
            filter: { freigabe_token_hash: { _eq: hashToken(token) } },
            fields: [
              'id',
              'titel',
              'lead',
              'text',
              'status',
              'freigabe_token_ablauf',
              'freigegeben_am',
              'gemeinde.name'
            ],
            limit: 1
          })) as (Pick<
            Meldung,
            | 'id'
            | 'titel'
            | 'lead'
            | 'text'
            | 'status'
            | 'freigabe_token_ablauf'
            | 'freigegeben_am'
          > & { gemeinde?: { name?: string } })[]

          const meldung = treffer[0]
          if (meldung === undefined) {
            return res.status(404).json({
              errors: [
                {
                  message: befundText({ gueltig: false, grund: 'unbekannt' })
                }
              ]
            })
          }

          const befund = evaluateToken(
            {
              hash: 'vorhanden',
              ablauf: meldung.freigabe_token_ablauf,
              freigegebenAm: meldung.freigegeben_am
            },
            new Date()
          )

          return res.json({
            data: {
              gueltig: befund.gueltig,
              hinweis: befundText(befund),
              gemeinde: meldung.gemeinde?.name ?? null,
              titel: meldung.titel,
              lead: meldung.lead,
              text: meldung.text
            }
          })
        } catch (error) {
          return next(error)
        }
      }
    )

    // Match reports for every result that has none yet.
    //
    // Written straight through rather than queued: a report needs one model call
    // over facts we already hold, so there is nothing to schedule. It also keeps
    // the statistics queue out of it — `drain` only ever picks up rows it marked
    // `geplant` itself, and these are stored finished.
    router.post(
      '/spielberichte',
      async (req: ApiRequest, res: Response, next: NextFunction) => {
        if (!isAuthenticated(req)) return next(new NichtAngemeldet())

        const schema = await getSchema()
        const spieleService = new ItemsService('spiele', {
          schema,
          accountability: req.accountability
        })
        const meldungenService = new ItemsService('meldungen', {
          schema,
          accountability: req.accountability
        })

        const hoechstens = 10

        try {
          const beschrieben = (await meldungenService.readByQuery({
            filter: { spiel: { _nnull: true } },
            fields: ['spiel'],
            limit: -1
          })) as Array<{ spiel: string }>
          const schonBeschrieben = new Set(beschrieben.map((m) => m.spiel))

          const mitResultat = (await spieleService.readByQuery({
            filter: { tore_heim: { _nnull: true } },
            fields: [
              'id',
              'datum',
              'heim',
              'gast',
              'tore_heim',
              'tore_gast',
              'wettbewerb',
              'ort',
              // Ask for the ids explicitly: requesting `gemeinde` alongside
              // `gemeinde.name` yields an object carrying only the name, and the
              // write then fails validation on a field that looks present.
              'gemeinde.id',
              'gemeinde.name',
              'verein.id',
              'verein.name',
              'verein.liga',
              'verein.notiz'
            ],
            sort: ['-datum'],
            limit: -1
          })) as SpielZeile[]

          const offen = mitResultat
            .filter((spiel) => !schonBeschrieben.has(spiel.id))
            .slice(0, hoechstens)

          if (offen.length === 0) return next(new NichtsZuTun())

          let erzeugt = 0
          const fehlgeschlagen: string[] = []

          for (const spiel of offen) {
            try {
              // The club's own earlier results — the memory this project keeps.
              const frueher = mitResultat
                .filter(
                  (a) =>
                    a.verein.id === spiel.verein.id &&
                    a.id !== spiel.id &&
                    a.datum < spiel.datum
                )
                .slice(0, 5)
                .map((a) => ({
                  datum: a.datum,
                  heim: a.heim,
                  gast: a.gast,
                  toreHeim: a.tore_heim as number,
                  toreGast: a.tore_gast as number
                }))

              const fakten = {
                heim: spiel.heim,
                gast: spiel.gast,
                toreHeim: spiel.tore_heim as number,
                toreGast: spiel.tore_gast as number,
                wettbewerb: spiel.wettbewerb,
                datum: spiel.datum,
                ort: spiel.ort,
                verein: spiel.verein.name,
                gemeinde: spiel.gemeinde.name,
                liga: spiel.verein.liga,
                notiz: spiel.verein.notiz,
                frueher
              }

              const antwort = await completeJson<unknown>({
                system: SPIELBERICHT_SYSTEM_PROMPT,
                prompt: buildSpielberichtPrompt(fakten),
                maxTokens: 1200
              })
              const bericht = parseSpielbericht(antwort)

              const warnungen = [
                ...zeitWarnungen(
                  `${bericht.titel} ${bericht.lead} ${bericht.text}`
                ),
                ...zahlWarnungen(
                  `${bericht.titel} ${bericht.lead} ${bericht.text}`,
                  fakten
                )
              ]

              await meldungenService.createOne({
                spiel: spiel.id,
                gemeinde: spiel.gemeinde.id,
                titel: bericht.titel,
                lead: bericht.lead,
                text: bericht.text,
                status: 'entwurf',
                verarbeitung: 'idle',
                zeit_warnungen: warnungen.length > 0 ? warnungen : null,
                // Provenance, so the figures in the article can be checked
                // against what was handed over.
                datengrundlage: {
                  quelle: 'matchcenter',
                  heim: spiel.heim,
                  gast: spiel.gast,
                  tore_heim: spiel.tore_heim,
                  tore_gast: spiel.tore_gast,
                  wettbewerb: spiel.wettbewerb,
                  datum: spiel.datum
                }
              })
              erzeugt += 1
            } catch (fehler) {
              // One bad match must not cost the others their report.
              logger.warn(
                fehler,
                `redaktion: Spielbericht fuer ${spiel.heim} – ${spiel.gast} fehlgeschlagen`
              )
              fehlgeschlagen.push(`${spiel.heim} – ${spiel.gast}`)
            }
          }

          res.json({ data: { erzeugt, offen: offen.length, fehlgeschlagen } })
        } catch (error) {
          logger.error(error, 'redaktion: Spielberichte fehlgeschlagen')
          next(error)
        }
      }
    )

    // --- Entsorgung: the printed calendar, and the year of reminders it holds ---
    //
    // Four steps, each its own route because each is a decision an editor makes:
    // register the PDF, read it, confirm what was read, write the year. Nothing
    // here is scheduled — reading a calendar costs a model call and happens once
    // a year per municipality, so a person asks for it. Only the publishing of
    // finished reminders runs on a cron.

    router.post(
      '/entsorgung/kalender',
      async (req: ApiRequest, res: Response, next: NextFunction) => {
        if (!isAuthenticated(req)) return next(new NichtAngemeldet())

        try {
          const body = req.body as
            | {
                gemeinde?: unknown
                jahr?: unknown
                url?: unknown
                datei?: { name?: unknown; base64?: unknown }
                zone?: unknown
                zusatz?: unknown
              }
            | undefined

          const gemeinde = pruefeId(body?.gemeinde)
          const jahr = Number(body?.jahr)
          if (!Number.isInteger(jahr) || jahr < 2000 || jahr > 2100) {
            throw new UngueltigesJahr()
          }

          const url = typeof body?.url === 'string' ? body.url.trim() : ''
          const base64 =
            typeof body?.datei?.base64 === 'string' ? body.datei.base64 : ''
          if (url === '' && base64 === '') throw new KeinePdf()

          // Municipalities like Riehen print one PDF per zone. The zone is a
          // label the editor reads off the cover — it scopes this document and
          // every date read from it.
          const zone =
            typeof body?.zone === 'string' && body.zone.trim() !== ''
              ? body.zone.trim()
              : null
          const zusatz =
            typeof body?.zusatz === 'string' && body.zusatz.trim() !== ''
              ? body.zusatz.trim()
              : null

          const schema = await getSchema()
          const kalenderService = new ItemsService('entsorgungskalender', {
            schema,
            accountability: req.accountability
          })
          const dokumenteService = new ItemsService('entsorgungsdokumente', {
            schema,
            accountability: req.accountability
          })

          const inhalt =
            base64 === '' ? await ladePdfVonUrl(url) : dekodierePdf(base64)

          const gemeindeName = await leseGemeindeName(schema, gemeinde)
          const dateiId = await legePdfAb(
            schema,
            req,
            inhalt,
            `Abfuhrkalender ${gemeindeName} ${jahr}${zone === null ? '' : ` ${zone}`}.pdf`
          )

          // One calendar per municipality and year; the documents hang below
          // it. Registering a second zone joins the existing calendar instead
          // of competing with it.
          const [bestehend] = (await kalenderService.readByQuery({
            filter: { gemeinde: { _eq: gemeinde }, jahr: { _eq: jahr } },
            fields: ['id'],
            limit: 1
          })) as Array<{ id: string }>

          const kalenderId =
            bestehend?.id ??
            ((await kalenderService.createOne({
              gemeinde,
              jahr,
              status: 'hochgeladen'
            })) as string)

          // A corrected PDF updates the zone's document, never opens a second
          // one. The termine stay untouched until someone asks for a fresh
          // reading.
          const [vorhandenesDokument] = (await dokumenteService.readByQuery({
            filter: {
              kalender: { _eq: kalenderId },
              zone: zone === null ? { _null: true } : { _eq: zone }
            },
            fields: ['id'],
            limit: 1
          })) as Array<{ id: string }>

          const dokumentFelder = {
            pdf: dateiId,
            quelle_url: url === '' ? null : url,
            ...(zusatz === null ? {} : { zusatz }),
            status: 'hochgeladen',
            fehler: null
          }

          let dokumentId: string
          if (vorhandenesDokument !== undefined) {
            await dokumenteService.updateOne(
              vorhandenesDokument.id,
              dokumentFelder
            )
            dokumentId = vorhandenesDokument.id
          } else {
            dokumentId = (await dokumenteService.createOne({
              kalender: kalenderId,
              zone,
              ...dokumentFelder
            })) as string
          }

          // A new or re-uploaded document means the calendar as a whole is no
          // longer read out.
          await kalenderService.updateOne(kalenderId, { status: 'hochgeladen' })

          return res.json({
            data: {
              kalender: kalenderId,
              dokument: dokumentId,
              aktualisiert: vorhandenesDokument !== undefined
            }
          })
        } catch (error) {
          return next(uebersetze(error))
        }
      }
    )

    router.post(
      '/entsorgung/kalender/:id/extrahieren',
      async (req: ApiRequest, res: Response, next: NextFunction) => {
        if (!isAuthenticated(req)) return next(new NichtAngemeldet())

        const schema = await getSchema()
        const kalenderService = new ItemsService('entsorgungskalender', {
          schema,
          accountability: req.accountability
        })
        const termineService = new ItemsService('entsorgungstermine', {
          schema,
          accountability: req.accountability
        })

        const dokumenteService = new ItemsService('entsorgungsdokumente', {
          schema,
          accountability: req.accountability
        })

        let id: string
        try {
          id = pruefeId(req.params['id'])
        } catch (error) {
          return next(uebersetze(error))
        }

        let kalender: { id: string; jahr: number; gemeinde: { name: string } }
        let dokumente: Array<{
          id: string
          zone: string | null
          pdf: string | null
        }>
        try {
          kalender = (await kalenderService.readOne(id, {
            fields: ['id', 'jahr', 'gemeinde.name']
          })) as typeof kalender

          dokumente = (await dokumenteService.readByQuery({
            filter: { kalender: { _eq: id } },
            fields: ['id', 'zone', 'pdf'],
            sort: ['zone'],
            limit: -1
          })) as typeof dokumente

          if (
            dokumente.length === 0 ||
            dokumente.every((d) => d.pdf === null)
          ) {
            throw new KeinPdfAmKalender()
          }
        } catch (error) {
          return next(uebersetze(error))
        }

        if (laufendeExtraktionen.has(id)) {
          return next(new ExtraktionLaeuftBereits())
        }
        laufendeExtraktionen.add(id)

        // The run has left the request, so its progress lives on the records:
        // every document with a PDF turns 'liest' now and 'extrahiert' or
        // 'fehler' as it finishes. The caller polls exactly these statuses.
        try {
          await kalenderService.updateOne(id, { status: 'liest' })
          for (const dokument of dokumente) {
            if (dokument.pdf === null) continue
            await dokumenteService.updateOne(dokument.id, {
              status: 'liest',
              fehler: null
            })
          }
        } catch (error) {
          laufendeExtraktionen.delete(id)
          return next(uebersetze(error))
        }

        const auslesen = async (): Promise<void> => {
          // One Opus call per document. Per-document try/catch, so a broken
          // Zone-1 PDF never costs Zone 2 its year — municipalities like
          // Riehen print one calendar per zone, and each stands on its own.
          const ergebnis = {
            termine: 0,
            neu: 0,
            aktualisiert: 0,
            geloescht: 0,
            invalidiert: 0,
            warnungen: 0,
            regelmaessig: 0,
            hinweise: [] as string[],
            fehlgeschlagen: [] as string[]
          }
          const abschnitte: Array<{
            zone: string | null
            extraktion: ReturnType<typeof parseExtraktion>
          }> = []

          for (const dokument of dokumente) {
            const zonenName = dokument.zone ?? 'ganze Gemeinde'
            if (dokument.pdf === null) {
              ergebnis.fehlgeschlagen.push(`${zonenName}: kein PDF hinterlegt`)
              continue
            }

            try {
              const pdfBase64 = (await lesePdf(schema, dokument.pdf)).toString(
                'base64'
              )

              // The answer is one row per collection with its dates as an
              // array — the calendar's own shape — so a whole year fits in a
              // few thousand tokens. That matters beyond cost: a non-streaming
              // request with a very large budget is refused outright by the
              // SDK, and truncation here would be a half year that still
              // parses, which is exactly the silent failure this project
              // refuses.
              const antwort = await completeChatJson<unknown>({
                system: EXTRAKTION_SYSTEM_PROMPT,
                messages: buildExtraktionMessages(
                  pdfBase64,
                  kalender.gemeinde.name,
                  kalender.jahr,
                  dokument.zone
                ),
                model: 'claude-opus-5',
                // The budget carries the model's thinking as well as the
                // answer, and a dense year grid takes far more deliberation
                // than a tidy number table: Aesch (365 day cells, three
                // weekly zones) blew through 16k and 32k before finishing.
                // Budgets this size stream under the hood — see
                // `sendToClaude` — so the SDK's long-request refusal does not
                // apply, and the run is detached from the request, so the
                // minutes it takes hold no connection open.
                maxTokens: 64000,
                schema: EXTRAKTION_SCHEMA
              })

              const extraktion = parseExtraktion(
                antwort,
                kalender.jahr,
                dokument.zone
              )
              abschnitte.push({ zone: dokument.zone, extraktion })

              // Re-extraction is scoped to this document's own termine: the
              // other zones' dates came from other PDFs and are not up for
              // debate here.
              const bestehende = (await termineService.readByQuery({
                filter: { dokument: { _eq: dokument.id } },
                fields: [
                  'id',
                  'kategorie',
                  'zone',
                  'datum',
                  'bereitstellung',
                  'anmeldung',
                  'anmeldeschluss',
                  'anmeldeschluss_zeit',
                  'geprueft',
                  'meldung'
                ],
                limit: -1
              })) as GespeicherterTermin[]

              const diff = diffTermine(bestehende, extraktion.termine)

              for (const termin of diff.anlegen) {
                await termineService.createOne({
                  kalender: id,
                  dokument: dokument.id,
                  ...terminFelder(termin),
                  geprueft: false
                })
              }
              for (const eintrag of diff.aktualisieren) {
                await termineService.updateOne(eintrag.id, {
                  ...terminFelder(eintrag.termin),
                  geprueft: false,
                  meldung: null
                })
              }
              for (const termin of diff.loeschen) {
                await termineService.deleteOne(termin.id)
              }
              for (const meldungId of diff.invalidiereMeldungen) {
                await invalidiereErinnerung(schema, meldungId)
              }

              await dokumenteService.updateOne(dokument.id, {
                status: 'extrahiert',
                extraktion: extraktion as unknown as Record<string, unknown>,
                fehler: null
              })

              ergebnis.termine += extraktion.termine.length
              ergebnis.neu += diff.anlegen.length
              ergebnis.aktualisiert += diff.aktualisieren.length
              ergebnis.geloescht += diff.loeschen.length
              ergebnis.invalidiert += diff.invalidiereMeldungen.length
              ergebnis.warnungen += extraktion.termine.filter(
                (termin) => wochentagWarnung(termin) !== null
              ).length
              ergebnis.regelmaessig += extraktion.regelmaessig.length
              ergebnis.hinweise.push(
                ...extraktion.hinweise.map((hinweis) =>
                  dokument.zone === null ? hinweis : `${zonenName}: ${hinweis}`
                )
              )
            } catch (fehler) {
              // The reason lands at the document, where a person can see which
              // of the PDFs would not read.
              logger.error(
                fehler,
                `redaktion: Abfuhrkalender-Dokument ${zonenName} auslesen fehlgeschlagen`
              )
              ergebnis.fehlgeschlagen.push(zonenName)
              try {
                await dokumenteService.updateOne(dokument.id, {
                  status: 'fehler',
                  fehler: fehlerText(fehler)
                })
              } catch (schreibfehler) {
                logger.warn(
                  schreibfehler,
                  'redaktion: Fehler am Dokument nicht notiert'
                )
              }
            }
          }

          await kalenderService.updateOne(id, {
            status:
              ergebnis.fehlgeschlagen.length > 0 ? 'fehler' : 'extrahiert',
            merkblatt: merkblattGesamt(abschnitte)
          })

          logger.info(ergebnis, 'redaktion: Abfuhrkalender ausgelesen')
        }

        // Detached on purpose: reading a dense year grid with Opus takes
        // minutes, longer than any HTTP or proxy timeout is willing to hold a
        // connection open. Nothing here can reach this catch through normal
        // failure — per-document errors land on the document — so it only
        // guards the bookkeeping around the loop.
        void auslesen()
          .catch(async (fehler) => {
            logger.error(
              fehler,
              'redaktion: Abfuhrkalender auslesen fehlgeschlagen'
            )
            try {
              await kalenderService.updateOne(id, { status: 'fehler' })
            } catch (schreibfehler) {
              logger.warn(
                schreibfehler,
                'redaktion: Fehler am Kalender nicht notiert'
              )
            }
          })
          .finally(() => {
            laufendeExtraktionen.delete(id)
          })

        return res.status(202).json({
          data: {
            gestartet: dokumente.filter((d) => d.pdf !== null).length
          }
        })
      }
    )

    router.post(
      '/entsorgung/kalender/:id/pruefen',
      async (req: ApiRequest, res: Response, next: NextFunction) => {
        if (!isAuthenticated(req)) return next(new NichtAngemeldet())

        try {
          const id = pruefeId(req.params['id'])
          const body = req.body as { termine?: unknown } | undefined
          const schema = await getSchema()

          const kalenderService = new ItemsService('entsorgungskalender', {
            schema,
            accountability: req.accountability
          })
          const termineService = new ItemsService('entsorgungstermine', {
            schema,
            accountability: req.accountability
          })

          const gewaehlt = Array.isArray(body?.termine)
            ? body.termine.filter(
                (wert): wert is string =>
                  typeof wert === 'string' && UUID.test(wert)
              )
            : null

          const offen = (await termineService.readByQuery({
            filter: {
              kalender: { _eq: id },
              geprueft: { _eq: false },
              ...(gewaehlt === null ? {} : { id: { _in: gewaehlt } })
            },
            fields: ['id'],
            limit: -1
          })) as Array<{ id: string }>

          for (const termin of offen) {
            await termineService.updateOne(termin.id, { geprueft: true })
          }

          // The calendar counts as confirmed once nothing is left unconfirmed —
          // that is what unlocks writing the year.
          const [nochOffen] = (await termineService.readByQuery({
            filter: { kalender: { _eq: id }, geprueft: { _eq: false } },
            fields: ['id'],
            limit: 1
          })) as Array<{ id: string }>

          if (nochOffen === undefined) {
            await kalenderService.updateOne(id, { status: 'geprueft' })
          }

          return res.json({
            data: {
              bestaetigt: offen.length,
              vollstaendig: nochOffen === undefined
            }
          })
        } catch (error) {
          return next(uebersetze(error))
        }
      }
    )

    router.post(
      '/entsorgung/kalender/:id/meldungen',
      async (req: ApiRequest, res: Response, next: NextFunction) => {
        if (!isAuthenticated(req)) return next(new NichtAngemeldet())

        const schema = await getSchema()
        const kalenderService = new ItemsService('entsorgungskalender', {
          schema,
          accountability: req.accountability
        })
        const termineService = new ItemsService('entsorgungstermine', {
          schema,
          accountability: req.accountability
        })
        const meldungenService = new ItemsService('meldungen', {
          schema,
          accountability: req.accountability
        })

        try {
          const id = pruefeId(req.params['id'])

          const kalender = (await kalenderService.readOne(id, {
            fields: ['id', 'jahr', 'status', 'gemeinde.id', 'gemeinde.name']
          })) as {
            id: string
            jahr: number
            status: string
            gemeinde: { id: string; name: string }
          }

          if (kalender.status !== 'geprueft') throw new NochNichtGeprueft()

          // The source link and the zone note travel with each Termin's own
          // document — for Riehen that is the zone's PDF, the one the reader
          // actually needs.
          const alle = (await termineService.readByQuery({
            filter: { kalender: { _eq: id }, geprueft: { _eq: true } },
            fields: [
              'id',
              'kategorie',
              'zone',
              'datum',
              'bereitstellung',
              'anmeldung',
              'anmeldeschluss',
              'anmeldeschluss_zeit',
              'dokument.quelle_url',
              'dokument.zusatz'
            ],
            sort: ['datum'],
            limit: -1
          })) as Array<
            PlanTermin & {
              dokument: {
                quelle_url: string | null
                zusatz: string | null
              } | null
            }
          >
          for (const termin of alle) {
            termin.quelle_url = termin.dokument?.quelle_url ?? null
            termin.zusatz = termin.dokument?.zusatz ?? null
          }

          const plan = planeErinnerungen(alle, heuteIso())
          if (plan.gruppen.length === 0 && plan.verpasst.length === 0) {
            return next(new NichtsZuTun())
          }

          // Erscheinungstage that already carry a reminder are skipped, so a
          // second run fills gaps instead of colliding with the partial unique.
          const vorhanden = (await meldungenService.readByQuery({
            filter: {
              gemeinde: { _eq: kalender.gemeinde.id },
              erscheint_am: { _nnull: true },
              status: { _neq: 'verworfen' }
            },
            fields: ['erscheint_am'],
            limit: -1
          })) as Array<{ erscheint_am: string }>
          const belegt = new Set(vorhanden.map((m) => m.erscheint_am))

          let erzeugt = 0
          let uebersprungen = 0
          const fehlgeschlagen: string[] = []

          for (const gruppe of plan.gruppen) {
            if (belegt.has(gruppe.erscheintAm)) {
              uebersprungen += 1
              continue
            }

            try {
              const fakten = baueFakten(
                gruppe,
                alle,
                kalender.gemeinde.name,
                kalender.jahr
              )
              const { erinnerung, warnungen } = await schreibeErinnerung(fakten)

              const meldungId = (await meldungenService.createOne({
                gemeinde: kalender.gemeinde.id,
                erscheint_am: gruppe.erscheintAm,
                titel: erinnerung.titel,
                lead: erinnerung.lead,
                text: erinnerung.text,
                status: 'entwurf',
                // Stored finished: the statistics queue only ever picks up rows
                // it marked `geplant` itself.
                verarbeitung: 'idle',
                zeit_warnungen: warnungen.length > 0 ? warnungen : null,
                datengrundlage: datengrundlageErinnerung(fakten)
              })) as string

              for (const termin of gruppe.termine) {
                await termineService.updateOne(termin.id, {
                  meldung: meldungId
                })
              }
              erzeugt += 1
            } catch (fehler) {
              // One bad edition must not cost the rest of the year.
              logger.warn(
                fehler,
                `redaktion: Erinnerung fuer ${kalender.gemeinde.name} am ${gruppe.erscheintAm} fehlgeschlagen`
              )
              fehlgeschlagen.push(gruppe.erscheintAm)
            }
          }

          return res.json({
            data: {
              erzeugt,
              uebersprungen,
              // Named, not swallowed: a calendar uploaded in March has lost
              // January and February, and the editor should learn that here.
              verpasst: plan.verpasst.length,
              fehlgeschlagen
            }
          })
        } catch (error) {
          return next(uebersetze(error))
        }
      }
    )

    router.post(
      '/entsorgung/kalender/:id/freigeben',
      async (req: ApiRequest, res: Response, next: NextFunction) => {
        if (!isAuthenticated(req)) return next(new NichtAngemeldet())

        try {
          const id = pruefeId(req.params['id'])
          const schema = await getSchema()

          const termineService = new ItemsService('entsorgungstermine', {
            schema,
            accountability: req.accountability
          })
          const meldungenService = new ItemsService('meldungen', {
            schema,
            accountability: req.accountability
          })

          const termine = (await termineService.readByQuery({
            filter: { kalender: { _eq: id }, meldung: { _nnull: true } },
            fields: ['meldung'],
            limit: -1
          })) as Array<{ meldung: string }>

          const ids = [...new Set(termine.map((termin) => termin.meldung))]
          if (ids.length === 0) return next(new NichtsZuTun())

          const entwuerfe = (await meldungenService.readByQuery({
            filter: { id: { _in: ids }, status: { _eq: 'entwurf' } },
            fields: ['id'],
            limit: -1
          })) as Array<{ id: string }>

          let erledigt = 0
          const abgelehnt: string[] = []

          for (const meldung of entwuerfe) {
            try {
              await meldungenService.updateOne(meldung.id, {
                status: 'freigegeben'
              })
              erledigt += 1
            } catch (fehler) {
              abgelehnt.push(fehlerText(fehler))
            }
          }

          return res.json({ data: { erledigt, abgelehnt } })
        } catch (error) {
          return next(uebersetze(error))
        }
      }
    )

    router.post(
      '/freigabe',
      async (req: ApiRequest, res: Response, next: NextFunction) => {
        try {
          const body = req.body as
            | { token?: unknown; entscheidung?: unknown; kommentar?: unknown }
            | undefined

          const token = body?.token
          const entscheidung = body?.entscheidung

          if (typeof token !== 'string' || token.length < 20) {
            return res.status(404).json({
              errors: [
                { message: befundText({ gueltig: false, grund: 'unbekannt' }) }
              ]
            })
          }
          if (entscheidung !== 'ja' && entscheidung !== 'nein') {
            return next(new UngueltigeEntscheidung())
          }

          const kommentar =
            typeof body?.kommentar === 'string'
              ? body.kommentar.trim().slice(0, 2000)
              : null

          // One conditional UPDATE, so two people clicking at the same moment
          // cannot both win. Nulling the hash in the same statement makes the
          // link unusable from that instant — replay finds nothing.
          const jetzt = new Date()
          const betroffen = (await database('meldungen')
            .update({
              entscheidung,
              entscheidung_klartext: kommentar,
              freigegeben_am: jetzt,
              freigabe_token_hash: null
            })
            .where('freigabe_token_hash', hashToken(token))
            .whereNull('freigegeben_am')
            .where('freigabe_token_ablauf', '>', jetzt)
            .returning(['id', 'lauf'])) as { id: string; lauf: string }[]

          const meldung = betroffen[0]
          if (meldung === undefined) {
            // Could be unknown, expired or already decided — we no longer know
            // which, and saying so precisely would require a second lookup that
            // buys the caller nothing.
            return res.status(409).json({
              errors: [
                {
                  message:
                    'Dieser Link ist nicht mehr gueltig oder wurde bereits benutzt.'
                }
              ]
            })
          }

          // The status change goes through the service so the state machine sees
          // it. A "no" goes back to the newsroom rather than being thrown away.
          const meldungen = new ItemsService('meldungen', {
            schema: await getSchema()
          })
          await meldungen.updateOne(meldung.id, {
            status: entscheidung === 'ja' ? 'freigegeben' : 'entwurf'
          })

          logger.info(
            `redaktion: Gegenpruefung entschieden — Meldung ${meldung.id}: ${entscheidung}`
          )

          return res.json({
            data: {
              entscheidung,
              hinweis:
                entscheidung === 'ja'
                  ? 'Danke. Die Meldung ist freigegeben.'
                  : 'Danke. Die Meldung geht zurueck an die Redaktion.'
            }
          })
        } catch (error) {
          return next(error)
        }
      }
    )

    // --- helpers --------------------------------------------------------------

    /**
     * Mints an approval link for one article.
     *
     * The token is generated here and returned to the editor exactly once — it
     * is never stored, only its digest is, so this is the single moment it
     * exists in readable form. Losing it means minting a new one, which is the
     * correct trade.
     */
    async function mintFreigabe(
      meldungen: {
        readOne(id: string, q?: Record<string, unknown>): Promise<unknown>
        updateOne(id: string, p: Record<string, unknown>): Promise<unknown>
      },
      id: string
    ): Promise<{ kanal: string; hinweis: string }> {
      const meldung = (await meldungen.readOne(id, {
        fields: ['id', 'titel', 'gemeinde.name']
      })) as { titel: string | null; gemeinde?: { name?: string } }

      const token = createToken()
      const tage = Number.parseInt(
        optionalEnv('REDAKTION_TOKEN_TTL_TAGE', '14'),
        10
      )

      await meldungen.updateOne(id, {
        freigabe_token_hash: hashToken(token),
        freigabe_token_ablauf: ablaufDatum(
          new Date(),
          Number.isFinite(tage) ? tage : 14
        ).toISOString(),
        // A fresh request supersedes whatever came before it.
        entscheidung: null,
        entscheidung_klartext: null,
        freigegeben_am: null
      })

      const link = freigabeLink(
        optionalEnv('FRONT_PUBLIC_URL', 'http://localhost:3000'),
        token
      )

      const zustellung = await new LinkNotifier().send(
        baueFreigabeNachricht(
          meldung.gemeinde?.name ?? 'diese Gemeinde',
          meldung.titel ?? '(ohne Titel)',
          link
        )
      )

      return { kanal: zustellung.kanal, hinweis: zustellung.hinweis }
    }

    function leseAnweisung(req: ApiRequest): string {
      const body = req.body as { anweisung?: unknown } | undefined
      const anweisung = body?.anweisung

      if (typeof anweisung !== 'string' || anweisung.trim() === '') {
        throw new LeereAnweisung()
      }
      return anweisung.trim().slice(0, 2000)
    }

    /**
     * The run instruction. Optional — an empty body is the ordinary path from
     * the dataset list, where there is nothing to say beyond "write it".
     */
    function leseVorgabe(req: ApiRequest): string | null {
      const body = req.body as { vorgabe?: unknown } | undefined
      const vorgabe = body?.vorgabe

      if (typeof vorgabe !== 'string' || vorgabe.trim() === '') return null
      return vorgabe.trim().slice(0, 2000)
    }

    /**
     * The municipality column, when a person names it.
     *
     * Only the name travels; whether it exists in the dataset is decided in
     * `detectMunicipalityFields` against the portal's real field list, which is
     * the only place that can know.
     */
    function leseGemeindefeld(req: ApiRequest): string | null {
      const body = req.body as { gemeindefeld?: unknown } | undefined
      const feld = body?.gemeindefeld

      if (typeof feld !== 'string' || feld.trim() === '') return null
      return feld.trim().slice(0, 100)
    }

    async function naechstePosition(
      chat: { readByQuery(q: Record<string, unknown>): Promise<unknown[]> },
      filter: Record<string, unknown>
    ): Promise<number> {
      const letzte = (await chat.readByQuery({
        filter,
        fields: ['position'],
        sort: ['-position'],
        limit: 1
      })) as { position: number }[]

      return (letzte[0]?.position ?? -1) + 1
    }

    function fehlerText(fehler: unknown): string {
      return fehler instanceof Error ? fehler.message : String(fehler)
    }

    /**
     * Rewrites one match report from its stored facts plus the instruction.
     *
     * The facts are re-read from `spiele` rather than taken from the article:
     * the article is what is being corrected, so it cannot be its own source.
     * Returns the check warnings so the chat can show them.
     */
    interface GeladenePresseschau {
      fakten: PresseschauFakten
      gemeindeId: string
      volltext: string | null
    }

    /** Candidate, issue and paper in one read — the facts a press review runs on. */
    async function ladePresseschauFakten(
      schema: Awaited<ReturnType<typeof getSchema>>,
      kandidatId: string
    ): Promise<GeladenePresseschau> {
      const kandidaten = new ItemsService('wochenblattkandidaten', { schema })

      const kandidat = (await kandidaten.readOne(kandidatId, {
        fields: [
          'id',
          'titel',
          'seite',
          'typ',
          'frontseite',
          'zusammenfassung',
          'gemeinde.id',
          'gemeinde.name',
          'ausgabe.nummer',
          'ausgabe.schluessel',
          'ausgabe.datum',
          'ausgabe.pdf_url',
          'ausgabe.volltext',
          'ausgabe.wochenblatt.name',
          'ausgabe.wochenblatt.gemeinde.id',
          'ausgabe.wochenblatt.gemeinde.name'
        ]
      })) as {
        id: string
        titel: string
        seite: number | null
        typ: PresseschauFakten['typ']
        frontseite: boolean
        zusammenfassung: string | null
        /** The per-piece assignment — multi-municipality papers live on this. */
        gemeinde: { id: string; name: string } | null
        ausgabe: {
          nummer: string | null
          schluessel: string
          datum: string | null
          pdf_url: string | null
          volltext: string | null
          wochenblatt: { name: string; gemeinde: { id: string; name: string } }
        }
      }

      if (
        kandidat.zusammenfassung === null ||
        kandidat.zusammenfassung.trim() === ''
      ) {
        // Without the fact summary there is nothing to write FROM — and
        // writing from the model's memory of the PDF is exactly what the
        // one-source rule forbids.
        throw new NichtsZuTun()
      }

      const gemeinde =
        kandidat.gemeinde ?? kandidat.ausgabe.wochenblatt.gemeinde

      return {
        gemeindeId: gemeinde.id,
        volltext: kandidat.ausgabe.volltext,
        fakten: {
          blatt: kandidat.ausgabe.wochenblatt.name,
          nummer: kandidat.ausgabe.nummer ?? kandidat.ausgabe.schluessel,
          datum: kandidat.ausgabe.datum,
          gemeinde: gemeinde.name,
          titel: kandidat.titel,
          seite: kandidat.seite,
          typ: kandidat.typ,
          frontseite: kandidat.frontseite,
          zusammenfassung: kandidat.zusammenfassung,
          pdfUrl: kandidat.ausgabe.pdf_url
        }
      }
    }

    /**
     * One write with the checks that make it a press review: attribution
     * proven (with one correction retry — a press review without its source
     * is not a press review), digits held to the handed facts, and the text
     * slid over the issue's own words. The overlap check runs BEFORE the
     * source line is appended — the URL's digits are nobody's claim.
     */
    async function presseschauMitChecks(
      fakten: PresseschauFakten,
      volltext: string | null,
      prompt: string
    ): Promise<{
      bericht: { titel: string; lead: string; text: string }
      warnungen: string[]
    }> {
      let bericht = parsePresseschau(
        await completeJson<unknown>({
          system: PRESSESCHAU_SYSTEM_PROMPT,
          prompt,
          maxTokens: 1500
        })
      )

      let attribution = attributionsWarnung(
        `${bericht.lead} ${bericht.text}`,
        fakten
      )
      if (attribution !== null) {
        bericht = parsePresseschau(
          await completeJson<unknown>({
            system: PRESSESCHAU_SYSTEM_PROMPT,
            prompt: buildPresseschauRevision(
              fakten,
              bericht,
              `Nenne die Quelle im Fliesstext: "${fakten.blatt} (Nr. ${fakten.nummer})".`
            ),
            maxTokens: 1500
          })
        )
        attribution = attributionsWarnung(
          `${bericht.lead} ${bericht.text}`,
          fakten
        )
      }

      const alles = `${bericht.titel} ${bericht.lead} ${bericht.text}`
      const warnungen = [
        ...zeitWarnungen(alles),
        ...zahlWarnungenPresseschau(alles, fakten),
        ...(attribution === null ? [] : [attribution]),
        ...(volltext !== null && volltext.trim().length >= 50
          ? ueberlappungsWarnungen(alles, volltext)
          : ['Volltext der Ausgabe fehlt — Ueberlappungs-Check uebersprungen.'])
      ]

      return { bericht, warnungen }
    }

    async function schreibePresseschau(
      fakten: PresseschauFakten,
      volltext: string | null
    ): Promise<{
      bericht: { titel: string; lead: string; text: string }
      warnungen: string[]
    }> {
      return presseschauMitChecks(
        fakten,
        volltext,
        buildPresseschauPrompt(fakten)
      )
    }

    async function ueberarbeitePresseschau(
      meldung: {
        id: string
        titel: string | null
        lead: string | null
        text: string | null
      },
      kandidatId: string,
      anweisung: string
    ): Promise<string[]> {
      const schema = await getSchema()
      const meldungen = new ItemsService('meldungen', { schema })

      const geladen = await ladePresseschauFakten(schema, kandidatId)
      const { bericht, warnungen } = await presseschauMitChecks(
        geladen.fakten,
        geladen.volltext,
        buildPresseschauRevision(geladen.fakten, meldung, anweisung)
      )

      await meldungen.updateOne(meldung.id, {
        titel: bericht.titel,
        lead: bericht.lead,
        text: mitQuelle(bericht.text, geladen.fakten),
        zeit_warnungen: warnungen.length > 0 ? warnungen : null,
        verarbeitung: 'idle',
        anweisung: null,
        fehler: null
      })

      return warnungen
    }

    /**
     * The learning half of the press review, endpoint-side: the same signals
     * the 09:00 operation gathers, for the re-inventory button — take/reject
     * decisions, municipality corrections and lead verdicts, all per paper.
     */
    async function ladeLernEintraege(
      schema: Awaited<ReturnType<typeof getSchema>>,
      blattId: string
    ): Promise<[LernEintrag[], GemeindeKorrektur[], FaehrtenUrteil[]]> {
      const kandidatenService = new ItemsService('wochenblattkandidaten', {
        schema
      })
      const meldungenService = new ItemsService('meldungen', { schema })
      const hinweiseService = new ItemsService('recherchehinweise', { schema })

      const kandidaten = (await kandidatenService.readByQuery({
        filter: {
          entscheid: { _neq: 'offen' },
          ausgabe: { wochenblatt: { _eq: blattId } }
        },
        sort: ['-date_updated'],
        fields: [
          'id',
          'titel',
          'typ',
          'entscheid',
          'ablehnungsgrund',
          'ablehnungskommentar',
          'perle_vorschlag'
        ],
        limit: 20
      })) as Array<{
        id: string
        titel: string
        typ: LernEintrag['typ']
        entscheid: LernEintrag['entscheid']
        ablehnungsgrund: LernEintrag['ablehnungsgrund']
        ablehnungskommentar: string | null
        perle_vorschlag: boolean
      }>

      const korrigierte = (await kandidatenService.readByQuery({
        filter: {
          gemeinde_korrigiert: { _eq: true },
          ausgabe: { wochenblatt: { _eq: blattId } }
        },
        sort: ['-date_updated'],
        fields: ['titel', 'gemeinde.name'],
        limit: 20
      })) as Array<{ titel: string; gemeinde: { name: string } | null }>
      const korrekturen: GemeindeKorrektur[] = korrigierte
        .filter((k) => k.gemeinde !== null)
        .map((k) => ({
          titel: k.titel,
          gemeinde: (k.gemeinde as { name: string }).name
        }))

      const beurteilte = (await hinweiseService.readByQuery({
        filter: {
          status: { _neq: 'offen' },
          ausgabe: { wochenblatt: { _eq: blattId } }
        },
        sort: ['-date_updated'],
        fields: ['titel', 'status', 'kommentar'],
        limit: 20
      })) as Array<{ titel: string; status: string; kommentar: string | null }>
      const faehrten: FaehrtenUrteil[] = beurteilte.map((f) => ({
        titel: f.titel,
        brauchbar: f.status === 'brauchbar',
        kommentar: f.kommentar
      }))

      let eintraege: LernEintrag[] = []
      if (kandidaten.length > 0) {
        const meldungen = (await meldungenService.readByQuery({
          filter: { kandidat: { _in: kandidaten.map((k) => k.id) } },
          fields: ['kandidat', 'status', 'perle'],
          limit: -1
        })) as Array<{
          kandidat: string
          status: string
          perle: boolean | null
        }>
        const nachKandidat = new Map(meldungen.map((m) => [m.kandidat, m]))

        eintraege = kandidaten.map((k) => {
          const meldung = nachKandidat.get(k.id)
          return {
            titel: k.titel,
            typ: k.typ,
            entscheid: k.entscheid,
            ablehnungsgrund: k.ablehnungsgrund,
            ablehnungskommentar: k.ablehnungskommentar,
            perleVorschlag: k.perle_vorschlag,
            perleBestaetigt:
              meldung !== undefined && meldung.status === 'publiziert'
                ? meldung.perle === true
                : null
          }
        })
      }

      return [eintraege, korrekturen, faehrten]
    }

    async function ueberarbeiteSpielbericht(
      meldung: {
        id: string
        titel: string | null
        lead: string | null
        text: string | null
      },
      spielId: string,
      anweisung: string
    ): Promise<string[]> {
      const schema = await getSchema()
      const spiele = new ItemsService('spiele', { schema })
      const meldungen = new ItemsService('meldungen', { schema })

      const spiel = (await spiele.readOne(spielId, {
        fields: [
          'id',
          'datum',
          'heim',
          'gast',
          'tore_heim',
          'tore_gast',
          'wettbewerb',
          'ort',
          'gemeinde.name',
          'verein.id',
          'verein.name',
          'verein.liga',
          'verein.notiz'
        ]
      })) as {
        id: string
        datum: string
        heim: string
        gast: string
        tore_heim: number | null
        tore_gast: number | null
        wettbewerb: string
        ort: string | null
        gemeinde: { name: string }
        verein: {
          id: string
          name: string
          liga: string | null
          notiz: string | null
        }
      }

      if (spiel.tore_heim === null || spiel.tore_gast === null) {
        throw new NichtsZuTun()
      }

      const frueherRoh = (await spiele.readByQuery({
        filter: {
          verein: { _eq: spiel.verein.id },
          tore_heim: { _nnull: true },
          datum: { _lt: spiel.datum }
        },
        fields: ['datum', 'heim', 'gast', 'tore_heim', 'tore_gast'],
        sort: ['-datum'],
        limit: 5
      })) as Array<{
        datum: string
        heim: string
        gast: string
        tore_heim: number
        tore_gast: number
      }>

      const fakten = {
        heim: spiel.heim,
        gast: spiel.gast,
        toreHeim: spiel.tore_heim,
        toreGast: spiel.tore_gast,
        wettbewerb: spiel.wettbewerb,
        datum: spiel.datum,
        ort: spiel.ort,
        verein: spiel.verein.name,
        gemeinde: spiel.gemeinde.name,
        liga: spiel.verein.liga,
        notiz: spiel.verein.notiz,
        frueher: frueherRoh.map((f) => ({
          datum: f.datum,
          heim: f.heim,
          gast: f.gast,
          toreHeim: f.tore_heim,
          toreGast: f.tore_gast
        }))
      }

      const antwort = await completeJson<unknown>({
        system: SPIELBERICHT_SYSTEM_PROMPT,
        prompt: buildSpielberichtRevision(fakten, meldung, anweisung),
        maxTokens: 1200
      })
      const bericht = parseSpielbericht(antwort)

      const alles = `${bericht.titel} ${bericht.lead} ${bericht.text}`
      const hinweise = [
        ...zeitWarnungen(alles),
        ...zahlWarnungen(alles, fakten)
      ]

      await meldungen.updateOne(meldung.id, {
        titel: bericht.titel,
        lead: bericht.lead,
        text: bericht.text,
        zeit_warnungen: hinweise.length > 0 ? hinweise : null,
        verarbeitung: 'idle',
        anweisung: null,
        fehler: null
      })

      return hinweise
    }

    /** The Termin fields a reading of the calendar writes. */
    function terminFelder(termin: ExtrahierterTermin): Record<string, unknown> {
      return {
        kategorie: termin.kategorie,
        zone: termin.zone,
        datum: termin.datum,
        bereitstellung: termin.bereitstellung,
        anmeldung: termin.anmeldung,
        anmeldeschluss: termin.anmeldeschluss,
        anmeldeschluss_zeit: termin.anmeldeschluss_zeit,
        warnung: wochentagWarnung(termin)
      }
    }

    /**
     * Fetches a PDF the editor pasted the address of.
     *
     * Only ever an address a person typed — the same rule as `shared/statbl`.
     * Nothing on a municipal website is discovered, followed or crawled; 87
     * municipalities means 87 unrelated websites, and guessing at them is how a
     * newsroom tool turns into a nuisance.
     */
    async function ladePdfVonUrl(url: string): Promise<Buffer> {
      let antwort: Awaited<ReturnType<typeof fetch>>
      try {
        antwort = await fetch(url, {
          headers: {
            'User-Agent': `Die Redaktion (${optionalEnv('AGENDA_KONTAKT', 'it@bajour.ch')})`
          },
          signal: AbortSignal.timeout(30_000)
        })
      } catch {
        throw new PdfNichtLadbar()
      }

      if (!antwort.ok) throw new PdfNichtLadbar()

      const art = antwort.headers.get('content-type') ?? ''
      if (!art.includes('pdf') && !art.includes('octet-stream')) {
        throw new PdfNichtLadbar()
      }

      const inhalt = Buffer.from(await antwort.arrayBuffer())
      if (inhalt.length === 0) throw new PdfNichtLadbar()
      if (inhalt.length > PDF_MAX_BYTES) throw new PdfZuGross()
      return inhalt
    }

    function dekodierePdf(base64: string): Buffer {
      const roh = base64.includes(',')
        ? base64.slice(base64.indexOf(',') + 1)
        : base64
      const inhalt = Buffer.from(roh, 'base64')
      if (inhalt.length === 0) throw new KeinePdf()
      if (inhalt.length > PDF_MAX_BYTES) throw new PdfZuGross()
      // A PDF starts with %PDF- — cheaper than trusting the browser's MIME guess.
      if (inhalt.subarray(0, 5).toString('latin1') !== '%PDF-') {
        throw new PdfNichtLadbar()
      }
      return inhalt
    }

    async function leseGemeindeName(
      schema: unknown,
      gemeinde: string
    ): Promise<string> {
      const gemeinden = new ItemsService('gemeinden', {
        schema: schema as never
      })
      const zeile = (await gemeinden.readOne(gemeinde, {
        fields: ['name']
      })) as { name: string }
      return zeile.name
    }

    /**
     * Puts the PDF into Directus Files — the only place this application may
     * keep a binary. Nothing is ever written to the filesystem.
     */
    async function legePdfAb(
      schema: unknown,
      req: ApiRequest,
      inhalt: Buffer,
      titel: string
    ): Promise<string> {
      const { FilesService } = services as unknown as {
        FilesService: new (optionen: unknown) => {
          uploadOne: (
            strom: unknown,
            daten: Record<string, unknown>
          ) => Promise<string>
        }
      }
      const files = new FilesService({
        schema,
        accountability: req.accountability
      })

      const { Readable } = await import('node:stream')
      return files.uploadOne(Readable.from(inhalt), {
        title: titel,
        filename_download: `${titel.replace(/[^\w. -]/g, '')}`,
        type: 'application/pdf',
        storage: 'local'
      })
    }

    async function lesePdf(schema: unknown, dateiId: string): Promise<Buffer> {
      const { AssetsService } = services as unknown as {
        AssetsService: new (optionen: unknown) => {
          getAsset: (
            id: string,
            transformation: unknown
          ) => Promise<{ stream: AsyncIterable<Uint8Array> }>
        }
      }
      const assets = new AssetsService({ schema })
      const { stream } = await assets.getAsset(dateiId, {
        transformationParams: {}
      })

      const teile: Uint8Array[] = []
      for await (const teil of stream) teile.push(teil)
      return Buffer.concat(teile)
    }

    /**
     * Writes one reminder, and holds it to the facts it was handed.
     *
     * The retry exists because the rule the model breaks most often here is the
     * one the newsletter depends on: writing "morgen" instead of the date. One
     * correction naming the offending word is enough in practice; whatever
     * survives it is stored as a flagged draft, never silently.
     */
    async function schreibeErinnerung(fakten: ErinnerungsFakten): Promise<{
      erinnerung: ReturnType<typeof parseErinnerung>
      warnungen: string[]
    }> {
      const schreibe = async (prompt: string) =>
        parseErinnerung(
          await completeChatJson<unknown>({
            system: ERINNERUNG_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: prompt }],
            // The budget carries thinking too, and 1200 was observed to be a
            // near-miss on a merged edition. The text itself stays short; the
            // headroom is for the thinking, not for longer prose.
            maxTokens: 2000
          })
        )

      let erinnerung = await schreibe(buildErinnerungPrompt(fakten))
      let alles = `${erinnerung.titel} ${erinnerung.lead} ${erinnerung.text}`
      let zeit = zeitPruefungErinnerung(alles, fakten.jahr)

      if (!zeit.bestanden) {
        const korrektur = erinnerungKorrekturHinweis(zeit, fakten.jahr)
        erinnerung = await schreibe(
          `${buildErinnerungPrompt(fakten)}\n\n${korrektur}`
        )
        alles = `${erinnerung.titel} ${erinnerung.lead} ${erinnerung.text}`
        zeit = zeitPruefungErinnerung(alles, fakten.jahr)
      }

      const warnungen = [
        ...zeit.hart.map((wort) => `Relativer Zeitbezug: "${wort}"`),
        ...(zeit.jahrFehlt
          ? [`Die Jahreszahl ${fakten.jahr} fehlt im Text.`]
          : []),
        ...zahlWarnungenErinnerung(alles, fakten)
      ]

      return { erinnerung, warnungen }
    }

    /**
     * A reminder whose facts no longer hold.
     *
     * An article is a cache of what it was written from, so a corrected date
     * makes it wrong rather than outdated. A draft is discarded and written
     * again; something already published is only flagged — un-publishing behind
     * an editor's back is not this system's call to make.
     */
    async function invalidiereErinnerung(
      schema: unknown,
      meldungId: string
    ): Promise<void> {
      const meldungen = new ItemsService('meldungen', {
        schema: schema as never
      })
      const termine = new ItemsService('entsorgungstermine', {
        schema: schema as never
      })

      try {
        const meldung = (await meldungen.readOne(meldungId, {
          fields: ['id', 'status']
        })) as { id: string; status: string }

        if (meldung.status === 'publiziert') {
          await meldungen.updateOne(meldungId, {
            fehler:
              'Ein Termin dieser Erinnerung wurde nachtraeglich geaendert. Bitte den publizierten Text pruefen.'
          })
          logger.warn(
            `redaktion: publizierte Erinnerung ${meldungId} beruht auf einem geaenderten Termin`
          )
          return
        }

        await meldungen.updateOne(meldungId, { status: 'verworfen' })

        // A merged reminder speaks for several dates; all of them lose their
        // link, or the next generation would think they were still covered.
        const geschwister = (await termine.readByQuery({
          filter: { meldung: { _eq: meldungId } },
          fields: ['id'],
          limit: -1
        })) as Array<{ id: string }>
        for (const termin of geschwister) {
          await termine.updateOne(termin.id, { meldung: null })
        }
      } catch (fehler) {
        logger.warn(
          fehler,
          `redaktion: Erinnerung ${meldungId} konnte nicht verworfen werden`
        )
      }
    }

    /**
     * Revising a reminder: the facts are read again from the Termine, never
     * from the article itself.
     */
    async function ueberarbeiteErinnerung(
      meldung: {
        id: string
        titel: string | null
        lead: string | null
        text: string | null
      },
      anweisung: string
    ): Promise<string[]> {
      const schema = await getSchema()
      const meldungen = new ItemsService('meldungen', { schema })
      const termineService = new ItemsService('entsorgungstermine', { schema })

      const meineTermine = (await termineService.readByQuery({
        filter: { meldung: { _eq: meldung.id } },
        fields: [
          'id',
          'kategorie',
          'zone',
          'datum',
          'bereitstellung',
          'anmeldung',
          'anmeldeschluss',
          'anmeldeschluss_zeit',
          'dokument.quelle_url',
          'dokument.zusatz',
          'kalender.id',
          'kalender.jahr',
          'kalender.gemeinde.name'
        ],
        sort: ['datum'],
        limit: -1
      })) as Array<
        PlanTermin & {
          dokument: { quelle_url: string | null; zusatz: string | null } | null
          kalender: {
            id: string
            jahr: number
            gemeinde: { name: string }
          }
        }
      >

      const erste = meineTermine[0]
      if (erste === undefined) {
        throw new Error('Zu dieser Erinnerung gibt es keine Termine mehr.')
      }

      // The cross-zone reference is looked up against the whole calendar, not
      // just this reminder's dates.
      const alle = (await termineService.readByQuery({
        filter: {
          kalender: { _eq: erste.kalender.id },
          geprueft: { _eq: true }
        },
        fields: [
          'id',
          'kategorie',
          'zone',
          'datum',
          'bereitstellung',
          'anmeldung',
          'anmeldeschluss',
          'anmeldeschluss_zeit'
        ],
        sort: ['datum'],
        limit: -1
      })) as PlanTermin[]

      const meldungZeile = (await meldungen.readOne(meldung.id, {
        fields: ['erscheint_am']
      })) as { erscheint_am: string }

      const fakten = baueFakten(
        {
          erscheintAm: meldungZeile.erscheint_am,
          termine: meineTermine.map((termin) => ({
            id: termin.id,
            kategorie: termin.kategorie,
            zone: termin.zone,
            datum: termin.datum,
            bereitstellung: termin.bereitstellung,
            anmeldung: termin.anmeldung,
            anmeldeschluss: termin.anmeldeschluss,
            anmeldeschluss_zeit: termin.anmeldeschluss_zeit,
            quelle_url: termin.dokument?.quelle_url ?? null,
            zusatz: termin.dokument?.zusatz ?? null
          }))
        },
        alle,
        erste.kalender.gemeinde.name,
        erste.kalender.jahr
      )

      const antwort = await completeChatJson<unknown>({
        system: ERINNERUNG_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: buildErinnerungRevision(fakten, meldung, anweisung)
          }
        ],
        maxTokens: 2000
      })
      const erinnerung = parseErinnerung(antwort)

      const alles = `${erinnerung.titel} ${erinnerung.lead} ${erinnerung.text}`
      const zeit = zeitPruefungErinnerung(alles, fakten.jahr)
      const hinweise = [
        ...zeit.hart.map((wort) => `Relativer Zeitbezug: "${wort}"`),
        ...(zeit.jahrFehlt
          ? [`Die Jahreszahl ${fakten.jahr} fehlt im Text.`]
          : []),
        ...zahlWarnungenErinnerung(alles, fakten)
      ]

      await meldungen.updateOne(meldung.id, {
        titel: erinnerung.titel,
        lead: erinnerung.lead,
        text: erinnerung.text,
        zeit_warnungen: hinweise.length > 0 ? hinweise : null,
        verarbeitung: 'idle',
        anweisung: null,
        fehler: null
      })

      return hinweise
    }

    /**
     * The sport twin of `merkeWissen` below: same classification, but a match
     * report has no dataset and its sources are not rows in `quellen` — so a
     * rule that survives is stored globally, never scoped to a dataset that
     * does not exist.
     */
    function merkeWissenSport(anweisung: string, meldungId: string): void {
      void (async () => {
        try {
          const schema = await getSchema()
          const antwort = await completeJson<unknown>({
            system: WISSEN_SYSTEM_PROMPT,
            prompt: buildWissenPrompt(
              anweisung,
              'Spielbericht (Sportresultate)'
            ),
            maxTokens: 600,
            thinking: 'disabled',
            effort: 'low',
            schema: WISSEN_SCHEMA
          })
          const urteil = parseWissen(antwort)
          const felder = wissenFelder(
            {
              ...urteil,
              geltungsbereich: urteil.dauerhaft
                ? 'global'
                : urteil.geltungsbereich
            },
            { datensatzId: '', quelleId: null }
          )
          if (felder === null) return

          await new ItemsService('redaktionswissen', { schema }).createOne(
            felder
          )
          logger.info(
            `redaktion: neue Regel gemerkt (Sport) — ${String(felder['regel'])}`
          )
        } catch (fehler) {
          logger.warn(
            fehler,
            `redaktion: Sport-Anweisung zu Meldung ${meldungId} konnte nicht bewertet werden`
          )
        }
      })()
    }

    /**
     * Asks whether the instruction is a durable rule and stores it if so.
     *
     * Fire-and-forget on purpose: the editor should not wait on it, and a failure
     * here costs a remembered preference, not the revision itself.
     */
    async function merkeWissen(
      anweisung: string,
      datensatzId: string
    ): Promise<void> {
      try {
        const schema = await getSchema()
        const datensaetze = new ItemsService('datensaetze', { schema })
        const datensatz = (await datensaetze.readOne(datensatzId, {
          fields: ['id', 'titel', 'quelle']
        })) as Pick<Datensatz, 'id' | 'titel' | 'quelle'>

        const antwort = await completeJson<unknown>({
          system: WISSEN_SYSTEM_PROMPT,
          prompt: buildWissenPrompt(anweisung, datensatz.titel),
          maxTokens: 600,
          thinking: 'disabled',
          effort: 'low',
          schema: WISSEN_SCHEMA
        })

        const felder = wissenFelder(parseWissen(antwort), {
          datensatzId: datensatz.id,
          quelleId: datensatz.quelle
        })
        if (felder === null) return

        await new ItemsService('redaktionswissen', { schema }).createOne(felder)
        logger.info(
          `redaktion: neue Regel gemerkt — ${String(felder['regel'])}`
        )
      } catch (error) {
        logger.warn(error, 'redaktion: Anweisung konnte nicht bewertet werden')
      }
    }
  }
)

function zielStatus(
  aktion: unknown
): 'publiziert' | 'in_pruefung' | 'freigegeben' | 'verworfen' {
  switch (aktion) {
    case 'publizieren':
      return 'publiziert'
    case 'pruefung':
      return 'in_pruefung'
    // Approving without publishing: a waste-collection reminder is finished
    // weeks before its newsletter day, and the scheduled publisher takes it
    // from `freigegeben` on the eve of that day.
    case 'freigeben':
      return 'freigegeben'
    default:
      return 'verworfen'
  }
}

/**
 * Turns a service error into the right answer.
 *
 * `readOne` never returns null — it throws Forbidden for an item that is
 * missing *or* not readable, and for a malformed key. That ambiguity is
 * deliberate: two different answers would let a caller probe which ids exist.
 * Everything else keeps its own status, so the hook's 422 with its German
 * explanation reaches the browser intact.
 */
function uebersetze(error: unknown): unknown {
  const status = (error as { status?: unknown }).status
  if (status === 403 || status === 404) return new NichtGefunden()
  return error
}
