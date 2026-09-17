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
  waehleZuLesen,
  zeileAus,
  type ListenEintrag
} from '../../shared/gemeindeseite'
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

// The 13:00 look at the municipalities' own news pages.
//
// Per municipality with a registered page: read the overview, recognise the
// template from the HTML (never from the host — the newsroom's rule is that a
// rule holds for a kind of page, not for one municipality), keep the entries
// inside the window, open every new one — the detail page and the same-site
// PDFs it links — store it whole, then ONE Sichtung call over the new items.
//
// A first read of a page imports the last week, never the archive: three of
// the nine pages list their whole history on one page. A daily read looks
// back three days. Detail pages per host are capped and the cap is declared,
// in the result and on the municipality's own error line.
//
// Politeness is the reader's job (`shared/gemeindeseite`): one identified
// User-Agent, sequential requests, a pause per host that robots.txt can
// lengthen, robots.txt honoured, redirects only within the site.
//
// No Meldung is written here. Every article on this feed starts with a person's
// decision.

interface Optionen {
  gemeinden?: number
  details?: number
  nachlauf?: number
  erstlauf?: number
  pause?: number
  model?: string | null
}

interface Ergebnis {
  gemeinden: number
  /** Active municipalities without a registered page — named, not logged. */
  ohneUrl: string[]
  erstlaeufe: string[]
  neu: number
  detailsGelesen: number
  anhaengeGelesen: number
  vorschlaege: number
  weitergereicht: number
  /** The declared cap: municipalities whose new entries outnumbered the detail budget. */
  nichtGelesen: { gemeinde: string; anzahl: number }[]
  /** Undated list entries — never opened; `ohneDatum` names them. */
  uebersprungen: number
  /** Per municipality: how many entries carried no readable date, with the first titles. */
  ohneDatum: { gemeinde: string; anzahl: number; beispiele: string[] }[]
  aufgeraeumt: { geloescht: number; verfallen: number }
  anfragen: number
  /** Hosts that asked for spacing (429/503) — the reader slowed down, the run says where. */
  gebremst: string[]
  /** Hosts a page came from through the crawler after the direct read failed. */
  ueberCrawler: string[]
  fehler: string[]
}

interface GemeindeZeile {
  id: string
  name: string
  news_url: string | null
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
    const kontakt = optionalEnv('AGENDA_KONTAKT', 'it@bajour.ch')
    const heute = heuteIso()
    const heuteObj = heuteAus(heute)

    const gemeindenService = new ItemsService('gemeinden', { schema })
    const mitteilungen = new ItemsService('gemeindemitteilungen', { schema })
    const faehrten = new ItemsService('recherchehinweise', { schema })
    const artikel = new ItemsService('meldungen', { schema })
    const termine = new ItemsService('entsorgungstermine', { schema })
    const kalender = new ItemsService('entsorgungskalender', { schema })

    const regelzeilen = await ladeRegeln(
      new ItemsService('redaktionswissen', { schema }),
      { bereich: 'gemeinde', stufe: 'sichtung' },
      { warn: (m: string) => logger.warn(m) }
    )
    const sichtungsregeln = regelnBlock(
      regelzeilen,
      SICHTUNGSREGELN_UEBERSCHRIFT
    )

    const ergebnis: Ergebnis = {
      gemeinden: 0,
      ohneUrl: [],
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
      anfragen: 0,
      gebremst: [],
      ueberCrawler: [],
      fehler: []
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

    const alleAktiven = (await gemeindenService.readByQuery({
      filter: { aktiv: { _eq: true } },
      fields: ['id', 'name', 'news_url'],
      sort: ['name'],
      limit: -1
    })) as GemeindeZeile[]
    ergebnis.ohneUrl = alleAktiven
      .filter((g) => g.news_url === null || g.news_url.trim() === '')
      .map((g) => g.name)
    const mitUrl = alleAktiven.filter(
      (g) => g.news_url !== null && g.news_url.trim() !== ''
    )
    const gemeinden = mitUrl.slice(0, hoechstens)
    if (mitUrl.length > hoechstens) {
      ergebnis.fehler.push(
        `Gemeindeseiten: ${mitUrl.length - hoechstens} Gemeinden in diesem Lauf nicht gelesen (Deckel ${hoechstens}): ${mitUrl
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
      const newsUrl = gemeinde.news_url as string
      const eigeneFehler: string[] = []

      try {
        const site = new URL(newsUrl).hostname
        const uebersicht = await leseUebersicht(leser, newsUrl, heuteObj)

        const [vorhanden] = (await mitteilungen.readByQuery({
          filter: { gemeinde: { _eq: gemeinde.id } },
          fields: ['id'],
          limit: 1
        })) as Array<{ id: string }>
        const erstlauf = vorhanden === undefined
        if (erstlauf) ergebnis.erstlaeufe.push(gemeinde.name)
        const seit = fensterSeit(heute, erstlauf, nachlauf, erstlaufTage)

        const { drin, undatiert } = kandidaten(uebersicht.eintraege, seit)
        ergebnis.uebersprungen += undatiert.length
        if (undatiert.length > 0) {
          // Declared in the result by title — and on the municipality's status
          // line only when NO entry of the page carries a date: that is a
          // parser gap or a page we cannot follow. One standing notice among
          // dated news (Reinach lists its permanent speed-check page there) is
          // not worth an alert on the desk every day.
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
        const neue: ListenEintrag[] = drin.filter((e) => !bekannt.has(e.url))
        const { zuLesen, nichtGelesen } = waehleZuLesen(neue, details)
        if (nichtGelesen > 0) {
          ergebnis.nichtGelesen.push({
            gemeinde: gemeinde.name,
            anzahl: nichtGelesen
          })
          eigeneFehler.push(
            `${nichtGelesen} weitere neue Eintraege nicht gelesen (Deckel ${details}) — morgen weiter`
          )
        }

        const angelegt: ZeileFuerSichtung[] = []
        for (const eintrag of zuLesen) {
          try {
            const gelesen = await liesMitteilung(
              leser,
              eintrag,
              detailFamilie(uebersicht.plattform),
              site,
              heuteObj,
              {
                anhaengeMax: ANHAENGE_MAX,
                anhangMaxBytes: ANHANG_MAX_BYTES
              }
            )
            const zeile = zeileAus({
              eintrag,
              detail: gelesen.detail,
              pdf: gelesen.pdf,
              anhaenge: gelesen.anhaenge,
              transport: gelesen.transport,
              gemeindeId: gemeinde.id,
              quelleSeite: newsUrl,
              plattform: uebersicht.plattform,
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
              anhaenge: zeile.anhaenge
            })
            ergebnis.neu += 1
            ergebnis.detailsGelesen += 1
            ergebnis.anhaengeGelesen += zeile.anhaenge.filter(
              (a) => a.gelesen
            ).length
          } catch (fehler) {
            // A failed page is not stored, so tomorrow retries it; a race with
            // a parallel run (unique url) is a warning, never the municipality's.
            const grund = fehlerText(fehler)
            logger.warn(
              fehler,
              `gemeindeseiten: ${gemeinde.name} — ${eintrag.titel} nicht gelesen.`
            )
            if (!/unique|duplicate|RECORD_NOT_UNIQUE/i.test(grund))
              eigeneFehler.push(`"${eintrag.titel}": ${grund}`)
          }
        }

        if (angelegt.length > 0) {
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
        }
      } catch (fehler) {
        logger.warn(fehler, `gemeindeseiten: ${gemeinde.name} fehlgeschlagen.`)
        eigeneFehler.push(fehlerText(fehler))
      }

      // The municipality's own status line — the desk and the Gemeinden card
      // read it, so an absence is never silence.
      try {
        await gemeindenService.updateOne(gemeinde.id, {
          news_letzte_pruefung: new Date().toISOString(),
          news_letzter_fehler:
            eigeneFehler.length === 0
              ? null
              : eigeneFehler.join(' · ').slice(0, 1000)
        })
      } catch (fehler) {
        logger.warn(
          fehler,
          `gemeindeseiten: Status von ${gemeinde.name} nicht gespeichert.`
        )
      }
      for (const f of eigeneFehler)
        ergebnis.fehler.push(`${gemeinde.name}: ${f}`)
    }

    const protokoll = leser.protokoll()
    ergebnis.anfragen = protokoll.anfragen
    ergebnis.gebremst = protokoll.gebremst
    ergebnis.ueberCrawler = protokoll.ueberCrawler
    return ergebnis
  }
})
