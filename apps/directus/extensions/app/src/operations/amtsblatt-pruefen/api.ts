import { defineOperationApi } from '@directus/extensions-sdk'
import { completeJson } from '../../shared/claude'
import { optionalEnv } from '../../shared/env'
import {
  fetchPublikationen,
  type AmtsblattTreffer
} from '../../shared/amtsblatt'
import {
  buildTriagePrompt,
  lernDigest,
  parseTriage,
  TRIAGE_SCHEMA,
  TRIAGE_SYSTEM_PROMPT,
  type LernEintrag,
  type TriageZeile
} from '../../redaktion/amtsblatt'
import {
  ergaenzeZeile,
  type AmtsblattZeile
} from '../../redaktion/amtsblattlauf'

// The 07:00 look at the official gazette portal.
//
// Per municipality: two list requests (the portal indexes by place AND by
// address, and the two sets do not overlap — see `fetchPublikationen`), insert
// what is new, then ONE triage call over the day's titles.
//
// The triage sorts, it does not filter: everything stays on the desk, the
// proposals sit on top and the rest one click away. That is what keeps the tab
// usable at a measured 12 publications a day over seven municipalities, of
// which eight are commercial-register routine.
//
// For what it proposes, the run goes one step further and reads the single
// publication plus, where Baselland published them, the actual building plans.
// Everything else keeps its link and gets the same treatment the moment an
// editor presses the button — the work is the same function either way.
//
// No Meldung is written here. Every article on this feed starts with a person's
// decision.

interface Optionen {
  /** How many municipalities one run reads — the boundedness option every scrape has. */
  gemeinden?: number
  /** How many proposals get their plans read per run. Opus with images, so: few. */
  plaene?: number
  /** How many days back a run looks, on top of the last successful check. */
  nachlauf?: number
  model?: string | null
}

interface Ergebnis {
  gemeinden: number
  neu: number
  vorschlaege: number
  plaeneGelesen: number
  ohnePlz: string[]
  fehler: string[]
}

/** How many past decisions ride into the triage as examples. */
const LERN_FENSTER = 20

/** The portal answers a date, never a time — a day of overlap costs nothing. */
const NACHLAUF_TAGE = 2

function tageZurueck(tage: number): string {
  const d = new Date(Date.now() - tage * 24 * 60 * 60 * 1000)
  return d.toISOString().slice(0, 10)
}

export default defineOperationApi<Optionen>({
  id: 'amtsblatt-pruefen',
  handler: async (optionen, { services, getSchema, logger }) => {
    const { ItemsService } = services
    const schema = await getSchema()
    const hoechstens = Math.max(1, optionen.gemeinden ?? 20)
    const planBudget = Math.max(0, optionen.plaene ?? 6)
    const nachlauf = Math.max(1, optionen.nachlauf ?? NACHLAUF_TAGE)
    const kontakt = optionalEnv('AGENDA_KONTAKT', 'it@bajour.ch')
    const abruf = { kontakt }

    const gemeindenService = new ItemsService('gemeinden', { schema })
    const meldungen = new ItemsService('amtsblattmeldungen', { schema })
    const quellen = new ItemsService('quellen', { schema })

    const ergebnis: Ergebnis = {
      gemeinden: 0,
      neu: 0,
      vorschlaege: 0,
      plaeneGelesen: 0,
      ohnePlz: [],
      fehler: []
    }

    const gemeinden = (await gemeindenService.readByQuery({
      filter: { aktiv: { _eq: true }, bfs_nummer: { _nnull: true } },
      fields: ['id', 'name', 'bfs_nummer', 'plz'],
      sort: ['name'],
      limit: hoechstens
    })) as {
      id: string
      name: string
      bfs_nummer: number
      plz: string[] | null
    }[]

    let planBudgetRest = planBudget

    for (const gemeinde of gemeinden) {
      ergebnis.gemeinden += 1
      const plz = gemeinde.plz ?? []
      // Without a postcode the SHAB half of this municipality is invisible.
      // Named rather than logged: an absence is otherwise indistinguishable
      // from "nothing was published".
      if (plz.length === 0) ergebnis.ohnePlz.push(gemeinde.name)

      try {
        const treffer = await fetchPublikationen(
          { bfsNummer: gemeinde.bfs_nummer, plz },
          tageZurueck(nachlauf + 5),
          abruf
        )
        if (treffer.length === 0) continue

        const bekannt = new Set(
          (
            (await meldungen.readByQuery({
              filter: {
                publikations_id: { _in: treffer.map((t) => t.id) }
              },
              fields: ['publikations_id'],
              limit: -1
            })) as { publikations_id: string }[]
          ).map((z) => z.publikations_id)
        )

        const neue: AmtsblattTreffer[] = treffer.filter(
          (t) => !bekannt.has(t.id)
        )
        if (neue.length === 0) continue

        const angelegt: { id: string; treffer: AmtsblattTreffer }[] = []
        for (const t of neue) {
          try {
            const id = (await meldungen.createOne({
              publikations_id: t.id,
              publikationsnummer: t.nummer,
              gemeinde: gemeinde.id,
              kanton: t.kanton,
              gruppe: t.gruppe,
              rubrik: t.rubrik,
              unterrubrik: t.unterrubrik,
              rubrik_name: t.rubrikName,
              titel: t.titel,
              publiziert_am: t.publiziertAm,
              amt: t.amt,
              pdf_url: t.pdfUrl
            })) as string
            angelegt.push({ id, treffer: t })
            ergebnis.neu += 1
          } catch (fehler) {
            // A race with a parallel run, or one bad row — never the whole
            // municipality.
            logger.warn(fehler, `Publikation ${t.id} nicht angelegt.`)
          }
        }
        if (angelegt.length === 0) continue

        // --- Triage: one call for this municipality's new publications
        const gelernt = (await meldungen.readByQuery({
          filter: {
            gemeinde: { _eq: gemeinde.id },
            entscheid: { _neq: 'offen' }
          },
          fields: ['titel', 'rubrik_name', 'entscheid', 'ablehnungsgrund'],
          sort: ['-date_updated'],
          limit: LERN_FENSTER
        })) as {
          titel: string
          rubrik_name: string | null
          entscheid: LernEintrag['entscheid']
          ablehnungsgrund: string | null
        }[]

        const zeilen: TriageZeile[] = angelegt.map(({ id, treffer }) => ({
          id,
          titel: treffer.titel,
          rubrikName: treffer.rubrikName,
          gruppe: treffer.gruppe,
          amt: treffer.amt
        }))

        try {
          const antwort = await completeJson<unknown>({
            system: TRIAGE_SYSTEM_PROMPT,
            prompt: buildTriagePrompt(
              gemeinde.name,
              zeilen,
              lernDigest(
                gelernt.map((g) => ({
                  titel: g.titel,
                  rubrikName: g.rubrik_name ?? '',
                  entscheid: g.entscheid,
                  grund: g.ablehnungsgrund
                })),
                LERN_FENSTER
              )
            ),
            maxTokens: 4096,
            model: optionen.model ?? undefined,
            schema: TRIAGE_SCHEMA
          })

          for (const urteil of parseTriage(antwort, zeilen)) {
            await meldungen.updateOne(urteil.id, {
              vorschlag: urteil.vorschlag,
              vorschlag_begruendung: urteil.begruendung
            })
            if (urteil.vorschlag) ergebnis.vorschlaege += 1
          }
        } catch (fehler) {
          // The rows are already on the desk; only the recommendation is
          // missing, and `vorschlag: null` reads as "not judged", not "no".
          logger.warn(fehler, `Sichtung fuer ${gemeinde.name} fehlgeschlagen.`)
          ergebnis.fehler.push(`${gemeinde.name}: Sichtung fehlgeschlagen.`)
        }

        // --- What the triage proposed: fetch the facts, look at the plans
        const vorgeschlagen = (await meldungen.readByQuery({
          filter: {
            gemeinde: { _eq: gemeinde.id },
            vorschlag: { _eq: true },
            plan_status: { _eq: 'offen' }
          },
          fields: [
            'id',
            'publikations_id',
            'titel',
            'angaben',
            'unterlagen',
            'plan_status',
            'gemeinde.id',
            'gemeinde.name'
          ],
          sort: ['-publiziert_am'],
          limit: Math.max(0, planBudgetRest)
        })) as AmtsblattZeile[]

        for (const zeile of vorgeschlagen) {
          if (planBudgetRest <= 0) break
          planBudgetRest -= 1
          const lesung = await ergaenzeZeile(zeile, {
            meldungen,
            logger,
            abruf,
            model: optionen.model ?? null
          })
          if (lesung.status === 'gelesen') ergebnis.plaeneGelesen += 1
        }
      } catch (fehler) {
        const grund =
          fehler instanceof Error ? fehler.message : 'Unbekannter Fehler'
        logger.warn(fehler, `Amtsblatt fuer ${gemeinde.name} fehlgeschlagen.`)
        ergebnis.fehler.push(`${gemeinde.name}: ${grund}`)
      }
    }

    // One source row for the whole feed — the banner reads it, exactly as with
    // the agenda.
    const quelle = (await quellen.readByQuery({
      filter: { typ: { _eq: 'amtsblatt' } },
      fields: ['id'],
      limit: 1
    })) as { id: string }[]
    const quelleId = quelle[0]?.id
    if (quelleId !== undefined) {
      await quellen.updateOne(quelleId, {
        letzte_pruefung: new Date().toISOString(),
        letzter_fehler:
          ergebnis.fehler.length === 0
            ? null
            : ergebnis.fehler.join(' · ').slice(0, 1000)
      })
    }

    return ergebnis
  }
})
