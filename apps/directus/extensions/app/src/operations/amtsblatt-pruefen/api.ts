import { defineOperationApi } from '@directus/extensions-sdk'
import { completeJson } from '../../shared/claude'
import { optionalEnv } from '../../shared/env'
import {
  fetchPublikationen,
  type AmtsblattTreffer
} from '../../shared/amtsblatt'
import {
  AUFRAEUM_TAGE,
  buildTriagePrompt,
  darfWeg,
  lernDigest,
  parseTriage,
  TRIAGE_SCHEMA,
  TRIAGE_SYSTEM_PROMPT,
  type AufraeumZeile,
  type LernEintrag,
  type TriageZeile
} from '../../redaktion/amtsblatt'
import {
  ergaenzeZeile,
  type AmtsblattZeile
} from '../../redaktion/amtsblattlauf'
import {
  baueSimapZeile,
  ordneProjektZu,
  type SimapZeilenwerte
} from '../../redaktion/simaplauf'
import {
  fetchDetail,
  fetchErfuellungsort,
  fetchVergabestellen,
  kantonVonBezirk,
  type SimapGemeinde,
  type SimapProjekt
} from '../../shared/simap'
import type { SimapVergabestelle } from '../../types/schema'

// The 07:00 look at the official gazette portal — and at simap.ch.
//
// Per municipality: two list requests (the portal indexes by place AND by
// address, and the two sets do not overlap — see `fetchPublikationen`), insert
// what is new, then ONE triage call over the day's titles.
//
// Public procurement rides along rather than getting a Flow of its own, and
// that is the whole reason it is cheap: its rows land in the same collection as
// group `beschaffung`, so ONE triage call per municipality judges the gazette's
// news and the day's tenders together, at no extra model cost. The simap phase
// runs before the municipality loop (its second query asks for all cantons at
// once) and catches its own failures — the platform being unreachable must
// never cost the gazette run.
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
  /** Of `neu`, how many came from simap.ch rather than the gazette portal. */
  beschaffungen: number
  vorschlaege: number
  plaeneGelesen: number
  aufgeraeumt: number
  ohnePlz: string[]
  /** Named, not logged — see `ohnePlz`. Their own tenders stay invisible. */
  ohneVergabestellen: string[]
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
      beschaffungen: 0,
      vorschlaege: 0,
      plaeneGelesen: 0,
      aufgeraeumt: 0,
      ohnePlz: [],
      ohneVergabestellen: [],
      fehler: []
    }

    // The desk cleans itself, the same way the press review's does: undecided
    // rows that can no longer be acted on are deleted. DECIDED rows always
    // stay — they are this feed's memory, and the next triage learns from them.
    const heute = new Date().toISOString().slice(0, 10)
    try {
      const offene = (await meldungen.readByQuery({
        filter: { entscheid: { _eq: 'offen' } },
        fields: ['id', 'entscheid', 'vorschlag', 'frist', 'publiziert_am'],
        limit: -1
      })) as AufraeumZeile[]

      // Das Rueckschau-Fenster wird durchgereicht, damit Aufraeumen und Holen
      // nicht gegeneinander arbeiten koennen — auch wenn jemand die Optionen
      // spaeter verstellt.
      const weg = offene
        .filter((z) => darfWeg(z, heute, AUFRAEUM_TAGE, nachlauf + 1))
        .map((z) => z.id)
      if (weg.length > 0) {
        await meldungen.deleteMany(weg)
        ergebnis.aufgeraeumt = weg.length
      }
    } catch (fehler) {
      // Housekeeping must never cost the run its actual work.
      logger.warn(fehler, 'Amtsblatt: Aufraeumen fehlgeschlagen.')
    }

    const gemeinden = (await gemeindenService.readByQuery({
      filter: { aktiv: { _eq: true }, bfs_nummer: { _nnull: true } },
      fields: [
        'id',
        'name',
        'bfs_nummer',
        'bezirk',
        'plz',
        'simap_vergabestellen'
      ],
      sort: ['name'],
      limit: hoechstens
    })) as {
      id: string
      name: string
      bfs_nummer: number
      bezirk: string
      plz: string[] | null
      simap_vergabestellen: SimapVergabestelle[] | null
    }[]

    // --- simap.ch: the procurement half, collected before the municipality loop
    //
    // Two queries, and both are needed for a different reason. The
    // procurement-office one is asked PER MUNICIPALITY so a row's municipality
    // is certain by construction; the place-of-performance one is asked ONCE
    // for all cantons involved and matched locally by postcode — that is what
    // catches the school the CANTON builds in Muttenz, which the municipality
    // itself never publishes.
    //
    // The whole phase catches its own failures: simap being unreachable must
    // never cost the gazette run, which is the feed this desk was built for.
    const simapGemeinden: SimapGemeinde[] = gemeinden.map((g) => ({
      id: g.id,
      name: g.name,
      bezirk: g.bezirk,
      plz: g.plz ?? []
    }))
    /** New procurement rows, ready to insert, grouped by municipality. */
    const simapJeGemeinde = new Map<string, SimapZeilenwerte[]>()

    try {
      const seit = tageZurueck(nachlauf)
      const gesehen = new Set<string>()
      // `{projekt, gemeinde}` rather than a flat list: the office query already
      // knows the municipality, and re-deriving it from a name is the mistake
      // this connector exists to avoid.
      const gefunden: { projekt: SimapProjekt; gemeinde: SimapGemeinde }[] = []

      for (const gemeinde of gemeinden) {
        const stellen = (gemeinde.simap_vergabestellen ?? [])
          .map((v) => v.id)
          .filter((id) => id !== '')
        if (stellen.length === 0) {
          ergebnis.ohneVergabestellen.push(gemeinde.name)
          continue
        }
        const eigene = await fetchVergabestellen(stellen, seit, abruf)
        if (eigene.abgeschnitten)
          ergebnis.fehler.push(
            `simap.ch: Zu ${gemeinde.name} gab es mehr Publikationen, als ein Lauf liest.`
          )
        for (const projekt of eigene.projekte) {
          if (gesehen.has(projekt.publicationId)) continue
          gesehen.add(projekt.publicationId)
          const zu = simapGemeinden.find((g) => g.id === gemeinde.id)
          if (zu !== undefined) gefunden.push({ projekt, gemeinde: zu })
        }
      }

      const kantone = [
        ...new Set(gemeinden.map((g) => kantonVonBezirk(g.bezirk)))
      ]
      const fremde = await fetchErfuellungsort(kantone, seit, abruf)
      // Said, not swallowed: the rows read are good, but a truncated list means
      // a publication in one of our municipalities may be missing.
      if (fremde.abgeschnitten)
        ergebnis.fehler.push(
          'simap.ch: Es gab mehr Publikationen mit Erfuellungsort in der Region, ' +
            'als ein Lauf liest — Nachlauf verkleinern.'
        )
      for (const projekt of fremde.projekte) {
        if (gesehen.has(projekt.publicationId)) continue
        const zu = ordneProjektZu(projekt, simapGemeinden, null)
        if (zu === null) continue
        gesehen.add(projekt.publicationId)
        gefunden.push({ projekt, gemeinde: zu })
      }

      // Only what this database does not have yet — the detail request costs a
      // round trip, and the unique clamp on `publikations_id` would reject the
      // insert anyway.
      const bekannt =
        gefunden.length === 0
          ? new Set<string>()
          : new Set(
              (
                (await meldungen.readByQuery({
                  filter: {
                    publikations_id: {
                      _in: gefunden.map((f) => f.projekt.publicationId)
                    }
                  },
                  fields: ['publikations_id'],
                  limit: -1
                })) as { publikations_id: string }[]
              ).map((z) => z.publikations_id)
            )

      for (const { projekt, gemeinde } of gefunden) {
        if (bekannt.has(projekt.publicationId)) continue
        // The facts come at collection time, not on a click: the volume is a
        // handful a week, the tender deadline lives only in the detail, and a
        // filled row means "Meldung schreiben" works on the first press.
        let detail: unknown | null = null
        try {
          detail = await fetchDetail(projekt.id, projekt.publicationId, abruf)
        } catch (fehler) {
          // The row still goes on the desk; the endpoint refetches on demand.
          logger.warn(
            fehler,
            `simap: Angaben zu ${projekt.publicationId} nicht geholt`
          )
        }
        const bisher = simapJeGemeinde.get(gemeinde.id) ?? []
        bisher.push(baueSimapZeile(projekt, gemeinde, detail))
        simapJeGemeinde.set(gemeinde.id, bisher)
      }
    } catch (fehler) {
      const grund =
        fehler instanceof Error ? fehler.message : 'Unbekannter Fehler'
      logger.warn(fehler, 'simap.ch fehlgeschlagen.')
      ergebnis.fehler.push(`simap.ch: ${grund}`)
    }

    let planBudgetRest = planBudget

    for (const gemeinde of gemeinden) {
      ergebnis.gemeinden += 1
      const plz = gemeinde.plz ?? []
      // Without a postcode the SHAB half of this municipality is invisible.
      // Named rather than logged: an absence is otherwise indistinguishable
      // from "nothing was published".
      if (plz.length === 0) ergebnis.ohnePlz.push(gemeinde.name)

      // What simap found for this municipality, collected above. Insert it
      // alongside the gazette's rows so ONE triage call judges the day's news
      // for this municipality, whichever door it came through.
      const beschaffungen = simapJeGemeinde.get(gemeinde.id) ?? []

      try {
        const treffer = await fetchPublikationen(
          { bfsNummer: gemeinde.bfs_nummer, plz },
          tageZurueck(nachlauf),
          abruf
        )

        const bekannt =
          treffer.length === 0
            ? new Set<string>()
            : new Set(
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
        // Nothing new from either source — the next municipality. Checked
        // AFTER simap, or a municipality whose only news is a tender would
        // never be triaged.
        if (neue.length === 0 && beschaffungen.length === 0) continue

        const angelegt: { id: string; zeile: TriageZeile }[] = []
        for (const t of neue) {
          try {
            const id = (await meldungen.createOne({
              publikations_id: t.id,
              quelle_typ: 'amtsblatt',
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
            angelegt.push({
              id,
              zeile: {
                id,
                titel: t.titel,
                rubrikName: t.rubrikName,
                gruppe: t.gruppe,
                amt: t.amt
              }
            })
            ergebnis.neu += 1
          } catch (fehler) {
            // A race with a parallel run, or one bad row — never the whole
            // municipality.
            logger.warn(fehler, `Publikation ${t.id} nicht angelegt.`)
          }
        }

        for (const werte of beschaffungen) {
          try {
            const id = (await meldungen.createOne(werte)) as string
            angelegt.push({
              id,
              zeile: {
                id,
                titel: werte.titel,
                rubrikName: werte.rubrik_name,
                gruppe: werte.gruppe,
                amt: werte.amt
              }
            })
            ergebnis.neu += 1
            ergebnis.beschaffungen += 1
          } catch (fehler) {
            logger.warn(
              fehler,
              `Beschaffung ${werte.publikations_id} nicht angelegt.`
            )
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

        const zeilen: TriageZeile[] = angelegt.map(({ zeile }) => zeile)

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

    // One source row per adapter — the banner reads them, exactly as with the
    // agenda. Both are stamped, and the simap one carries only ITS errors: a
    // silent gazette and a silent procurement platform are different news, and
    // one banner blaming the other would send someone looking in the wrong place.
    const simapFehler = ergebnis.fehler.filter((f) => f.startsWith('simap.ch'))
    const portalFehler = ergebnis.fehler.filter(
      (f) => !f.startsWith('simap.ch')
    )
    const jetzt = new Date().toISOString()

    for (const [typ, fehler] of [
      ['amtsblatt', portalFehler],
      ['simap', simapFehler]
    ] as const) {
      const quelle = (await quellen.readByQuery({
        filter: { typ: { _eq: typ } },
        fields: ['id'],
        limit: 1
      })) as { id: string }[]
      const quelleId = quelle[0]?.id
      if (quelleId === undefined) continue
      await quellen.updateOne(quelleId, {
        letzte_pruefung: jetzt,
        letzter_fehler:
          fehler.length === 0 ? null : fehler.join(' · ').slice(0, 1000)
      })
    }

    return ergebnis
  }
})
