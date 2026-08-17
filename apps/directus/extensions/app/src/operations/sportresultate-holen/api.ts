import { defineOperationApi } from '@directus/extensions-sdk'
import { CrawlerFehler, scrape, WHATS_ON_URL } from '../../shared/crawler'
import {
  istInteressant,
  ordneVereinZu,
  parseWhatsOn
} from '../../shared/matchcenter/parse'
import { parseGameCenter } from '../../shared/swissvolley/parse'
import { parseHandball } from '../../shared/handball/parse'

// Reads the Match Center once a day and records what our clubs are playing.
//
// One request covers every football club: the "what's on" page lists the whole
// association's fixtures, so this does not scale with the number of clubs we
// follow. Everything else — which club a match belongs to, whether the match is
// worth reporting — is decided locally against our own data, without a model.
//
// Idempotent by construction: `spielnummer` is unique, so a fixture seen on
// five consecutive days is inserted once and then only updated when something
// about it actually changed (a score appears, a match is postponed).

interface Optionen {
  hoechstens?: number
}

interface VereinZeile {
  id: string
  name: string
  sportart: string
  gemeinde: string
  quelle: string
  liga: string | null
  ergebnis_url: string | null
  externe_id: string | null
}

interface Zeile {
  spielnummer: string
  verein: string
  gemeinde: string
  sportart: string
  datum: string
  heim: string
  gast: string
  tore_heim: number | null
  tore_gast: number | null
  wettbewerb: string
  ort: string | null
  status: string | null
  quelle_url: string
}

export default defineOperationApi<Optionen>({
  id: 'sportresultate-holen',
  handler: async (optionen, { services, getSchema, logger, database }) => {
    const { ItemsService } = services
    const schema = await getSchema()
    const hoechstens = Math.max(1, optionen.hoechstens ?? 200)

    const vereineService = new ItemsService('vereine', {
      schema,
      knex: database
    })
    const spieleService = new ItemsService('spiele', { schema, knex: database })

    const vereine = (await vereineService.readByQuery({
      filter: { aktiv: { _eq: true } },
      fields: [
        'id',
        'name',
        'sportart',
        'gemeinde',
        'quelle',
        'liga',
        'ergebnis_url',
        'externe_id'
      ],
      limit: -1
    })) as VereinZeile[]

    const zeilen: Zeile[] = []
    const fehler: string[] = []

    // Football: one page for the whole association, so every club is covered by
    // a single request. Volleyball: one page per team. Anything else has no
    // connector yet — those clubs are simply skipped, which is why the tab can
    // be right about football and empty about handball at the same time.
    const fussball = vereine.filter((verein) => verein.quelle === 'fvnws')
    if (fussball.length > 0) {
      try {
        const ergebnis = await scrape(WHATS_ON_URL)
        const alle = parseWhatsOn(ergebnis.markdown)
        let getroffen = 0
        for (const begegnung of alle) {
          if (!istInteressant(begegnung.wettbewerb)) continue
          const verein = ordneVereinZu(begegnung, fussball)
          if (verein === null) continue
          getroffen += 1
          zeilen.push({
            spielnummer: begegnung.spielnummer,
            verein: verein.id,
            gemeinde: verein.gemeinde,
            sportart: verein.sportart,
            datum: begegnung.datum,
            heim: begegnung.heim,
            gast: begegnung.gast,
            tore_heim: begegnung.toreHeim,
            tore_gast: begegnung.toreGast,
            wettbewerb: begegnung.wettbewerb,
            ort: begegnung.ort,
            status: begegnung.status,
            quelle_url: WHATS_ON_URL
          })
        }
        logger.info(
          `sportresultate: Fussball — ${alle.length} gelesen, ${getroffen} betreffen unsere Vereine.`
        )
      } catch (ausnahme) {
        // A source that is down is not a reason to fail the whole run — the
        // other sports are still worth having, and the next run retries.
        const grund =
          ausnahme instanceof CrawlerFehler
            ? ausnahme.message
            : String(ausnahme)
        logger.warn(`sportresultate: Fussballquelle nicht lesbar — ${grund}`)
        fehler.push(`fvnws: ${grund}`)
      }
    }

    for (const verein of vereine.filter((v) => v.quelle === 'swissvolley')) {
      if (verein.ergebnis_url === null) {
        logger.warn(
          `sportresultate: ${verein.name} hat keine ergebnis_url — uebersprungen.`
        )
        continue
      }
      try {
        const ergebnis = await scrape(verein.ergebnis_url)
        const begegnungen = parseGameCenter(
          ergebnis.markdown,
          verein.externe_id ?? verein.id
        )
        for (const begegnung of begegnungen) {
          zeilen.push({
            spielnummer: begegnung.schluessel,
            verein: verein.id,
            gemeinde: verein.gemeinde,
            sportart: verein.sportart,
            datum: begegnung.datum,
            heim: begegnung.heim,
            gast: begegnung.gast,
            tore_heim: begegnung.toreHeim,
            tore_gast: begegnung.toreGast,
            // The Game Center prints no competition on a fixture row, so the
            // club's own league stands in for it.
            wettbewerb: verein.liga ?? 'Meisterschaft',
            ort: begegnung.ort,
            status: null,
            quelle_url: verein.ergebnis_url
          })
        }
        logger.info(
          `sportresultate: ${verein.name} — ${begegnungen.length} Begegnungen gelesen.`
        )
      } catch (ausnahme) {
        const grund =
          ausnahme instanceof CrawlerFehler
            ? ausnahme.message
            : String(ausnahme)
        logger.warn(`sportresultate: ${verein.name} nicht lesbar — ${grund}`)
        fehler.push(`${verein.name}: ${grund}`)
      }
    }

    for (const verein of vereine.filter((v) => v.quelle === 'handball')) {
      if (verein.ergebnis_url === null) {
        logger.warn(
          `sportresultate: ${verein.name} hat keine ergebnis_url — uebersprungen.`
        )
        continue
      }
      try {
        const ergebnis = await scrape(verein.ergebnis_url)
        const begegnungen = parseHandball(
          ergebnis.markdown,
          verein.externe_id ?? verein.id
        )
        for (const begegnung of begegnungen) {
          zeilen.push({
            spielnummer: begegnung.schluessel,
            verein: verein.id,
            gemeinde: verein.gemeinde,
            sportart: verein.sportart,
            datum: begegnung.datum,
            heim: begegnung.heim,
            gast: begegnung.gast,
            tore_heim: begegnung.toreHeim,
            tore_gast: begegnung.toreGast,
            wettbewerb: verein.liga ?? 'Meisterschaft',
            ort: null,
            status: null,
            quelle_url: verein.ergebnis_url
          })
        }
        logger.info(
          `sportresultate: ${verein.name} — ${begegnungen.length} Begegnungen gelesen.`
        )
      } catch (ausnahme) {
        const grund =
          ausnahme instanceof CrawlerFehler
            ? ausnahme.message
            : String(ausnahme)
        logger.warn(`sportresultate: ${verein.name} nicht lesbar — ${grund}`)
        fehler.push(`${verein.name}: ${grund}`)
      }
    }

    const MIT_KONNEKTOR = new Set(['fvnws', 'swissvolley', 'handball'])
    const ohneKonnektor = [
      ...new Set(
        vereine
          .filter((v) => !MIT_KONNEKTOR.has(v.quelle))
          .map((v) => v.sportart)
      )
    ]

    let neu = 0
    let aktualisiert = 0

    for (const felder of zeilen.slice(0, hoechstens)) {
      const begegnung = {
        toreHeim: felder.tore_heim,
        toreGast: felder.tore_gast,
        status: felder.status,
        spielnummer: felder.spielnummer
      }

      try {
        const vorhanden = (await spieleService.readByQuery({
          filter: { spielnummer: { _eq: begegnung.spielnummer } },
          fields: ['id', 'tore_heim', 'tore_gast', 'status', 'datum'],
          limit: 1
        })) as Array<{
          id: string
          tore_heim: number | null
          tore_gast: number | null
          status: string | null
        }>

        const treffer = vorhanden[0]
        if (treffer === undefined) {
          await spieleService.createOne(felder)
          neu += 1
          continue
        }

        // Only write when something really moved. Rewriting an unchanged row
        // every day would make `date_updated` useless as a signal.
        const geaendert =
          treffer.tore_heim !== begegnung.toreHeim ||
          treffer.tore_gast !== begegnung.toreGast ||
          (treffer.status ?? null) !== begegnung.status
        if (geaendert) {
          await spieleService.updateOne(treffer.id, felder)
          aktualisiert += 1
        }
      } catch (ausnahme) {
        // One bad entry must not abort the run — the rest of the day's fixtures
        // are still worth having.
        logger.warn(
          `sportresultate: Spiel ${begegnung.spielnummer} uebersprungen — ${
            ausnahme instanceof Error ? ausnahme.message : String(ausnahme)
          }`
        )
      }
    }

    if (ohneKonnektor.length > 0) {
      logger.info(
        `sportresultate: ohne Konnektor und daher uebersprungen — ${ohneKonnektor.join(', ')}.`
      )
    }
    logger.info(`sportresultate: ${neu} neu, ${aktualisiert} aktualisiert.`)

    return {
      vereine: vereine.length,
      gefunden: zeilen.length,
      neu,
      aktualisiert,
      ohneKonnektor,
      fehler
    }
  }
})
