import {
  crawlerKonfiguriert,
  holeUeberCrawler
} from '../../shared/crawler/fallback'
import { defineOperationApi } from '@directus/extensions-sdk'
import { optionalEnv } from '../../shared/env'
import {
  ANHAENGE_MAX,
  ANHANG_MAX_BYTES,
  DETAILS_JE_HOST,
  detailFamilie,
  ERSTLAUF_TAGE,
  erstelleLeser,
  fensterSeit,
  heuteAus,
  kandidaten,
  ohneDatumHinweis,
  leseUebersicht,
  liesMitteilung,
  NACHLAUF_TAGE,
  STANDARD_PAUSE_MS,
  terminKandidaten,
  VERANSTALTUNGS_FENSTER_TAGE,
  verteileDetailbudget,
  zeileAus,
  type ListenEintrag,
  type Plattform
} from '../../shared/gemeindeseite'
import {
  gruppiereAnlaesse,
  liesAnlass,
  naechsterTermin,
  VORSCHLAGSFENSTER_TAGE
} from '../../shared/veranstaltung'
import { heuteIso } from '../../redaktion/feiertage'
import { ladeRegeln } from '../../redaktion/gedaechtnis'
import {
  raeumeMitteilungenAuf,
  sichteMitteilungen,
  type ZeileFuerSichtung
} from '../../redaktion/gemeindeseitenlauf'
import {
  regelnBlock,
  SICHTUNGSREGELN_UEBERSCHRIFT
} from '../../redaktion/lernen'
import {
  brauchtDetail,
  dauerangeboteHeute,
  detailPayload,
  ladeBekannteSerien,
  raeumeAnlaesseAuf,
  schreibeAnlaesse,
  sichteAnlaesse,
  sichtungsKandidat,
  type GeschriebenerAnlass
} from '../../redaktion/veranstaltungslauf'
import type { Anker, VeranstaltungsquelleArt } from '../../types/schema'

// The 13:00 look at the municipalities' own websites: the news page and the
// events calendars.
//
// Per municipality with a registered news page: read the overview, recognise
// the template from the HTML (never from the host — the newsroom's rule is
// that a rule holds for a kind of page, not for one municipality), keep the
// entries inside the window, open every new one — the detail page and the
// same-site PDFs it links — store it whole, then ONE Sichtung call over the
// new items.
//
// Per calendar the municipality has registered (`veranstaltungsquellen`; its
// own site's today, platforms later): read the list, fold the rows into
// ANLÄSSE by series key, compute each one's ANCHOR by code — what could make
// it a Meldung today — upsert the rows, open the detail page of what is
// anchored inside the proposal window, put one Dauerangebot a week on the
// desk, then ONE Sichtung call per municipality over the anchored Anlässe.
// A calendar's failures and caps land on the calendar's own status line, the
// news page's on the municipality's.
//
// One reader for both, because they sit on the same host: same identified
// User-Agent, sequential requests, one pause per host that robots.txt can
// lengthen, robots.txt honoured, redirects only within the site, ONE detail
// budget per host across news and calendar handed out by distance from
// today (`verteileDetailbudget`).
//
// No Meldung is written here. Every article on these feeds starts with a
// person's decision.

interface Optionen {
  gemeinden?: number
  details?: number
  nachlauf?: number
  erstlauf?: number
  pause?: number
  /** How far ahead the events window reaches, in days. */
  vorlauf?: number
  /** How many days before its anchor an Anlass reaches the desk. */
  vorschlag?: number
  model?: string | null
}

interface Ergebnis {
  gemeinden: number
  /** Active municipalities without a registered news page — named, not logged. */
  ohneUrl: string[]
  /** Active municipalities without an active calendar — the same, for the desk next door. */
  ohneKalender: string[]
  /** Calendars read (art gemeinde, active). */
  quellen: number
  /** Registered calendars nobody can read yet (art plattform/ort) — declared, never silent. */
  ohneLeser: string[]
  erstlaeufe: string[]
  neu: number
  detailsGelesen: number
  anhaengeGelesen: number
  vorschlaege: number
  weitergereicht: number
  /** The declared cap on the news side: municipalities whose new entries outnumbered the detail budget. */
  nichtGelesen: { gemeinde: string; anzahl: number }[]
  /** Undated list entries — never opened; `ohneDatum` names them. */
  uebersprungen: number
  ohneDatum: { gemeinde: string; anzahl: number; beispiele: string[] }[]
  aufgeraeumt: { geloescht: number; verfallen: number }
  /** Anlässe seen in this run's window, upserted. */
  anlaesse: number
  anlaesseNeu: number
  /** How many Anlässe carry which anchor after this run. */
  ankerJeArt: Partial<Record<Anker, number>>
  /** Waste dates the calendars carry — counted, never stored: they live on the Entsorgung desk. */
  abfuhrenUebersprungen: number
  /** Anchored Anlässe whose detail page the host budget left for tomorrow. */
  verankertNichtGelesen: { gemeinde: string; anzahl: number }[]
  anlaesseGelesen: number
  anlaesseVorschlaege: number
  anlaesseWeitergereicht: number
  dauerangeboteVorgelegt: number
  dauerangeboteWarten: number
  aufgeraeumtAnlaesse: { geloescht: number; verfallen: number }
  anfragen: number
  /** Hosts that asked for spacing (429/503) — the reader slowed down, the run says where. */
  gebremst: string[]
  /** Hosts a page came from through the crawler after the direct read failed. */
  ueberCrawler: string[]
  fehler: string[]
  /** Declared caps — the run read the page and says what it left for tomorrow. */
  hinweise: string[]
}

interface GemeindeZeile {
  id: string
  name: string
  news_url: string | null
}

interface QuellenZeile {
  id: string
  gemeinde: string
  name: string
  url: string
  art: VeranstaltungsquelleArt
  plattform: string | null
  aktiv: boolean
}

function fehlerText(error: unknown): string {
  return error instanceof Error ? error.message : 'Unbekannter Fehler'
}

export default defineOperationApi<Optionen>({
  id: 'gemeindeseiten-pruefen',
  handler: async (optionen, { services, getSchema, logger }) => {
    const { ItemsService } = services
    const schema = await getSchema()
    const hoechstens = Math.max(1, optionen.gemeinden ?? 20)
    const details = Math.max(1, optionen.details ?? DETAILS_JE_HOST)
    const nachlauf = Math.max(1, optionen.nachlauf ?? NACHLAUF_TAGE)
    const erstlaufTage = Math.max(1, optionen.erstlauf ?? ERSTLAUF_TAGE)
    const pauseMs = Math.max(0, optionen.pause ?? STANDARD_PAUSE_MS)
    const vorlaufTage = Math.max(
      1,
      optionen.vorlauf ?? VERANSTALTUNGS_FENSTER_TAGE
    )
    const vorschlagTage = Math.max(
      0,
      optionen.vorschlag ?? VORSCHLAGSFENSTER_TAGE
    )
    const kontakt = optionalEnv('AGENDA_KONTAKT', 'it@bajour.ch')
    const heute = heuteIso()
    const heuteObj = heuteAus(heute)

    const gemeindenService = new ItemsService('gemeinden', { schema })
    const mitteilungen = new ItemsService('gemeindemitteilungen', { schema })
    const anlaesse = new ItemsService('veranstaltungen', { schema })
    const quellenService = new ItemsService('veranstaltungsquellen', {
      schema
    })
    const faehrten = new ItemsService('recherchehinweise', { schema })
    const artikel = new ItemsService('meldungen', { schema })
    const termine = new ItemsService('entsorgungstermine', { schema })
    const kalender = new ItemsService('entsorgungskalender', { schema })
    const wissen = new ItemsService('redaktionswissen', { schema })

    const warnung = { warn: (m: string) => logger.warn(m) }
    const regelzeilen = await ladeRegeln(
      wissen,
      { bereich: 'gemeinde', stufe: 'sichtung' },
      warnung
    )
    const sichtungsregeln = regelnBlock(
      regelzeilen,
      SICHTUNGSREGELN_UEBERSCHRIFT
    )
    const anlassRegelzeilen = await ladeRegeln(
      wissen,
      { bereich: 'veranstaltung', stufe: 'sichtung' },
      warnung
    )
    const anlassRegeln = regelnBlock(
      anlassRegelzeilen,
      SICHTUNGSREGELN_UEBERSCHRIFT
    )

    const ergebnis: Ergebnis = {
      gemeinden: 0,
      ohneUrl: [],
      ohneKalender: [],
      quellen: 0,
      ohneLeser: [],
      erstlaeufe: [],
      neu: 0,
      detailsGelesen: 0,
      anhaengeGelesen: 0,
      vorschlaege: 0,
      weitergereicht: 0,
      nichtGelesen: [],
      uebersprungen: 0,
      ohneDatum: [],
      aufgeraeumt: { geloescht: 0, verfallen: 0 },
      anlaesse: 0,
      anlaesseNeu: 0,
      ankerJeArt: {},
      abfuhrenUebersprungen: 0,
      verankertNichtGelesen: [],
      anlaesseGelesen: 0,
      anlaesseVorschlaege: 0,
      anlaesseWeitergereicht: 0,
      dauerangeboteVorgelegt: 0,
      dauerangeboteWarten: 0,
      aufgeraeumtAnlaesse: { geloescht: 0, verfallen: 0 },
      anfragen: 0,
      gebremst: [],
      ueberCrawler: [],
      fehler: [],
      hinweise: []
    }

    try {
      ergebnis.aufgeraeumt = await raeumeMitteilungenAuf(
        mitteilungen,
        heute,
        nachlauf + 1,
        logger
      )
    } catch (fehler) {
      logger.warn(fehler, 'gemeindeseiten: Aufraeumen fehlgeschlagen.')
    }
    try {
      ergebnis.aufgeraeumtAnlaesse = await raeumeAnlaesseAuf(
        anlaesse,
        heute,
        logger
      )
    } catch (fehler) {
      logger.warn(fehler, 'veranstaltungen: Aufraeumen fehlgeschlagen.')
    }

    const alleAktiven = (await gemeindenService.readByQuery({
      filter: { aktiv: { _eq: true } },
      fields: ['id', 'name', 'news_url'],
      sort: ['name'],
      limit: -1
    })) as GemeindeZeile[]
    const alleQuellen = (await quellenService.readByQuery({
      filter: { gemeinde: { aktiv: { _eq: true } } },
      fields: ['id', 'gemeinde', 'name', 'url', 'art', 'plattform', 'aktiv'],
      sort: ['name'],
      limit: -1
    })) as QuellenZeile[]
    const quellenJeGemeinde = new Map<string, QuellenZeile[]>()
    for (const q of alleQuellen) {
      const liste = quellenJeGemeinde.get(q.gemeinde)
      if (liste === undefined) quellenJeGemeinde.set(q.gemeinde, [q])
      else liste.push(q)
    }

    const hatAdresse = (wert: string | null): boolean =>
      wert !== null && wert.trim() !== ''
    ergebnis.ohneUrl = alleAktiven
      .filter((g) => !hatAdresse(g.news_url))
      .map((g) => g.name)
    ergebnis.ohneKalender = alleAktiven
      .filter(
        (g) =>
          !(quellenJeGemeinde.get(g.id) ?? []).some(
            (q) => q.aktiv && q.art === 'gemeinde'
          )
      )
      .map((g) => g.name)
    ergebnis.ohneLeser = alleQuellen
      .filter((q) => q.art !== 'gemeinde')
      .map((q) => q.name)
    const mitArbeit = alleAktiven.filter(
      (g) =>
        hatAdresse(g.news_url) ||
        (quellenJeGemeinde.get(g.id) ?? []).some((q) => q.aktiv)
    )
    const gemeinden = mitArbeit.slice(0, hoechstens)
    if (mitArbeit.length > hoechstens) {
      ergebnis.fehler.push(
        `Gemeindeseiten: ${mitArbeit.length - hoechstens} Gemeinden in diesem Lauf nicht gelesen (Deckel ${hoechstens}): ${mitArbeit
          .slice(hoechstens)
          .map((g) => g.name)
          .join(', ')}`
      )
    }

    // The second door: only where the direct read fails, only for pages —
    // see shared/crawler/fallback.ts for the newsroom's decision.
    const leser = erstelleLeser({
      kontakt,
      pauseMs,
      crawler: crawlerKonfiguriert() ? holeUeberCrawler : null
    })

    for (const gemeinde of gemeinden) {
      ergebnis.gemeinden += 1
      const eigeneFehler: string[] = []
      // Two lines, two meanings. A failure says the page could not be read; a
      // hint says it WAS read and a declared cap bit.
      const eigeneHinweise: string[] = []
      const angelegt: ZeileFuerSichtung[] = []

      // ---- phase one: the news overview -----------------------------------
      let news: {
        site: string
        plattform: Plattform
        neue: ListenEintrag[]
      } | null = null
      if (hatAdresse(gemeinde.news_url)) {
        const url = gemeinde.news_url ?? ''
        try {
          const site = new URL(url).hostname
          const uebersicht = await leseUebersicht(
            leser,
            url,
            heuteObj,
            'nachricht'
          )
          const [vorhanden] = (await mitteilungen.readByQuery({
            filter: {
              gemeinde: { _eq: gemeinde.id },
              quelle_seite: { _eq: url }
            },
            fields: ['id'],
            limit: 1
          })) as Array<{ id: string }>
          const erstlauf = vorhanden === undefined
          if (erstlauf) ergebnis.erstlaeufe.push(gemeinde.name)
          const seit = fensterSeit(heute, erstlauf, nachlauf, erstlaufTage)
          const { drin, undatiert } = kandidaten(uebersicht.eintraege, seit)
          ergebnis.uebersprungen += undatiert.length
          if (undatiert.length > 0) {
            ergebnis.ohneDatum.push({
              gemeinde: gemeinde.name,
              anzahl: undatiert.length,
              beispiele: undatiert.slice(0, 5).map((e) => e.titel)
            })
            if (undatiert.length === uebersicht.eintraege.length)
              eigeneFehler.push(ohneDatumHinweis(undatiert))
          }
          const bekannt =
            drin.length === 0
              ? new Set<string>()
              : new Set(
                  (
                    (await mitteilungen.readByQuery({
                      filter: { url: { _in: drin.map((e) => e.url) } },
                      fields: ['url'],
                      limit: -1
                    })) as Array<{ url: string }>
                  ).map((z) => z.url)
                )
          news = {
            site,
            plattform: uebersicht.plattform,
            neue: drin.filter((e) => !bekannt.has(e.url))
          }
        } catch (fehler) {
          logger.warn(
            fehler,
            `gemeindeseiten: ${gemeinde.name} fehlgeschlagen.`
          )
          eigeneFehler.push(fehlerText(fehler))
        }
      }

      // ---- phase one, calendars: rows → Anlässe → anchors ------------------
      const kalenderArbeit: Array<{
        quelle: QuellenZeile
        site: string
        plattform: Plattform
        erstlauf: boolean
        geschrieben: GeschriebenerAnlass[]
        fehler: string[]
        hinweise: string[]
      }> = []
      for (const quelle of quellenJeGemeinde.get(gemeinde.id) ?? []) {
        if (!quelle.aktiv) continue
        if (quelle.art !== 'gemeinde') {
          // Registered, declared, not read: the reader for platforms and
          // venues is not built yet, and the row says so instead of
          // pretending.
          await quellenService
            .updateOne(quelle.id, {
              letzte_pruefung: new Date().toISOString(),
              letzter_fehler: null,
              letzter_hinweis:
                'Plattform-Kalender: noch kein Leser — die Zeile wird gezaehlt, nicht gelesen.'
            })
            .catch((fehler: unknown) =>
              logger.warn(fehler, 'veranstaltungen: Status nicht gespeichert.')
            )
          continue
        }
        ergebnis.quellen += 1
        const fehlerQ: string[] = []
        const hinweiseQ: string[] = []
        try {
          const site = new URL(quelle.url).hostname
          const uebersicht = await leseUebersicht(
            leser,
            quelle.url,
            heuteObj,
            'termin'
          )
          const { drin, undatiert } = terminKandidaten(
            uebersicht.eintraege,
            heute,
            vorlaufTage
          )
          if (
            undatiert.length > 0 &&
            undatiert.length === uebersicht.eintraege.length
          )
            fehlerQ.push(ohneDatumHinweis(undatiert))
          const bekannt = await ladeBekannteSerien(anlaesse, quelle.id)
          const erstlauf = bekannt.size === 0
          const gruppen = gruppiereAnlaesse(drin)
          const { geschrieben, abfuhren } = await schreibeAnlaesse(
            anlaesse,
            {
              id: quelle.id,
              gemeinde: { id: gemeinde.id, name: gemeinde.name },
              plattform: uebersicht.plattform
            },
            gruppen,
            bekannt,
            heute,
            heuteObj,
            erstlauf,
            logger
          )
          ergebnis.abfuhrenUebersprungen += abfuhren
          ergebnis.anlaesse += geschrieben.length
          ergebnis.anlaesseNeu += geschrieben.filter(
            (g) => g.vorher === null
          ).length
          for (const g of geschrieben)
            ergebnis.ankerJeArt[g.befund.anker] =
              (ergebnis.ankerJeArt[g.befund.anker] ?? 0) + 1
          kalenderArbeit.push({
            quelle,
            site,
            plattform: uebersicht.plattform,
            erstlauf,
            geschrieben,
            fehler: fehlerQ,
            hinweise: hinweiseQ
          })
        } catch (fehler) {
          logger.warn(
            fehler,
            `veranstaltungen: ${gemeinde.name} — ${quelle.name} fehlgeschlagen.`
          )
          fehlerQ.push(fehlerText(fehler))
          kalenderArbeit.push({
            quelle,
            site: '',
            plattform: 'weblication_termine',
            erstlauf: false,
            geschrieben: [],
            fehler: fehlerQ,
            hinweise: hinweiseQ
          })
        }
      }

      // ---- phase two: ONE detail budget for this host --------------------
      // News rows and anchored Anlässe compete for it by distance from today,
      // never by a fixed order — news first loses tomorrow's event to a
      // notice from the day before yesterday, events first loses today's
      // news to a Christmas market in November.
      const anlassKandidaten = kalenderArbeit.flatMap((k) =>
        k.geschrieben
          .filter((g) => brauchtDetail(g, heute, vorschlagTage))
          .map((g) => {
            const termin =
              naechsterTermin(g.anlass.termine, heute) ?? g.anlass.von
            const eintrag =
              g.anlass.eintraege.find((e) => e.veranstaltungAm === termin) ??
              g.anlass.eintraege[0]
            return { k, g, eintrag: eintrag as ListenEintrag }
          })
      )
      const auswahl = verteileDetailbudget(
        [
          { art: 'nachricht' as const, neue: news?.neue ?? [] },
          {
            art: 'termin' as const,
            neue: anlassKandidaten.map((a) => a.eintrag)
          }
        ],
        heute,
        details
      )
      const [newsAnteil, anlassAnteil] = auswahl
      if (newsAnteil !== undefined && newsAnteil.nichtGelesen > 0) {
        ergebnis.nichtGelesen.push({
          gemeinde: gemeinde.name,
          anzahl: newsAnteil.nichtGelesen
        })
        eigeneHinweise.push(
          `${newsAnteil.nichtGelesen} weitere neue Mitteilungen nicht gelesen (Deckel ${details} pro Gemeinde und Lauf) — morgen weiter`
        )
      }
      if (anlassAnteil !== undefined && anlassAnteil.nichtGelesen > 0) {
        ergebnis.verankertNichtGelesen.push({
          gemeinde: gemeinde.name,
          anzahl: anlassAnteil.nichtGelesen
        })
        for (const k of kalenderArbeit)
          k.hinweise.push(
            `${anlassAnteil.nichtGelesen} Anlaesse mit Anker noch nicht im Detail gelesen (Deckel ${details} je Host und Lauf) — morgen weiter`
          )
      }

      // News details, as before.
      if (news !== null && newsAnteil !== undefined) {
        for (const eintrag of newsAnteil.zuLesen) {
          try {
            const gelesen = await liesMitteilung(
              leser,
              eintrag,
              detailFamilie(news.plattform),
              news.site,
              heuteObj,
              { anhaengeMax: ANHAENGE_MAX, anhangMaxBytes: ANHANG_MAX_BYTES }
            )
            const zeile = zeileAus({
              eintrag,
              detail: gelesen.detail,
              pdf: gelesen.pdf,
              anhaenge: gelesen.anhaenge,
              transport: gelesen.transport,
              gemeindeId: gemeinde.id,
              quelleSeite: gemeinde.news_url ?? '',
              plattform: news.plattform,
              gelesenAm: new Date().toISOString()
            })
            const id = (await mitteilungen.createOne(zeile)) as string
            angelegt.push({
              id,
              titel: zeile.titel,
              teaser: zeile.teaser,
              text: zeile.text,
              publiziert_am: zeile.publiziert_am,
              kategorie: zeile.kategorie,
              text_abgeschnitten: zeile.text_abgeschnitten,
              anhaenge: zeile.anhaenge,
              veranstaltung_am: zeile.veranstaltung_am
            })
            ergebnis.neu += 1
            ergebnis.detailsGelesen += 1
            ergebnis.anhaengeGelesen += zeile.anhaenge.filter(
              (a) => a.gelesen
            ).length
          } catch (fehler) {
            const grund = fehlerText(fehler)
            logger.warn(
              fehler,
              `gemeindeseiten: ${gemeinde.name} — ${eintrag.titel} nicht gelesen.`
            )
            if (!/unique|duplicate|RECORD_NOT_UNIQUE/i.test(grund))
              eigeneFehler.push(`"${eintrag.titel}": ${grund}`)
          }
        }
      }

      // Anlass details: once per Anlass, the agenda page of a Gremium too.
      if (anlassAnteil !== undefined) {
        const zuLesen = new Set(anlassAnteil.zuLesen.map((e) => e.url))
        for (const { k, g, eintrag } of anlassKandidaten) {
          if (!zuLesen.has(eintrag.url)) continue
          try {
            const gelesen = await liesAnlass(
              leser,
              {
                url: eintrag.url,
                termin: naechsterTermin(g.anlass.termine, heute)
              },
              detailFamilie(k.plattform),
              k.site,
              heuteObj,
              {
                gremium: g.befund.anker === 'gremium',
                anhaengeMax: ANHAENGE_MAX,
                anhangMaxBytes: ANHANG_MAX_BYTES
              }
            )
            const { payload, befund } = detailPayload(
              g,
              gelesen,
              gemeinde.name,
              heute,
              heuteObj,
              k.erstlauf
            )
            await anlaesse.updateOne(g.id, payload)
            if (befund.anker !== g.befund.anker) {
              ergebnis.ankerJeArt[g.befund.anker] = Math.max(
                0,
                (ergebnis.ankerJeArt[g.befund.anker] ?? 1) - 1
              )
              ergebnis.ankerJeArt[befund.anker] =
                (ergebnis.ankerJeArt[befund.anker] ?? 0) + 1
            }
            ergebnis.anlaesseGelesen += 1
            ergebnis.anhaengeGelesen += gelesen.anhaenge.filter(
              (a) => a.gelesen
            ).length
          } catch (fehler) {
            logger.warn(
              fehler,
              `veranstaltungen: ${gemeinde.name} — "${g.anlass.titel}" nicht gelesen.`
            )
            k.fehler.push(`"${g.anlass.titel}": ${fehlerText(fehler)}`)
          }
        }
      }

      // ---- Sichtung of the news page, one call ---------------------------
      if (angelegt.length > 0) {
        try {
          const sichtung = await sichteMitteilungen(angelegt, gemeinde, {
            mitteilungen,
            hinweise: faehrten,
            meldungen: artikel,
            termine,
            kalender,
            regelzeilen,
            sichtungsregeln,
            heute,
            logger,
            model: optionen.model ?? null
          })
          ergebnis.vorschlaege += sichtung.vorschlaege
          ergebnis.weitergereicht += sichtung.weitergereicht
          if (sichtung.fehler !== null)
            eigeneFehler.push(`Sichtung fehlgeschlagen: ${sichtung.fehler}`)
        } catch (fehler) {
          logger.warn(
            fehler,
            `gemeindeseiten: Sichtung fuer ${gemeinde.name} fehlgeschlagen.`
          )
          eigeneFehler.push(fehlerText(fehler))
        }
      }

      // ---- Sichtung of the calendars, one call per municipality ----------
      if (kalenderArbeit.some((k) => k.geschrieben.length > 0)) {
        try {
          const offene = (await anlaesse.readByQuery({
            filter: {
              gemeinde: { _eq: gemeinde.id },
              entscheid: { _eq: 'offen' }
            },
            fields: [
              'id',
              'anker',
              'anker_am',
              'vorschlag',
              'entscheid',
              'zuletzt_vorgelegt_am',
              'dauerangebot'
            ],
            limit: -1
          })) as Array<{
            id: string
            anker: Anker | null
            anker_am: string | null
            vorschlag: boolean | null
            entscheid: string
            zuletzt_vorgelegt_am: string | null
            dauerangebot: 'intervall' | 'nie' | null
          }>
          const kandidatenIds = offene
            .filter((z) => sichtungsKandidat(z, heute, vorschlagTage))
            .map((z) => z.id)

          // The Dauerangebot dose: one routine a week, the longest-waiting
          // first, the rest counted for the result.
          const dosis = dauerangeboteHeute(
            offene.filter((z) => z.anker === 'routine'),
            heute
          )
          ergebnis.dauerangeboteWarten += dosis.warten
          for (const id of dosis.vorgelegt) {
            await anlaesse.updateOne(id, {
              anker: 'dauerangebot',
              anker_am: heute,
              anker_grund:
                'Routine, als Dauerangebot vorgelegt — die Redaktion entscheidet einmal, ob es alle sechs Monate wiederkommt.',
              zuletzt_vorgelegt_am: heute,
              vorschlag: null,
              vorschlag_begruendung: null
            })
            ergebnis.dauerangeboteVorgelegt += 1
            kandidatenIds.push(id)
          }
          for (const z of offene)
            if (kandidatenIds.includes(z.id) && z.anker !== 'routine')
              await anlaesse.updateOne(z.id, { zuletzt_vorgelegt_am: heute })

          const sichtung = await sichteAnlaesse(kandidatenIds, gemeinde, {
            anlaesse,
            mitteilungen,
            hinweise: faehrten,
            meldungen: artikel,
            regelzeilen: anlassRegelzeilen,
            sichtungsregeln: anlassRegeln,
            heute,
            logger,
            model: optionen.model ?? null
          })
          ergebnis.anlaesseVorschlaege += sichtung.vorschlaege
          ergebnis.anlaesseWeitergereicht += sichtung.weitergereicht
          if (sichtung.fehler !== null)
            for (const k of kalenderArbeit)
              k.fehler.push(`Sichtung fehlgeschlagen: ${sichtung.fehler}`)
        } catch (fehler) {
          logger.warn(
            fehler,
            `veranstaltungen: Sichtung fuer ${gemeinde.name} fehlgeschlagen.`
          )
          for (const k of kalenderArbeit) k.fehler.push(fehlerText(fehler))
        }
      }

      // ---- status lines --------------------------------------------------
      // The news page's on the municipality, each calendar's on its own row:
      // an absence is never silence, and a failed calendar never paints the
      // news page orange.
      try {
        await gemeindenService.updateOne(gemeinde.id, {
          news_letzte_pruefung: new Date().toISOString(),
          news_letzter_fehler:
            eigeneFehler.length === 0
              ? null
              : eigeneFehler.join(' · ').slice(0, 1000),
          news_letzter_hinweis:
            eigeneHinweise.length === 0
              ? null
              : eigeneHinweise.join(' · ').slice(0, 1000)
        })
      } catch (fehler) {
        logger.warn(
          fehler,
          `gemeindeseiten: Status von ${gemeinde.name} nicht gespeichert.`
        )
      }
      for (const k of kalenderArbeit) {
        try {
          await quellenService.updateOne(k.quelle.id, {
            letzte_pruefung: new Date().toISOString(),
            ...(k.site === '' ? {} : { plattform: k.plattform }),
            letzter_fehler:
              k.fehler.length === 0
                ? null
                : k.fehler.join(' · ').slice(0, 1000),
            letzter_hinweis:
              k.hinweise.length === 0
                ? null
                : k.hinweise.join(' · ').slice(0, 1000)
          })
        } catch (fehler) {
          logger.warn(
            fehler,
            `veranstaltungen: Status von ${k.quelle.name} nicht gespeichert.`
          )
        }
        for (const f of k.fehler) ergebnis.fehler.push(`${k.quelle.name}: ${f}`)
        for (const h of k.hinweise)
          ergebnis.hinweise.push(`${k.quelle.name}: ${h}`)
      }
      for (const f of eigeneFehler)
        ergebnis.fehler.push(`${gemeinde.name}: ${f}`)
      for (const h of eigeneHinweise)
        ergebnis.hinweise.push(`${gemeinde.name}: ${h}`)
    }

    const protokoll = leser.protokoll()
    ergebnis.anfragen = protokoll.anfragen
    ergebnis.gebremst = protokoll.gebremst
    ergebnis.ueberCrawler = protokoll.ueberCrawler
    return ergebnis
  }
})
