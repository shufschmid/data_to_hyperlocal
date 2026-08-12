import type { Knex } from 'knex'
import {
  cacheableSystem,
  completeJson,
  DEFAULT_MODEL,
  type MessageSender
} from '../shared/claude'
import { exportRecords, type OdsRecord } from '../shared/ods'
import { buildWhereClause } from '../shared/ods/query'
import {
  detectMunicipalityFields,
  detectPeriodField
} from '../shared/ods/parse'
import {
  hasUsableCoverage,
  describeCoverage,
  latestPeriod,
  matchMunicipalities
} from './gemeinden'
import { JAHR_SPALTE, ladeReihe, ladeTabelle } from '../shared/statbl'
import type { OdsField } from '../shared/ods'
import type { Zeitreihe } from './kontext'
import {
  beschreibeEinordnung,
  beschreibeKanton,
  beschreibeKantonZeitreihe,
  beschreibeZeitreihen,
  datengrundlage,
  verdichteZeilen,
  zeitreihen
} from './kontext'
import {
  ARTIKEL_SCHEMA,
  artikelFelder,
  buildArtikelSystemPrompt,
  buildArtikelUserPrompt,
  buildBriefingPrompt,
  BRIEFING_SCHEMA,
  BRIEFING_SYSTEM_PROMPT,
  parseArtikel,
  parseBriefing,
  type Briefing
} from './prompt'
import {
  budgetErschoepft,
  offeneLaeufe,
  darfWiederholen,
  fehlerText,
  istVoruebergehend,
  laufStatusNachDurchlauf,
  leaseBis,
  LEASE_MS
} from './queue'
import { korrekturHinweis, pruefeZeitbezug } from './zeitbezug'
import {
  erlaubteProzentangaben,
  unbelegteProzentangaben,
  zahlenKorrekturHinweis
} from './zahlen'
import type {
  Datensatz,
  Gemeinde,
  Lauf,
  Meldung,
  Quelle,
  Redaktionswissen
} from '../types/schema'

// The worker: turns runs into briefings, and briefings into articles.
//
// Called from two places on purpose — the Flow operation (scheduled, the safety
// net that recovers stalled work) and the endpoint (immediately, so the editor
// sees progress in seconds rather than at the next tick). Both enter here, so
// the single-flight guard below covers both.

/** Model for the briefing: one call per run, and the only genuinely hard thinking. */
export const BRIEFING_MODELL = 'claude-opus-5'

export interface DrainErgebnis {
  laeufe: number
  meldungen: number
  fehler: string[]
  /** True when work remains — the caller can decide whether to come straight back. */
  offen: boolean
}

export interface DrainKontext {
  database: Knex
  services: {
    ItemsService: new (collection: string, options: unknown) => ItemsServiceLike
  }
  schema: unknown
  logger: {
    info: (m: string) => void
    warn: (e: unknown, m?: string) => void
    error: (e: unknown, m?: string) => void
  }
  /** Test seam, exactly as in shared/claude.ts. */
  send?: MessageSender
  jetzt?: () => Date
}

interface ItemsServiceLike {
  readByQuery(query: Record<string, unknown>): Promise<unknown[]>
  readOne(key: string, query?: Record<string, unknown>): Promise<unknown>
  createOne(payload: Record<string, unknown>): Promise<string>
  updateOne(key: string, payload: Record<string, unknown>): Promise<string>
}

export interface DrainOptionen {
  /** Runs to brief per pass. Each is one Opus call plus one data fetch. */
  laeufe?: number
  /** Articles to write per pass. Each is one Sonnet call. */
  meldungen?: number
  /**
   * Model for the briefing. Defaults to Opus — the one call per run that is
   * worth it. Worth overriding when Opus is capacity-constrained: an overloaded
   * model blocks the whole run, and a Sonnet briefing beats no briefing.
   */
  briefingModell?: string
  budgetMs?: number
}

// One drain at a time inside this process. Both entry points import this
// module, so a scheduled tick landing on top of an endpoint-triggered pass
// waits rather than doubling the work. Process state, not a file — constraint 5
// is untouched.
let laufend: Promise<DrainErgebnis> | null = null

export function drain(
  kontext: DrainKontext,
  optionen: DrainOptionen = {}
): Promise<DrainErgebnis> {
  if (laufend !== null) return laufend

  laufend = fuehreDrainAus(kontext, optionen).finally(() => {
    laufend = null
  })

  return laufend
}

async function fuehreDrainAus(
  kontext: DrainKontext,
  optionen: DrainOptionen
): Promise<DrainErgebnis> {
  const jetzt = kontext.jetzt ?? (() => new Date())
  const start = jetzt().getTime()
  const budgetMs = optionen.budgetMs
  const ergebnis: DrainErgebnis = {
    laeufe: 0,
    meldungen: 0,
    fehler: [],
    offen: false
  }

  await verarbeiteLaeufe(
    kontext,
    optionen.laeufe ?? 1,
    ergebnis,
    jetzt,
    start,
    budgetMs,
    optionen.briefingModell ?? BRIEFING_MODELL
  )
  await verarbeiteMeldungen(
    kontext,
    optionen.meldungen ?? 5,
    ergebnis,
    jetzt,
    start,
    budgetMs
  )

  return ergebnis
}

// --- claiming ----------------------------------------------------------------

/**
 * Claims rows atomically.
 *
 * This is the one place that goes to knex instead of ItemsService, and it has
 * to: `updateByQuery` reads and then writes, and two ticks landing in that gap
 * both think they won. `FOR UPDATE SKIP LOCKED` in the subquery is the
 * canonical Postgres queue claim — verified to be emitted by knex 3 rather than
 * silently dropped. Every *content* write still goes through ItemsService so
 * hooks, validation and date_updated all run.
 */
async function beanspruche<T>(
  database: Knex,
  tabelle: string,
  bedingung: (q: Knex.QueryBuilder) => Knex.QueryBuilder,
  spalten: string[],
  anzahl: number,
  jetzt: Date
): Promise<T[]> {
  if (anzahl < 1) return []

  const auswahl = bedingung(database(tabelle).select('id'))
    .orderBy('date_created')
    .limit(anzahl)
    .forUpdate()
    .skipLocked()

  const beansprucht = await database(tabelle)
    .update({
      gesperrt_bis: leaseBis(jetzt, LEASE_MS),
      versuche: database.raw('versuche + 1')
    })
    .whereIn('id', auswahl)
    .returning(spalten)

  return beansprucht as T[]
}

// --- stage A: the briefing ---------------------------------------------------

async function verarbeiteLaeufe(
  kontext: DrainKontext,
  anzahl: number,
  ergebnis: DrainErgebnis,
  jetzt: () => Date,
  start: number,
  budgetMs: number | undefined,
  briefingModell: string
): Promise<void> {
  const { database, services, schema, logger } = kontext
  const { ItemsService } = services

  const offene = await beanspruche<
    Pick<Lauf, 'id' | 'datensatz' | 'periode' | 'versuche' | 'vorgabe'>
  >(
    database,
    'laeufe',
    (q) =>
      q.where((w) =>
        w
          .where('status', 'geplant')
          .orWhere((r) =>
            r.where('status', 'briefing').andWhere('gesperrt_bis', '<', jetzt())
          )
      ),
    ['id', 'datensatz', 'periode', 'versuche', 'vorgabe'],
    anzahl,
    jetzt()
  )

  const laeufeService = new ItemsService('laeufe', { schema })

  for (const lauf of offene) {
    if (budgetErschoepft(start, jetzt().getTime(), budgetMs)) {
      ergebnis.offen = true
      return
    }

    await laeufeService.updateOne(lauf.id, { status: 'briefing' })

    try {
      await erstelleBriefing(kontext, lauf, briefingModell)
      ergebnis.laeufe += 1
      ergebnis.offen = true
    } catch (error) {
      const text = fehlerText(error)
      const voruebergehend = istVoruebergehend(error)

      if (voruebergehend) {
        // The work is fine, the API is busy. Give the attempt back so a quarter
        // hour of upstream trouble cannot strand a good run in `fehler`.
        logger.info(`drain: Lauf ${lauf.id} vertagt — ${text}`)
        await laeufeService.updateOne(lauf.id, {
          status: 'geplant',
          versuche: Math.max(lauf.versuche - 1, 0),
          fehler: `Vertagt: ${text}`,
          gesperrt_bis: null
        })
        ergebnis.offen = true
        continue
      }

      logger.error(error, `drain: Briefing fuer Lauf ${lauf.id} fehlgeschlagen`)
      ergebnis.fehler.push(`Lauf ${lauf.id}: ${text}`)

      await laeufeService.updateOne(lauf.id, {
        status: darfWiederholen(lauf.versuche) ? 'geplant' : 'fehler',
        fehler: text,
        gesperrt_bis: null
      })
    }
  }
}

async function erstelleBriefing(
  kontext: DrainKontext,
  lauf: Pick<Lauf, 'id' | 'datensatz' | 'periode' | 'vorgabe'>,
  briefingModell: string
): Promise<void> {
  const { services, schema, logger } = kontext
  const { ItemsService } = services

  const datensaetze = new ItemsService('datensaetze', { schema })
  const quellen = new ItemsService('quellen', { schema })
  const gemeindenService = new ItemsService('gemeinden', { schema })
  const meldungen = new ItemsService('meldungen', { schema })
  const laeufeService = new ItemsService('laeufe', { schema })

  const datensatz = (await datensaetze.readOne(lauf.datensatz, {
    fields: [
      'id',
      'quelle',
      'externe_id',
      'titel',
      'beschreibung',
      'felder',
      'gemeindefeld'
    ]
  })) as Pick<
    Datensatz,
    | 'id'
    | 'quelle'
    | 'externe_id'
    | 'titel'
    | 'beschreibung'
    | 'felder'
    | 'gemeindefeld'
  >

  const felder = datensatz.felder ?? []
  const gemeindeFelder = detectMunicipalityFields(
    felder,
    datensatz.gemeindefeld
  )
  if (gemeindeFelder === null) {
    throw new Error(
      'Datensatz hat keine erkennbare Gemeindespalte. Im Reiter "Angekuendigt" die Spalte von Hand waehlen.'
    )
  }

  const quelle = (await quellen.readOne(datensatz.quelle ?? '', {
    fields: ['id', 'basis_url', 'typ']
  })) as Pick<Quelle, 'id' | 'basis_url' | 'typ'>

  // A table's year is a text column, which `detectPeriodField` deliberately
  // does not accept — it only trusts columns the portal types as dates. For a
  // table the adapter guarantees the name instead.
  const periodenFeld =
    quelle.typ === 'statbl' ? JAHR_SPALTE : detectPeriodField(felder)

  const material = await holeZeilen(
    quelle,
    datensatz,
    felder,
    lauf.periode,
    periodenFeld,
    hatVorgabe(lauf.vorgabe)
  )
  const zeilen = material.zeilen
  const verlaufZeilen = material.verlauf

  if (zeilen.length === 0) {
    throw new Error(`Keine Zeilen fuer Periode ${lauf.periode}.`)
  }
  for (const hinweis of material.hinweise) {
    logger.info(`drain: Lauf ${lauf.id} — ${hinweis}`)
  }

  const aktive = (await gemeindenService.readByQuery({
    filter: { aktiv: { _eq: true } },
    fields: ['id', 'bfs_nummer', 'name', 'bezirk'],
    sort: ['name'],
    limit: -1
  })) as Gemeinde[]

  if (aktive.length === 0) {
    throw new Error(
      'Keine aktive Gemeinde — im Adminbereich unter "Gemeinden" freischalten.'
    )
  }

  const abdeckung = matchMunicipalities(zeilen, aktive, gemeindeFelder.bfsField)
  if (!hasUsableCoverage(abdeckung)) {
    throw new Error(
      `Keine der aktiven Gemeinden hat Daten in dieser Periode. ${describeCoverage(abdeckung)}`
    )
  }

  logger.info(`drain: Lauf ${lauf.id} — ${describeCoverage(abdeckung)}`)

  const regeln = await ladeRegeln(kontext, datensatz.id, datensatz.quelle)
  const frueher = await ladeFruehereLaeufe(kontext, datensatz.id, lauf.id)

  const antwort = await completeJson<unknown>(
    {
      system: BRIEFING_SYSTEM_PROMPT,
      prompt: buildBriefingPrompt({
        datensatzTitel: datensatz.titel,
        datensatzBeschreibung: datensatz.beschreibung,
        periode: lauf.periode,
        kantonszahlen: beschreibeKanton(zeilen),
        kantonsverlauf:
          verlaufZeilen.length === 0 || periodenFeld === null
            ? null
            : beschreibeKantonZeitreihe(verlaufZeilen, periodenFeld),
        vorgabe: lauf.vorgabe,
        regeln,
        frueher
      }),
      model: briefingModell,
      maxTokens: 4000,
      thinking: 'adaptive',
      effort: 'high',
      schema: BRIEFING_SCHEMA
    },
    kontext.send
  )

  const briefing = parseBriefing(antwort)

  // One article per municipality that actually has data. Municipalities without
  // rows get nothing at all — an empty draft is how a model ends up inventing
  // numbers to fill it.
  const verlaufAbdeckung =
    verlaufZeilen.length === 0
      ? null
      : matchMunicipalities(verlaufZeilen, aktive, gemeindeFelder.bfsField)

  for (const treffer of abdeckung.matched) {
    const eigenerVerlauf =
      verlaufAbdeckung === null || periodenFeld === null
        ? null
        : (verlaufAbdeckung.matched.find(
            (m) => m.gemeinde.id === treffer.gemeinde.id
          )?.rows ?? null)

    await meldungen.createOne({
      lauf: lauf.id,
      gemeinde: treffer.gemeinde.id,
      status: 'entwurf',
      verarbeitung: 'geplant',
      datengrundlage: {
        ...datengrundlage(treffer.rows, lauf.periode),
        // Stored, not recomputed later: the article has to be checkable against
        // the exact series it was written from, and the portal moves.
        ...(eigenerVerlauf === null || periodenFeld === null
          ? {}
          : { verlauf: zeitreihen(eigenerVerlauf, periodenFeld) })
      }
    })
  }

  await laeufeService.updateOne(lauf.id, {
    status: 'schreibt',
    briefing: JSON.stringify(briefing),
    kontext: {
      kantonszahlen: beschreibeKanton(zeilen),
      zeilen_gesamt: zeilen.length,
      abdeckung: describeCoverage(abdeckung),
      alle_zeilen: zeilen.slice(0, 400)
    },
    fehler: null,
    gesperrt_bis: null
  })
}

/**
 * The rows for a run, from whichever source the dataset belongs to.
 *
 * Both adapters hand back the same shape, so everything downstream — the
 * figures, the coverage check, the time series — has one code path. What
 * differs is only how much comes back in one go: the portal is queried per
 * period, a portal table is one page per year and arrives whole.
 */
async function holeZeilen(
  quelle: Pick<Quelle, 'basis_url' | 'typ'>,
  datensatz: Pick<Datensatz, 'externe_id'>,
  felder: readonly OdsField[],
  periode: string,
  periodenFeld: string | null,
  mitVerlauf: boolean
): Promise<{ zeilen: OdsRecord[]; verlauf: OdsRecord[]; hinweise: string[] }> {
  if (quelle.typ === 'statbl') {
    // One page per year, so the history is already paid for by the time the
    // current slice is in hand — no second request, and no reason to make the
    // history conditional here.
    const reihe = await ladeReihe(datensatz.externe_id)
    const alle = reihe.zeilen as OdsRecord[]
    const feld = periodenFeld ?? JAHR_SPALTE

    return {
      zeilen: alle.filter((zeile) => String(zeile[feld] ?? '') === periode),
      verlauf: mitVerlauf ? alle : [],
      hinweise:
        reihe.uebersprungen.length === 0
          ? []
          : [`Nicht gelesene Jahrgaenge: ${reihe.uebersprungen.join('; ')}`]
    }
  }

  // One export instead of paged records: a period slice is a few hundred
  // kilobytes and the paging ceiling is 10 000 rows.
  const periodenTyp =
    felder.find((f) => f.name === periodenFeld)?.type ?? 'text'
  const where =
    periodenFeld === null
      ? undefined
      : buildWhereClause(periodenFeld, periodenTyp, periode)

  const zeilen = await exportRecords(quelle.basis_url, datensatz.externe_id, {
    where
  })

  // The earlier periods, fetched only when the run carries an instruction.
  //
  // "Compare with ten years ago" is unanswerable from a single period slice,
  // and a model handed that instruction without the rows will either refuse or
  // invent the earlier figure. Fetching it always would double every export for
  // runs that never look back, so it follows the instruction.
  const verlauf =
    periodenFeld === null || !mitVerlauf
      ? []
      : await exportRecords(quelle.basis_url, datensatz.externe_id, {})

  return { zeilen, verlauf, hinweise: [] }
}

/** An instruction that is only whitespace is no instruction. */
function hatVorgabe(vorgabe: string | null | undefined): boolean {
  return typeof vorgabe === 'string' && vorgabe.trim() !== ''
}

// --- stage B: the articles ---------------------------------------------------

async function verarbeiteMeldungen(
  kontext: DrainKontext,
  anzahl: number,
  ergebnis: DrainErgebnis,
  jetzt: () => Date,
  start: number,
  budgetMs?: number
): Promise<void> {
  const { database, services, schema, logger } = kontext
  const { ItemsService } = services
  const meldungenService = new ItemsService('meldungen', { schema })

  const offene = await beanspruche<
    Pick<
      Meldung,
      'id' | 'lauf' | 'gemeinde' | 'anweisung' | 'versuche' | 'datengrundlage'
    >
  >(
    database,
    'meldungen',
    (q) =>
      q.where((w) =>
        w
          .where('verarbeitung', 'geplant')
          .orWhere((r) =>
            r
              .where('verarbeitung', 'laeuft')
              .andWhere('gesperrt_bis', '<', jetzt())
          )
      ),
    ['id', 'lauf', 'gemeinde', 'anweisung', 'versuche', 'datengrundlage'],
    anzahl,
    jetzt()
  )

  // Cache the per-run material: N articles of one run share it, and re-reading
  // it per article would be N pointless round trips.
  const laufCache = new Map<string, LaufMaterial>()

  for (const meldung of offene) {
    if (budgetErschoepft(start, jetzt().getTime(), budgetMs)) {
      ergebnis.offen = true
      break
    }

    await meldungenService.updateOne(meldung.id, { verarbeitung: 'laeuft' })

    try {
      const material =
        laufCache.get(meldung.lauf) ??
        (await ladeLaufMaterial(kontext, meldung.lauf))
      laufCache.set(meldung.lauf, material)

      await schreibeMeldung(kontext, meldung, material)

      await meldungenService.updateOne(meldung.id, {
        verarbeitung: 'idle',
        anweisung: null,
        fehler: null,
        gesperrt_bis: null
      })
      ergebnis.meldungen += 1
    } catch (error) {
      const text = fehlerText(error)

      if (istVoruebergehend(error)) {
        logger.info(`drain: Meldung ${meldung.id} vertagt — ${text}`)
        await meldungenService.updateOne(meldung.id, {
          verarbeitung: 'geplant',
          versuche: Math.max(meldung.versuche - 1, 0),
          fehler: `Vertagt: ${text}`,
          gesperrt_bis: null
        })
        ergebnis.offen = true
        continue
      }

      logger.error(error, `drain: Meldung ${meldung.id} fehlgeschlagen`)
      ergebnis.fehler.push(`Meldung ${meldung.id}: ${text}`)

      await meldungenService.updateOne(meldung.id, {
        verarbeitung: darfWiederholen(meldung.versuche) ? 'geplant' : 'fehler',
        fehler: text,
        gesperrt_bis: null
      })
    }
  }

  await schliesseLaeufeAb(kontext, [...laufCache.keys()], ergebnis)
}

interface LaufMaterial {
  briefing: Briefing
  periode: string
  datensatzId: string
  /** Built once per run — this exact string is what the prompt cache carries. */
  systemPrompt: string
  alleZeilen: OdsRecord[]
}

async function ladeLaufMaterial(
  kontext: DrainKontext,
  laufId: string
): Promise<LaufMaterial> {
  const { services, schema } = kontext
  const { ItemsService } = services

  const lauf = (await new ItemsService('laeufe', { schema }).readOne(laufId, {
    fields: ['id', 'datensatz', 'periode', 'briefing', 'kontext', 'vorgabe']
  })) as Pick<
    Lauf,
    'id' | 'datensatz' | 'periode' | 'briefing' | 'kontext' | 'vorgabe'
  >

  if (lauf.briefing === null) {
    throw new Error('Lauf hat noch kein Briefing.')
  }

  const briefing = parseBriefing(JSON.parse(lauf.briefing))
  const regeln = await ladeRegeln(kontext, lauf.datensatz, null)
  const kontextDaten = (lauf.kontext ?? {}) as { alle_zeilen?: unknown }

  return {
    briefing,
    periode: lauf.periode,
    datensatzId: lauf.datensatz,
    systemPrompt: buildArtikelSystemPrompt(briefing, regeln, lauf.vorgabe),
    alleZeilen: Array.isArray(kontextDaten.alle_zeilen)
      ? (kontextDaten.alle_zeilen as OdsRecord[])
      : []
  }
}

async function schreibeMeldung(
  kontext: DrainKontext,
  meldung: Pick<Meldung, 'id' | 'gemeinde' | 'anweisung' | 'datengrundlage'>,
  material: LaufMaterial
): Promise<void> {
  const { services, schema, logger } = kontext
  const { ItemsService } = services

  const gemeinde = (await new ItemsService('gemeinden', { schema }).readOne(
    meldung.gemeinde,
    { fields: ['id', 'name', 'bezirk'] }
  )) as Pick<Gemeinde, 'id' | 'name' | 'bezirk'>

  const grundlage = (meldung.datengrundlage ?? {}) as {
    zeilen?: unknown
    verlauf?: unknown
  }
  const eigeneZeilen = Array.isArray(grundlage.zeilen)
    ? (grundlage.zeilen as OdsRecord[])
    : []
  const verlauf = Array.isArray(grundlage.verlauf)
    ? beschreibeZeitreihen(grundlage.verlauf as Zeitreihe[])
    : null

  const frueherText = await ladeFruehereMeldung(
    kontext,
    material.datensatzId,
    meldung.gemeinde,
    meldung.id
  )

  const eingabe = {
    gemeinde: gemeinde.name,
    bezirk: gemeinde.bezirk,
    zahlen: verdichteZeilen(eigeneZeilen),
    einordnung: beschreibeEinordnung(eigeneZeilen, material.alleZeilen),
    verlauf,
    frueherText,
    ...(meldung.anweisung === null ? {} : { korrektur: meldung.anweisung })
  }

  // The system half is byte-identical across every article of this run, so the
  // cache carries it; only the user turn varies. Never move anything
  // municipality-specific into `system`.
  const system = cacheableSystem(material.systemPrompt)

  let artikel = parseArtikel(
    await completeJson<unknown>(
      {
        system,
        prompt: buildArtikelUserPrompt(eingabe),
        model: DEFAULT_MODEL,
        maxTokens: 2000,
        thinking: 'disabled',
        effort: 'low',
        schema: ARTIKEL_SCHEMA
      },
      kontext.send
    )
  )

  const erlaubteProzente = erlaubteProzentangaben(eingabe.einordnung)

  const pruefeAlles = (
    a: typeof artikel
  ): {
    zeit: ReturnType<typeof pruefeZeitbezug>
    unbelegt: number[]
    bestanden: boolean
  } => {
    const ganzerText = `${a.titel} ${a.lead} ${a.text}`
    const zeit = pruefeZeitbezug(ganzerText, material.briefing.jahr)
    const unbelegt = unbelegteProzentangaben(ganzerText, erlaubteProzente)
    return {
      zeit,
      unbelegt,
      bestanden: zeit.bestanden && unbelegt.length === 0
    }
  }

  let pruefung = pruefeAlles(artikel)

  // One retry, naming what was wrong. Repeating the rule verbatim would change
  // nothing — the model already had it and broke it. Both complaints go in the
  // same correction so a second failure is not spent on the other half.
  if (!pruefung.bestanden) {
    logger.info(
      `drain: ${gemeinde.name} — beanstandet, ein Nachversuch` +
        (pruefung.unbelegt.length > 0
          ? ` (Prozentangaben: ${pruefung.unbelegt.join(', ')})`
          : '')
    )

    const korrektur = [
      korrekturHinweis(pruefung.zeit, material.briefing.jahr),
      zahlenKorrekturHinweis(pruefung.unbelegt)
    ]
      .filter((teil) => teil !== '')
      .join(' ')

    artikel = parseArtikel(
      await completeJson<unknown>(
        {
          system,
          prompt: buildArtikelUserPrompt({ ...eingabe, korrektur }),
          model: DEFAULT_MODEL,
          maxTokens: 2000,
          thinking: 'disabled',
          effort: 'low',
          schema: ARTIKEL_SCHEMA
        },
        kontext.send
      )
    )

    pruefung = pruefeAlles(artikel)
  }

  // Still not clean: store it as a draft with the complaints attached and let a
  // human decide. Never silently publish, never silently drop. An unsupported
  // percentage is spelled out as such, because "68 Prozent" on its own in a
  // warning list would mean nothing to the person reading it.
  const warnungen = [
    ...(pruefung.zeit.bestanden
      ? pruefung.zeit.weich
      : [...pruefung.zeit.hart, ...pruefung.zeit.weich]),
    ...pruefung.unbelegt.map((z) => `ungepruefte Prozentangabe: ${z}%`)
  ]

  await new ItemsService('meldungen', { schema }).updateOne(
    meldung.id,
    artikelFelder(artikel, warnungen)
  )
}

async function schliesseLaeufeAb(
  kontext: DrainKontext,
  laufIds: readonly string[],
  ergebnis: DrainErgebnis
): Promise<void> {
  const { services, schema } = kontext
  const { ItemsService } = services
  const meldungen = new ItemsService('meldungen', { schema })
  const laeufe = new ItemsService('laeufe', { schema })

  for (const laufId of laufIds) {
    const offen = (await meldungen.readByQuery({
      filter: {
        lauf: { _eq: laufId },
        verarbeitung: { _in: ['geplant', 'laeuft'] }
      },
      fields: ['id'],
      limit: 1
    })) as unknown[]

    const kaputt = (await meldungen.readByQuery({
      filter: { lauf: { _eq: laufId }, verarbeitung: { _eq: 'fehler' } },
      fields: ['id'],
      limit: 1
    })) as unknown[]

    const status = laufStatusNachDurchlauf({
      offen: offen.length,
      fehler: kaputt.length
    })

    if (offen.length > 0) ergebnis.offen = true
    await laeufe.updateOne(laufId, { status })
  }
}

// --- memory ------------------------------------------------------------------

async function ladeRegeln(
  kontext: DrainKontext,
  datensatzId: string,
  quelleId: string | null
): Promise<Pick<Redaktionswissen, 'regel'>[]> {
  const { services, schema } = kontext
  const { ItemsService } = services

  const passend: Record<string, unknown>[] = [
    { geltungsbereich: { _eq: 'global' } },
    { datensatz: { _eq: datensatzId } }
  ]
  if (quelleId !== null) passend.push({ quelle: { _eq: quelleId } })

  return (await new ItemsService('redaktionswissen', { schema }).readByQuery({
    filter: { aktiv: { _eq: true }, _or: passend },
    fields: ['regel'],
    sort: ['date_created'],
    // Bounded so the cached prefix cannot grow without limit as memory builds.
    limit: 30
  })) as Pick<Redaktionswissen, 'regel'>[]
}

/** Titles and leads of what this dataset produced in earlier periods. */
async function ladeFruehereLaeufe(
  kontext: DrainKontext,
  datensatzId: string,
  aktuellerLauf: string
): Promise<{ periode: string; titel: string; lead: string | null }[]> {
  const { services, schema } = kontext
  const { ItemsService } = services

  const frueher = (await new ItemsService('laeufe', { schema }).readByQuery({
    filter: { datensatz: { _eq: datensatzId }, id: { _neq: aktuellerLauf } },
    fields: ['id', 'periode'],
    sort: ['-periode'],
    limit: 3
  })) as Pick<Lauf, 'id' | 'periode'>[]

  const meldungen = new ItemsService('meldungen', { schema })
  const ergebnis: { periode: string; titel: string; lead: string | null }[] = []

  for (const lauf of frueher) {
    const beispiele = (await meldungen.readByQuery({
      filter: { lauf: { _eq: lauf.id }, titel: { _nnull: true } },
      fields: ['titel', 'lead'],
      limit: 2
    })) as Pick<Meldung, 'titel' | 'lead'>[]

    for (const beispiel of beispiele) {
      if (beispiel.titel === null) continue
      ergebnis.push({
        periode: lauf.periode,
        titel: beispiel.titel,
        lead: beispiel.lead
      })
    }
  }

  return ergebnis
}

/** What we wrote about this one municipality from this dataset before. */
async function ladeFruehereMeldung(
  kontext: DrainKontext,
  datensatzId: string,
  gemeindeId: string,
  aktuelleMeldung: string
): Promise<string | null> {
  const { services, schema } = kontext
  const { ItemsService } = services

  const laeufe = (await new ItemsService('laeufe', { schema }).readByQuery({
    filter: { datensatz: { _eq: datensatzId } },
    fields: ['id'],
    sort: ['-periode'],
    limit: 3
  })) as Pick<Lauf, 'id'>[]

  if (laeufe.length === 0) return null

  const frueher = (await new ItemsService('meldungen', { schema }).readByQuery({
    filter: {
      lauf: { _in: laeufe.map((l) => l.id) },
      gemeinde: { _eq: gemeindeId },
      id: { _neq: aktuelleMeldung },
      titel: { _nnull: true }
    },
    fields: ['titel', 'lead'],
    sort: ['-date_created'],
    limit: 1
  })) as Pick<Meldung, 'titel' | 'lead'>[]

  const treffer = frueher[0]
  if (treffer === undefined || treffer.titel === null) return null

  return `${treffer.titel}${treffer.lead === null ? '' : `\n${treffer.lead}`}`
}

// --- opening runs ------------------------------------------------------------

/**
 * Opens a run for every dataset an editor has marked relevant, for its newest
 * period — unless one already exists.
 *
 * The "unless" is not enforced here but by the unique constraint on
 * (datensatz, periode): two overlapping ticks both reading "no run yet" and
 * both inserting is exactly the race a check-then-write cannot close. The
 * loser gets a constraint violation, which is the correct outcome and is
 * swallowed on purpose.
 */
type Kandidat = Pick<
  Datensatz,
  | 'id'
  | 'quelle'
  | 'externe_id'
  | 'titel'
  | 'felder'
  | 'standard_vorgabe'
  | 'letzter_stand'
  | 'lauf_stand'
>

export async function eroeffneLaeufe(
  kontext: DrainKontext,
  hoechstens = 3,
  /**
   * Restrict to one dataset.
   *
   * The endpoint passes this, and has to: it marks the dataset the editor
   * clicked as relevant and then asks for a run. Without the restriction this
   * function takes the *oldest* relevant dataset by `date_updated` — and the one
   * just marked has the newest — so the button opened a run for some other
   * dataset, or for nothing at all, and reported neither.
   */
  nurDatensatz?: string,
  /** The editor's instruction, when the run was started by hand. */
  vorgabe?: string | null
): Promise<{ eroeffnet: number; fehler: string[] }> {
  const { services, schema, logger } = kontext
  const { ItemsService } = services
  const ergebnis = { eroeffnet: 0, fehler: [] as string[] }

  const kandidaten = (await new ItemsService('datensaetze', {
    schema
  }).readByQuery({
    filter: {
      status: { _eq: 'relevant' },
      // A dataset the portal does not annotate is still workable once someone
      // has named the municipality column by hand — that override is exactly
      // what says "I looked, it is in there".
      _or: [
        { hat_gemeinde: { _eq: true } },
        { gemeindefeld: { _nnull: true } }
      ],
      ...(nurDatensatz === undefined ? {} : { id: { _eq: nurDatensatz } })
    },
    fields: [
      'id',
      'quelle',
      'externe_id',
      'titel',
      'felder',
      'standard_vorgabe',
      'letzter_stand',
      'lauf_stand'
    ],
    sort: ['date_updated'],
    // Read them all, then take the ones still open. Filtering in the query
    // would need a column-to-column comparison, which Directus filters cannot
    // express — and cutting to `hoechstens` here is exactly what caused the
    // head-of-line blocking: the same unopenable datasets took the seats on
    // every tick. There are a few dozen relevant datasets, not thousands.
    limit: -1
  })) as Kandidat[]

  const offene = offeneLaeufe(
    kandidaten,
    hoechstens,
    nurDatensatz !== undefined
  )

  // Der Knopf darf nie stumm bleiben. Findet die Abfrage den verlangten
  // Datensatz nicht, liegt es an seinem Status oder daran, dass keine
  // Gemeindespalte bekannt ist — beides kann der Aufrufer beheben, aber nur
  // wenn er es erfaehrt.
  if (nurDatensatz !== undefined && offene.length === 0) {
    ergebnis.fehler.push(
      'Fuer diesen Datensatz laesst sich kein Lauf eroeffnen: entweder ist er nicht freigegeben oder es ist keine Gemeindespalte bekannt.'
    )
  }

  const quellen = new ItemsService('quellen', { schema })
  const laeufe = new ItemsService('laeufe', { schema })
  const datensaetze = new ItemsService('datensaetze', { schema })

  for (const datensatz of offene) {
    try {
      const felder = datensatz.felder ?? []
      const periodenFeld = detectPeriodField(felder)
      const quelle = (await quellen.readOne(datensatz.quelle ?? '', {
        fields: ['id', 'basis_url', 'typ']
      })) as Pick<Quelle, 'id' | 'basis_url' | 'typ'>

      // A portal table states its newest period in the year selector; the open
      // data portal has to be asked for one row, and needs an unambiguous time
      // axis before it can be asked at all.
      let periode: string | null

      if (quelle.typ === 'statbl') {
        periode = (await ladeTabelle(datensatz.externe_id)).jahr || null
      } else if (periodenFeld === null) {
        // Several date columns, or none: a run for the wrong period is worse
        // than no run. It is also permanent — the portal will not grow a date
        // column tomorrow — so the dataset leaves the queue instead of taking a
        // seat on every tick for ever. `ignoriert` is reversible in the admin
        // UI, and an editor can still give it a run by hand with an explicit
        // instruction.
        await datensaetze.updateOne(datensatz.id, {
          status: 'ignoriert',
          bewertung:
            'Nicht relevant: keine eindeutige Zeitachse. Fuer einen Lauf im Reiter "Angekuendigt" einen Auftrag von Hand geben.'
        })
        ergebnis.fehler.push(
          `${datensatz.titel}: Zeitachse nicht eindeutig, kein Lauf eroeffnet`
        )
        continue
      } else {
        periode = latestPeriod(
          await exportRecords(quelle.basis_url, datensatz.externe_id, {
            orderBy: `${periodenFeld} desc`,
            select: periodenFeld
          }),
          periodenFeld
        )
      }
      if (periode === null) {
        ergebnis.fehler.push(`${datensatz.titel}: keine Periode erkennbar`)
        continue
      }

      const vorhanden = (await laeufe.readByQuery({
        filter: { datensatz: { _eq: datensatz.id }, periode: { _eq: periode } },
        fields: ['id'],
        limit: 1
      })) as unknown[]

      if (vorhanden.length > 0) {
        // Not an error — the run is simply already there. But it is the answer
        // to "why did nothing happen when I pressed the button", so it has to
        // travel back rather than being skipped in silence.
        //
        // Recorded as done for this state of the data, or the dataset would
        // come back every two minutes and spend one portal request each time
        // learning the same thing.
        await datensaetze.updateOne(datensatz.id, {
          lauf_stand: datensatz.letzter_stand
        })
        ergebnis.fehler.push(
          `${datensatz.titel}: Fuer die Periode ${periode} gibt es bereits einen Lauf.`
        )
        continue
      }

      // The memory: a run started by the nightly check inherits the
      // instruction that made this dataset worth writing about in the first
      // place. Without it, next year's edition of the same table would be
      // written up from a blank brief and read like a different story.
      const auftrag = hatVorgabe(vorgabe)
        ? (vorgabe ?? '').trim()
        : hatVorgabe(datensatz.standard_vorgabe)
          ? (datensatz.standard_vorgabe ?? '').trim()
          : null

      await laeufe.createOne({
        datensatz: datensatz.id,
        periode,
        status: 'geplant',
        ...(auftrag === null ? {} : { vorgabe: auftrag })
      })
      await datensaetze.updateOne(datensatz.id, {
        lauf_stand: datensatz.letzter_stand
      })

      logger.info(`drain: Lauf eroeffnet — ${datensatz.titel} (${periode})`)
      ergebnis.eroeffnet += 1
    } catch (error) {
      const text = fehlerText(error)
      // A lost race on the unique constraint is the constraint doing its job.
      if (/unique|duplicate/i.test(text)) continue

      logger.warn(error, `drain: Lauf fuer ${datensatz.titel} nicht eroeffnet`)
      ergebnis.fehler.push(`${datensatz.titel}: ${text}`)
    }
  }

  return ergebnis
}

/** Only for tests: forgets that a pass is in flight. */
export function resetDrainZustand(): void {
  laufend = null
}

export { latestPeriod }
