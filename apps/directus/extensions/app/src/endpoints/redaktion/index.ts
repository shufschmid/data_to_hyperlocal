import { createError } from '@directus/errors'
import { defineEndpoint } from '@directus/extensions-sdk'
import type { NextFunction, Response } from 'express'
import { completeJson } from '../../shared/claude'
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

const UUID = /^[0-9a-f-]{36}$/i

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
            fields: ['id', 'spiel', 'titel', 'lead', 'text']
          })) as {
            id: string
            spiel: string | null
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
      '/meldungen/:id/:aktion(publizieren|pruefung|verwerfen)',
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

          await meldungen.updateOne(id, { status: ziel })

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
): 'publiziert' | 'in_pruefung' | 'verworfen' {
  switch (aktion) {
    case 'publizieren':
      return 'publiziert'
    case 'pruefung':
      return 'in_pruefung'
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
