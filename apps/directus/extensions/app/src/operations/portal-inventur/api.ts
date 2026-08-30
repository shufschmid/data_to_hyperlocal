import { defineOperationApi } from '@directus/extensions-sdk'
import { cacheableSystem, completeJson } from '../../shared/claude'
import {
  ladeSeite,
  parseKapitelName,
  parseKinder,
  parseLetzteAenderung,
  parseZweige,
  StatblFehler
} from '../../shared/statbl'
import {
  abdeckungHinweis,
  ABDECKUNG_SCHEMA,
  buildAbdeckungPrompt,
  buildAbdeckungSystem,
  ordneSeiteEin,
  parseAbdeckung,
  type AbdeckungKatalog
} from '../../shared/statbl/inventur'
import type {
  Ankuendigung,
  Datensatz,
  Gemeinde,
  PortalBereich,
  PortalSeite
} from '../../types/schema'

// Walking the statistics portal once, to find out what needs watching daily.
//
// The rule comes from the newsroom: watch only what is broken down by
// municipality, is **not** in the open-data portal, and has **no** agenda entry.
// Everything else already reaches us through those two channels and may arrive
// a day later. This operation is what turns that rule into a list.
//
// It is deliberately a queue rather than a crawl. The portal has 21 chapters,
// 88 branches and — measured — around 2'800 pages behind them, so a single run
// would pull some 90 MB from a host that owes us nothing. Instead every run
// takes `seiten` pages off the queue and stops. Interrupt it, redeploy, run it
// again: it continues where it stood, because the queue is rows in
// `portal_seiten` with `art = 'offen'` and not a variable in memory.
//
// The order is cheapest-first. Whether a page is a municipality table is
// arithmetic against our own 86 names; only what survives that costs a model
// call, and that call carries both catalogues in a cached prefix.

const KAPITEL = Array.from({ length: 21 }, (_, i) => String(i + 1))

export interface Options {
  seiten: number
  abdeckungen?: number | null
  model?: string | null
}

interface Ergebnis {
  bereiche: number
  besucht: number
  tabellen: number
  gemeindetabellen: number
  beobachtet: number
  abgedeckt: number
  unklar: number
  offen: number
  fehler: string[]
}

const STANDARD_ABDECKUNGEN = 40

export default defineOperationApi<Options>({
  id: 'portal-inventur',
  handler: async (
    { seiten, abdeckungen, model },
    { services, getSchema, logger }
  ) => {
    const { ItemsService } = services
    const schema = await getSchema()

    const bereicheService = new ItemsService('portal_bereiche', { schema })
    const seitenService = new ItemsService('portal_seiten', { schema })
    const gemeindenService = new ItemsService('gemeinden', { schema })
    const datensaetzeService = new ItemsService('datensaetze', { schema })
    const ankuendigungenService = new ItemsService('ankuendigungen', { schema })

    const budget = Math.max(seiten, 0)
    const abdeckungsBudget =
      typeof abdeckungen === 'number' && Number.isFinite(abdeckungen)
        ? Math.max(abdeckungen, 0)
        : STANDARD_ABDECKUNGEN

    const ergebnis: Ergebnis = {
      bereiche: 0,
      besucht: 0,
      tabellen: 0,
      gemeindetabellen: 0,
      beobachtet: 0,
      abgedeckt: 0,
      unklar: 0,
      offen: 0,
      fehler: []
    }

    await legeBereicheAn()
    await besucheOffeneSeiten()
    await pruefeAbdeckung()
    await leiteBeobachtungAb()

    // What the next run still has to do. Reported rather than logged, because
    // "is the inventory finished?" is the one question an editor will ask.
    ergebnis.offen = (
      (await seitenService.readByQuery({
        filter: { art: { _eq: 'offen' } },
        fields: ['id'],
        limit: -1
      })) as unknown[]
    ).length

    return ergebnis

    /**
     * The 21 chapters, read once, giving the 88 branches.
     *
     * Skipped entirely once the branches exist — the chapter structure of a
     * statistical portal does not change between nightly runs, and re-reading
     * it would spend a fifth of every budget on pages we already know.
     */
    async function legeBereicheAn(): Promise<void> {
      const vorhanden = (await bereicheService.readByQuery({
        fields: ['id', 'pfad', 'titel'],
        limit: -1
      })) as Pick<PortalBereich, 'id' | 'pfad' | 'titel'>[]

      ergebnis.bereiche = vorhanden.length

      // Zweige ohne Namen nachtragen. "Zweig 3_5" sagt niemandem etwas; das
      // Portal nennt ihn "Wohn-/Arbeitsort", und die erste Fassung dieser
      // Funktion hat die Beschriftung beim Einlesen weggeworfen.
      const ohneTitel = vorhanden.filter((b) => (b.titel ?? '') === '')
      if (vorhanden.length > 0 && ohneTitel.length === 0) return

      for (const kapitel of KAPITEL) {
        try {
          const { html } = await ladeSeite(kapitel)
          ergebnis.besucht += 1

          const kapitelName = parseKapitelName(html, kapitel)

          for (const zweig of parseZweige(html, kapitel)) {
            // "Preise — Grundbesitzwechsel" statt "5_1": das Kapitel gibt dem
            // Namen den Zusammenhang, den der Zweigname allein nicht hat.
            const titel =
              kapitelName === null
                ? zweig.titel
                : `${kapitelName} — ${zweig.titel}`

            const bekannt = vorhanden.find((b) => b.pfad === zweig.pfad)

            if (bekannt !== undefined) {
              if ((bekannt.titel ?? '') === '') {
                await bereicheService.updateOne(bekannt.id, { titel })
              }
              continue
            }

            await bereicheService.createOne({
              pfad: zweig.pfad,
              titel,
              inventur_offen: true
            })
            await seitenService.createOne({ pfad: zweig.pfad, art: 'offen' })
            ergebnis.bereiche += 1
          }
        } catch (error) {
          melde(`Kapitel ${kapitel}`, error)
        }
      }
    }

    /**
     * Takes pages off the queue, classifies them, and adds what they link to.
     *
     * A branch page lists only the sub-branch that happens to be selected, so
     * the descendants have to be discovered page by page rather than read off
     * the top. That is why this is a queue and not a two-level loop.
     */
    async function besucheOffeneSeiten(): Promise<void> {
      const gemeinden = (await gemeindenService.readByQuery({
        fields: ['name'],
        limit: -1
      })) as Pick<Gemeinde, 'name'>[]

      while (ergebnis.besucht < budget) {
        // Insertion order, not alphabetical. Sorted by path, "15_1" comes
        // before "1_1" — the underscore sorts after the digits — so the walk
        // jumped through the portal in an order nobody could follow, and the
        // chapter someone was waiting for came last. Rows are created chapter
        // by chapter, so their creation order *is* the portal's order.
        const naechste = (await seitenService.readByQuery({
          filter: { art: { _eq: 'offen' } },
          fields: ['id', 'pfad'],
          sort: ['date_created', 'pfad'],
          limit: 1
        })) as Pick<PortalSeite, 'id' | 'pfad'>[]

        const seite = naechste[0]
        if (seite === undefined) break

        try {
          const { html } = await ladeSeite(seite.pfad)
          ergebnis.besucht += 1

          const bereich = await findeBereich(seite.pfad)
          const einordnung = ordneSeiteEin(html, gemeinden, seite.pfad)

          await seitenService.updateOne(seite.id, {
            bereich,
            art: einordnung.art,
            titel: einordnung.titel.slice(0, 300),
            form: einordnung.tabelle?.form ?? null,
            gemeindeebene: einordnung.gemeindeebene,
            treffer: einordnung.treffer,
            hinweis: abdeckungHinweis(einordnung, null),
            geprueft_am: new Date().toISOString()
          })

          if (einordnung.art === 'tabelle') ergebnis.tabellen += 1
          else ergebnis.unklar += 1
          if (einordnung.gemeindeebene) ergebnis.gemeindetabellen += 1

          // The branch's own date travels with the first page of it we read.
          if (bereich !== null) {
            await bereicheService.updateOne(bereich, {
              stand: parseLetzteAenderung(html),
              letzte_pruefung: new Date().toISOString(),
              letzter_fehler: null
            })
          }

          for (const kind of parseKinder(html, seite.pfad)) {
            await legeSeiteAn(kind)
          }
        } catch (error) {
          melde(seite.pfad, error)
          // Marked as navigation rather than left open: a page that cannot be
          // read must not block the queue for ever. It is counted as unclear,
          // so a systematic failure shows up as a number instead of silence.
          await seitenService.updateOne(seite.id, {
            art: 'navigation',
            hinweis: `Nicht lesbar: ${text(error)}`,
            geprueft_am: new Date().toISOString()
          })
          ergebnis.unklar += 1
        }
      }
    }

    /**
     * The one model question, for municipality tables only.
     *
     * Both catalogues sit in the cached system prefix, so the first call of a
     * run pays for them and the rest read them back.
     */
    async function pruefeAbdeckung(): Promise<void> {
      // Die Bezugszahl fuer den Hinweistext: wie viele Gemeinden die Redaktion
      // fuehrt. Waechst mit, sobald eine ausserkantonale dazukommt.
      const bekannteGemeinden = (
        (await gemeindenService.readByQuery({
          fields: ['id'],
          limit: -1
        })) as unknown[]
      ).length

      if (abdeckungsBudget === 0) return

      const offene = (await seitenService.readByQuery({
        filter: {
          art: { _eq: 'tabelle' },
          gemeindeebene: { _eq: true },
          beobachten: { _eq: false },
          ods_datensatz: { _null: true },
          ankuendigung: { _null: true }
        },
        fields: ['id', 'pfad', 'titel', 'treffer'],
        sort: ['pfad'],
        limit: abdeckungsBudget
      })) as Pick<PortalSeite, 'id' | 'pfad' | 'titel' | 'treffer'>[]

      if (offene.length === 0) return

      const katalog: AbdeckungKatalog = {
        // Only the open-data portal, never our own registered tables. A table
        // we already track is a `datensaetze` row whose `externe_id` is its
        // portal path — offered to the model, it answered that table 7_1_1_3 is
        // covered by dataset 7_1_1_3, which is true and useless. Those are
        // recognised below without asking anyone.
        datensaetze: (await datensaetzeService.readByQuery({
          filter: { quelle: { typ: { _eq: 'ods' } } },
          fields: ['externe_id', 'titel'],
          limit: -1
        })) as Pick<Datensatz, 'externe_id' | 'titel'>[],
        ankuendigungen: (await ankuendigungenService.readByQuery({
          fields: ['id', 'titel'],
          limit: -1
        })) as Pick<Ankuendigung, 'id' | 'titel'>[]
      }

      const system = cacheableSystem(buildAbdeckungSystem(katalog))

      for (const seite of offene) {
        try {
          // Already tracked as a dataset? Then the yearly check in
          // `quellen-pruefen` covers it and the branch does not need watching.
          // Deterministic — the dataset carries the portal path as its id.
          const bereits = (await datensaetzeService.readByQuery({
            filter: { externe_id: { _eq: seite.pfad } },
            fields: ['id', 'titel'],
            limit: 1
          })) as Pick<Datensatz, 'id' | 'titel'>[]

          if (bereits[0] !== undefined) {
            await seitenService.updateOne(seite.id, {
              datensatz: bereits[0].id,
              beobachten: false,
              hinweis: `Wird bereits als Datensatz gefuehrt: ${bereits[0].titel}`,
              geprueft_am: new Date().toISOString()
            })
            ergebnis.abgedeckt += 1
            continue
          }

          const antwort = await completeJson<unknown>({
            system,
            prompt: buildAbdeckungPrompt({
              pfad: seite.pfad,
              titel: seite.titel
            }),
            schema: ABDECKUNG_SCHEMA,
            maxTokens: 500,
            thinking: 'disabled',
            effort: 'low',
            ...(model ? { model } : {})
          })

          const abdeckung = parseAbdeckung(antwort, katalog, true)
          const eintrag = katalog.ankuendigungen.find(
            (a) => a.titel === abdeckung.ankuendigung
          )

          await seitenService.updateOne(seite.id, {
            ods_datensatz: abdeckung.datensatz,
            ankuendigung: eintrag?.id ?? null,
            beobachten: abdeckung.beobachten,
            hinweis: abdeckungHinweis(
              {
                gemeindeebene: true,
                treffer: seite.treffer,
                bekannt: bekannteGemeinden
              },
              abdeckung
            ),
            geprueft_am: new Date().toISOString()
          })

          if (abdeckung.beobachten) ergebnis.beobachtet += 1
          else ergebnis.abgedeckt += 1
        } catch (error) {
          // Left unanswered on purpose: the next run asks again. Guessing
          // "covered" here would drop the table from the watch for good.
          logger.warn(
            error,
            `portal-inventur: Abdeckung fuer ${seite.pfad} offen`
          )
        }
      }
    }

    /** A branch is watched as soon as one of its pages needs watching. */
    async function leiteBeobachtungAb(): Promise<void> {
      const bereiche = (await bereicheService.readByQuery({
        fields: ['id', 'pfad'],
        limit: -1
      })) as Pick<PortalBereich, 'id' | 'pfad'>[]

      for (const bereich of bereiche) {
        const zuBeobachten = (await seitenService.readByQuery({
          filter: { bereich: { _eq: bereich.id }, beobachten: { _eq: true } },
          fields: ['id'],
          limit: 1
        })) as unknown[]

        const nochOffen = (await seitenService.readByQuery({
          filter: { bereich: { _eq: bereich.id }, art: { _eq: 'offen' } },
          fields: ['id'],
          limit: 1
        })) as unknown[]

        const unklar = (await seitenService.readByQuery({
          filter: {
            bereich: { _eq: bereich.id },
            art: { _eq: 'navigation' },
            gemeindeebene: { _eq: false }
          },
          fields: ['id'],
          limit: -1
        })) as unknown[]

        await bereicheService.updateOne(bereich.id, {
          beobachten: zuBeobachten.length > 0,
          inventur_offen: nochOffen.length > 0,
          unklar: unklar.length
        })
      }
    }

    async function findeBereich(pfad: string): Promise<string | null> {
      const teile = pfad.split('_')
      if (teile.length < 2) return null

      const zweig = `${teile[0]}_${teile[1]}`
      const treffer = (await bereicheService.readByQuery({
        filter: { pfad: { _eq: zweig } },
        fields: ['id'],
        limit: 1
      })) as { id: string }[]

      return treffer[0]?.id ?? null
    }

    async function legeSeiteAn(pfad: string): Promise<void> {
      const vorhanden = (await seitenService.readByQuery({
        filter: { pfad: { _eq: pfad } },
        fields: ['id'],
        limit: 1
      })) as unknown[]

      if (vorhanden.length > 0) return
      await seitenService.createOne({ pfad, art: 'offen' })
    }

    function melde(was: string, error: unknown): void {
      const beschreibung = text(error)
      logger.warn(`portal-inventur: ${was} — ${beschreibung}`)
      if (ergebnis.fehler.length < 20) {
        ergebnis.fehler.push(`${was}: ${beschreibung}`)
      }
    }

    function text(error: unknown): string {
      if (error instanceof StatblFehler) return error.message
      return error instanceof Error ? error.message : String(error)
    }
  }
})
