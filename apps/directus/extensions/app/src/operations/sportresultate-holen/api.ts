import { defineOperationApi } from '@directus/extensions-sdk'
import { CrawlerFehler, scrape, WHATS_ON_URL } from '../../shared/crawler'
import {
  istInteressant,
  ordneVereinZu,
  parseTelegramme,
  parseTelegrammSeite,
  parseVereinsseite,
  parseWhatsOn,
  telegrammId,
  telegrammLinks,
  type Telegrammfund
} from '../../shared/matchcenter/parse'
import { parseGameCenter } from '../../shared/swissvolley/parse'
import { parseHandball } from '../../shared/handball/parse'
import {
  BasketplanFehler,
  holeSpielplan,
  oeffentlicheLigaseite,
  ordneBasketballZu
} from '../../shared/basketplan'
import { optionalEnv } from '../../shared/env'
import { ersteMannschaftAbgleich } from '../../redaktion/mannschaft'
import { schreibeSpielberichte } from '../../redaktion/spielberichte'
import { ladeRegeln } from '../../redaktion/gedaechtnis'
import {
  revisionsSchreibungenSpiel,
  type RevisionsSpiel,
  type RevisionsSpielMeldung,
  type SpielStand
} from '../../redaktion/revisionsport'

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
    // Telegrams found along the way — attached to stored rows after the
    // fixture writes, because a match can arrive together with its result.
    const telegramme: Telegrammfund[] = []
    // Every address the rendered football pages linked. The crawler's `links`
    // format is where the JS-handler telegram icons live (measured: 29 tg
    // links on a club page whose markdown carried zero).
    const telegrammAdressen: string[] = []

    if (fussball.length > 0) {
      try {
        const ergebnis = await scrape(WHATS_ON_URL, {
          formats: ['markdown', 'links']
        })
        // The service says when it cut the markdown (measured: this very page
        // hits the ~96k ceiling even with a raised max_chars). Fixtures beyond
        // the cut are invisible — said here, per the newsroom's rule.
        if (ergebnis.abgeschnitten) {
          logger.warn(
            'sportresultate: "what\'s on" ist abgeschnitten — spaetere Spiele fehlen dann.'
          )
          fehler.push(
            'fvnws: Spielliste abgeschnitten (Markdown-Deckel des Crawlers).'
          )
        }
        telegrammAdressen.push(...ergebnis.links)
        telegramme.push(...parseTelegramme(ergebnis.markdown))
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

    // Basketball: one request per GROUP, not per team.
    //
    // A group carries several of our clubs at once — BC Allschwil-Algon and
    // Liestal Basket 44 play in the same NL1 Men group as BC Arlesheim's men —
    // so two clubs of one group share one address and it is fetched once. The
    // football pattern, not the volleyball one.
    //
    // Which match belongs to whom is decided locally on the team id at the
    // source (`vereine.externe_id`), without a model; a match of a club we do
    // not cover is counted, never stored.
    const basketball = vereine.filter((v) => v.quelle === 'basketball')
    if (basketball.length > 0) {
      const kontakt = optionalEnv('AGENDA_KONTAKT', 'it@bajour.ch')
      const gruppen = new Map<string, VereinZeile[]>()
      for (const verein of basketball) {
        if (verein.ergebnis_url === null) {
          logger.warn(
            `sportresultate: ${verein.name} hat keine ergebnis_url — uebersprungen.`
          )
          continue
        }
        const bisher = gruppen.get(verein.ergebnis_url)
        if (bisher === undefined) gruppen.set(verein.ergebnis_url, [verein])
        else bisher.push(verein)
      }

      for (const [adresse, gruppenvereine] of gruppen) {
        try {
          const plan = await holeSpielplan(adresse, { kontakt })
          // The cap lives in the address the editor stored. One that bites
          // silently reads as «no more matches» — said out loud instead.
          if (plan.abgeschnitten) {
            fehler.push(
              `Basketball: Spielplan ${plan.liga ?? adresse} am Deckel totalGames abgeschnitten.`
            )
          }
          // The league page a reader can open, not the XML door we read.
          const quelleUrl = oeffentlicheLigaseite(plan.liga) ?? adresse
          const { zugeordnet, ohneVerein } = ordneBasketballZu(
            plan.spiele,
            gruppenvereine
          )
          for (const { spiel, verein } of zugeordnet) {
            zeilen.push({
              spielnummer: spiel.spielnummer,
              verein: verein.id,
              gemeinde: verein.gemeinde,
              sportart: verein.sportart,
              datum: spiel.datum,
              heim: spiel.heim,
              gast: spiel.gast,
              tore_heim: spiel.toreHeim,
              tore_gast: spiel.toreGast,
              wettbewerb: plan.liga ?? verein.liga ?? 'Meisterschaft',
              ort: spiel.ort,
              status: null,
              quelle_url: quelleUrl
            })
          }
          logger.info(
            `sportresultate: Basketball ${plan.liga ?? adresse} — ${plan.spiele.length} gelesen, ` +
              `${zugeordnet.length} betreffen unsere Vereine, ${ohneVerein} andere.`
          )
        } catch (ausnahme) {
          const grund =
            ausnahme instanceof BasketplanFehler
              ? ausnahme.message
              : String(ausnahme)
          logger.warn(`sportresultate: Basketball nicht lesbar — ${grund}`)
          fehler.push(`Basketball (${adresse}): ${grund}`)
        }
      }
    }

    let nachgetragen = 0

    // Nachtrag: the score for football, from each club's own page.
    //
    // The 'what's on' page only looks forward, so a fixture stored while it was
    // upcoming never sees its own result there — measured on 20.08., the match
    // played on the 19th had already rolled off the window. The club page keeps
    // it, and the Spielnummer joins the two.
    //
    // Only rows we already know are touched, and only their score. The club
    // page cannot name an opponent, so it never creates a fixture.
    for (const verein of fussball) {
      if (verein.ergebnis_url === null) continue
      try {
        // `links` rides along at no extra request: the club page's telegram
        // icons are JavaScript handlers the markdown never shows, but the
        // rendered page's hrefs carry them all.
        const ergebnis = await scrape(verein.ergebnis_url, {
          formats: ['markdown', 'links']
        })
        telegrammAdressen.push(...ergebnis.links)
        telegramme.push(...parseTelegramme(ergebnis.markdown))
        const resultate = parseVereinsseite(ergebnis.markdown)
        let getragen = 0

        for (const resultat of resultate) {
          const offen = (await spieleService.readByQuery({
            filter: {
              spielnummer: { _eq: resultat.spielnummer },
              tore_heim: { _null: true }
            },
            fields: ['id'],
            limit: 1
          })) as Array<{ id: string }>

          const treffer = offen[0]
          if (treffer === undefined) continue
          await spieleService.updateOne(treffer.id, {
            tore_heim: resultat.toreHeim,
            tore_gast: resultat.toreGast
          })
          getragen += 1
          nachgetragen += 1
        }

        if (getragen > 0) {
          logger.info(
            `sportresultate: ${verein.name} — ${getragen} Resultat(e) nachgetragen.`
          )
        }
      } catch (ausnahme) {
        const grund =
          ausnahme instanceof CrawlerFehler
            ? ausnahme.message
            : String(ausnahme)
        logger.warn(
          `sportresultate: Vereinsseite ${verein.name} nicht lesbar — ${grund}`
        )
        fehler.push(`${verein.name} (Nachtrag): ${grund}`)
      }
    }

    const meldungenService = new ItemsService('meldungen', {
      schema,
      knex: database
    })

    // The first team only — and nothing else even gets stored.
    //
    // Decided per club over the stored rows and the newly read ones TOGETHER:
    // today's window alone does not say which league is a club's best, and a
    // weekend on which only the fourth team plays would otherwise promote it
    // for a day. See `redaktion/mannschaft.ts`.
    //
    // It runs in both directions. What the source just delivered below the
    // club's best league is dropped before it is written, and what is already
    // stored below it is deleted — the women's and lower-league sides the old
    // rule kept and never wrote a line about.
    const gespeichert = new Map<
      string,
      Array<{ id: string; wettbewerb: string }>
    >()
    for (const spiel of (await spieleService.readByQuery({
      fields: ['id', 'verein', 'wettbewerb'],
      limit: -1
    })) as Array<{ id: string; verein: string | null; wettbewerb: string }>) {
      if (spiel.verein === null) continue
      const bisher = gespeichert.get(spiel.verein)
      if (bisher === undefined)
        gespeichert.set(spiel.verein, [
          { id: spiel.id, wettbewerb: spiel.wettbewerb }
        ])
      else bisher.push({ id: spiel.id, wettbewerb: spiel.wettbewerb })
    }

    const zuSchreiben: Zeile[] = []
    const ueberzaehlig: string[] = []
    for (const verein of vereine) {
      const abgleich = ersteMannschaftAbgleich(
        zeilen.filter((z) => z.verein === verein.id),
        gespeichert.get(verein.id) ?? [],
        verein.liga
      )
      zuSchreiben.push(...abgleich.behalten)
      ueberzaehlig.push(...abgleich.entfernen.map((s) => s.id))
    }
    const uebersprungen = zeilen.length - zuSchreiben.length

    let entfernt = 0
    if (ueberzaehlig.length > 0) {
      try {
        // A fixture somebody already wrote about stays, whatever league it
        // turned out to be in: the article points at it, and deleting the row
        // under a published report would leave the report standing on nothing.
        const beschrieben = (await meldungenService.readByQuery({
          filter: { spiel: { _in: ueberzaehlig } },
          fields: ['spiel'],
          limit: -1
        })) as Array<{ spiel: string }>
        const geschont = new Set(beschrieben.map((m) => m.spiel))

        const weg = ueberzaehlig.filter((id) => !geschont.has(id))
        if (weg.length > 0) {
          await spieleService.deleteMany(weg)
          entfernt = weg.length
        }
      } catch (ausnahme) {
        // Housekeeping must never cost the run its actual work.
        logger.warn(ausnahme, 'sportresultate: Aufraeumen fehlgeschlagen.')
      }
    }
    if (uebersprungen > 0 || entfernt > 0) {
      logger.info(
        `sportresultate: ${uebersprungen} Begegnung(en) nicht der ersten Mannschaft uebergangen, ${entfernt} gespeicherte entfernt.`
      )
    }

    const MIT_KONNEKTOR = new Set([
      'fvnws',
      'swissvolley',
      'handball',
      'basketball'
    ])
    const ohneKonnektor = [
      ...new Set(
        vereine
          .filter((v) => !MIT_KONNEKTOR.has(v.quelle))
          .map((v) => v.sportart)
      )
    ]

    let neu = 0
    let aktualisiert = 0
    let revidiert = 0

    /**
     * The revision watchdog for the sport desk — the one pass here that looks
     * BACK.
     *
     * Everything else in this run asks what is new. But an association revises
     * too: a forfait, an upheld protest, a typo in the score sheet, and the row
     * a PUBLISHED report stands on quietly changes under it. `revision.ts` does
     * this for the statistics feed; `revisionsport.ts` holds the rule for this
     * one, with the very digit check that cleared the report for publication.
     *
     * It states and never acts. No report is retracted, rewritten or
     * republished here — the finding lands on the row, the desk shows it as the
     * red «Zahlen revidiert» chip, and a person decides. `/korrekturen` is what
     * carries a retraction out, once a person has made it.
     *
     * Bounded by construction (only the rows this run actually moved) and
     * fail-open per report: a finding that will not write must not cost the run
     * its actual work.
     */
    async function pruefeSpielrevision(
      spielId: string,
      vorher: SpielStand,
      nachher: RevisionsSpiel
    ): Promise<void> {
      try {
        // Published only: a draft is still being worked on, and its figures are
        // checked on the way out anyway.
        const berichte = (await meldungenService.readByQuery({
          filter: { status: { _eq: 'publiziert' }, spiel: { _eq: spielId } },
          fields: ['id', 'titel', 'lead', 'text', 'revision_hinweis'],
          limit: -1
        })) as RevisionsSpielMeldung[]
        if (berichte.length === 0) return

        for (const schreibung of revisionsSchreibungenSpiel(
          berichte,
          vorher,
          nachher,
          new Date().toISOString()
        )) {
          try {
            await meldungenService.updateOne(schreibung.id, {
              revision_hinweis: schreibung.revision_hinweis,
              revision_geprueft_am: schreibung.revision_geprueft_am
            })
            revidiert += 1
          } catch (ausnahme) {
            logger.warn(
              ausnahme,
              `sportresultate: Revisionsbefund fuer Meldung ${schreibung.id} nicht schreibbar.`
            )
          }
        }
      } catch (ausnahme) {
        logger.warn(
          ausnahme,
          `sportresultate: Revision fuer Spiel ${spielId} nicht geprueft.`
        )
      }
    }

    // The work cap says when it bites — fixtures beyond it are not stored this
    // run, and a silent cut here would read as "no match happened".
    if (zuSchreiben.length > hoechstens) {
      logger.warn(
        `sportresultate: ${zuSchreiben.length - hoechstens} Begegnungen nicht gespeichert (Deckel ${hoechstens}) — naechster Lauf holt sie nach.`
      )
    }
    for (const felder of zuSchreiben.slice(0, hoechstens)) {
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
          datum: string
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
          // Held BEFORE the write: the watchdog needs both sides, and after the
          // update the old one is gone for good.
          const vorher: SpielStand = {
            tore_heim: treffer.tore_heim,
            tore_gast: treffer.tore_gast,
            datum: treffer.datum
          }
          await spieleService.updateOne(treffer.id, felder)
          aktualisiert += 1
          await pruefeSpielrevision(treffer.id, vorher, felder)
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
    if (revidiert > 0) {
      logger.warn(
        `sportresultate: ${revidiert} publizierte(r) Spielbericht(e) mit Revisionsbefund — der Verband hat korrigiert.`
      )
    }

    // Attach discovered telegrams — AFTER the fixture writes, so a match that
    // arrived together with its result (a cup round never seen upcoming) can
    // receive its telegram in the same run.
    //
    // Two paths, cheapest first. Where a page's markdown kept the icon, the
    // row names both teams and the score and the telegram attaches without
    // another request. Everything else lives only in the rendered pages'
    // `links` — bare addresses with no match attached — and is PROBED: fetch
    // the telegram page, read the Spielnummer it prints, attach it to the
    // stored fixture still waiting. Bounded, newest first, and early-stopping:
    // no open need, no request.
    let telegrammeNeu = 0
    const spieleMitNeuemTelegramm = new Set<string>()
    for (const fund of telegramme) {
      try {
        const kandidaten = (await spieleService.readByQuery({
          filter: {
            heim: { _eq: fund.heim },
            gast: { _eq: fund.gast },
            tore_heim: { _eq: fund.toreHeim },
            tore_gast: { _eq: fund.toreGast },
            telegramm_url: { _null: true }
          },
          fields: ['id'],
          limit: 1
        })) as Array<{ id: string }>
        const spiel = kandidaten[0]
        if (spiel === undefined) continue
        await spieleService.updateOne(spiel.id, { telegramm_url: fund.url })
        telegrammeNeu += 1
        spieleMitNeuemTelegramm.add(spiel.id)
      } catch (ausnahme) {
        logger.warn(
          ausnahme,
          `sportresultate: Telegramm ${fund.url} nicht zuzuordnen.`
        )
      }
    }

    // What still lacks a telegram, keyed by the Spielnummer a telegram page
    // prints. Football only — the SFV's Spielnummer is the join key, and the
    // other sports' composed keys can never appear on one. The ten-day window
    // is the probe's brake: a telegram arrives days after the result or not at
    // all, and without the window every telegram-less fixture would keep the
    // probe burning its budget forever.
    const offenNachNummer = new Map<string, string>()
    if (fussball.length > 0 && telegrammAdressen.length > 0) {
      const fenster = new Date(Date.now() - 10 * 24 * 3600 * 1000)
        .toISOString()
        .slice(0, 10)
      for (const spiel of (await spieleService.readByQuery({
        filter: {
          verein: { _in: fussball.map((v) => v.id) },
          tore_heim: { _nnull: true },
          telegramm_url: { _null: true },
          datum: { _gte: fenster }
        },
        fields: ['id', 'spielnummer'],
        limit: -1
      })) as Array<{ id: string; spielnummer: string }>) {
        offenNachNummer.set(spiel.spielnummer, spiel.id)
      }
    }

    if (offenNachNummer.size > 0) {
      // Telegrams already attached — this run or any earlier one — are known
      // by their id and never fetched again.
      const bekannt = new Set<number>()
      for (const spiel of (await spieleService.readByQuery({
        filter: { telegramm_url: { _nnull: true } },
        fields: ['telegramm_url'],
        limit: -1
      })) as Array<{ telegramm_url: string }>) {
        const id = telegrammId(spiel.telegramm_url)
        if (id !== null) bekannt.add(id)
      }

      const kandidaten = telegrammLinks(telegrammAdressen).filter((url) => {
        const id = telegrammId(url)
        return id !== null && !bekannt.has(id)
      })

      // Most linked telegrams belong to other clubs' matches — the pages carry
      // the whole association's. The cap keeps a big day bounded; what it cuts
      // is retried tomorrow, newest first, as long as a need remains.
      const PROBE_DECKEL = 15
      let geprobt = 0
      for (const url of kandidaten) {
        if (offenNachNummer.size === 0 || geprobt >= PROBE_DECKEL) break
        geprobt += 1
        try {
          const seite = await scrape(url)
          const telegramm = parseTelegrammSeite(seite.markdown)
          if (telegramm === null) continue
          const spielId = offenNachNummer.get(telegramm.spielnummer)
          if (spielId === undefined) continue
          await spieleService.updateOne(spielId, { telegramm_url: url })
          offenNachNummer.delete(telegramm.spielnummer)
          telegrammeNeu += 1
          spieleMitNeuemTelegramm.add(spielId)
        } catch (ausnahme) {
          // Telegrams are enrichment: a failing page must not cost the run.
          logger.warn(
            ausnahme,
            `sportresultate: Telegramm ${url} nicht lesbar.`
          )
        }
      }
      if (geprobt >= PROBE_DECKEL && offenNachNummer.size > 0) {
        logger.info(
          `sportresultate: ${kandidaten.length - geprobt} Telegramm-Adressen nicht geprueft (Deckel ${PROBE_DECKEL}) — der naechste Lauf prueft weiter.`
        )
      }
    }
    if (telegrammeNeu > 0) {
      logger.info(`sportresultate: ${telegrammeNeu} Telegramm(e) entdeckt.`)
    }

    // A result without an article is work nobody asked for twice: every new
    // score gets its draft in the same run, so the editor finds a written
    // report rather than a fixture to press a button on. Bounded like every
    // other scheduled call — a backlog is worked off over several mornings.
    const berichte = await schreibeSpielberichte(
      {
        spiele: spieleService,
        meldungen: meldungenService,
        logger,
        // The sport desk's text rules ("Gelerntes") — the ones the sport chat
        // used to file under statistics.
        regeln: (
          await ladeRegeln(
            new ItemsService('redaktionswissen', { schema }),
            { bereich: 'sport', stufe: 'text' },
            { warn: (m: string) => logger.warn(m) }
          )
        ).map((r) => r.regel),
        // Injected here, where the crawler key is known to exist: a failing
        // telegram page costs the detail, never the report.
        holeTelegramm: async (url) => {
          try {
            return (await scrape(url)).markdown
          } catch (ausnahme) {
            logger.warn(
              ausnahme,
              `sportresultate: Telegramm ${url} nicht lesbar.`
            )
            return null
          }
        }
      },
      undefined,
      spieleMitNeuemTelegramm
    )
    if (berichte.offen > 0) {
      logger.info(
        `sportresultate: ${berichte.erzeugt} von ${berichte.offen} Spielberichten geschrieben, ${berichte.erneuert} mit neuem Telegramm erneuert.`
      )
    }
    for (const gescheitert of berichte.fehlgeschlagen) {
      fehler.push(`Spielbericht ${gescheitert}`)
    }

    return {
      vereine: vereine.length,
      gefunden: zeilen.length,
      neu,
      aktualisiert,
      revidiert,
      uebersprungen,
      entfernt,
      nachgetragen,
      berichte: berichte.erzeugt,
      ohneKonnektor,
      fehler
    }
  }
})
