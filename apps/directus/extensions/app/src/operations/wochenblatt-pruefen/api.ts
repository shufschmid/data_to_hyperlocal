import { defineOperationApi } from '@directus/extensions-sdk'
import { completeChatJson } from '../../shared/claude'
import {
  extrahiereText,
  fetchAusgabenliste,
  ladeAusgabePdfFuer,
  nummerAusDateiname,
  nummerAusErsterSeite,
  waehleNeueAusgaben,
  type WochenblattKonnektor
} from '../../shared/wochenblatt'
import {
  brauchtTextTransport,
  buildInventarMessages,
  INVENTAR_SCHEMA,
  INVENTAR_SYSTEM_PROMPT,
  lernDigest,
  parseInventar,
  type FaehrtenUrteil,
  type GemeindeKorrektur,
  type InventarQuelle,
  type LernEintrag
} from '../../redaktion/presseschau'
import { optionalEnv } from '../../shared/env'
import type {
  Meldung,
  Wochenblatt,
  Wochenblattausgabe,
  Wochenblattkandidat
} from '../../types/schema'

// The 09:00 look at every registered weekly paper.
//
// Per paper: read the archive list, take AT MOST ONE new issue (a weekly
// cannot legitimately produce more per day; a gap after a missed morning
// self-heals one issue per run, oldest first), store the PDF in Directus
// Files, extract its text layer, and let one Opus call inventory the
// exclusive pieces into candidates. The editor picks from those — no Meldung
// is written here.
//
// A paper with no stored issues takes exactly the newest archive entry:
// registration deliberately ignores the backlog, that was the deal.
//
// Idempotent by construction: the canonical `schluessel` plus the unique index
// `(wochenblatt, schluessel)` means reading the same archive every morning
// inserts an issue once. Errors are recorded per paper on
// `letzte_pruefung`/`letzter_fehler` — one broken archive never costs the
// others, and the workspace shows the reason instead of silence.

interface Optionen {
  /** How many papers one run reads — the boundedness option every scrape has. */
  blaetter?: number
  model?: string | null
}

interface Ergebnis {
  blaetter: number
  neueAusgaben: number
  kandidaten: number
  fehler: string[]
  hinweise: string[]
}

/** How many past decisions ride into the inventory as examples. */
const LERN_FENSTER = 20

export default defineOperationApi<Optionen>({
  id: 'wochenblatt-pruefen',
  handler: async (optionen, { services, getSchema, logger, database }) => {
    const { ItemsService, FilesService } = services as typeof services & {
      FilesService: new (opts: unknown) => {
        uploadOne: (
          strom: unknown,
          daten: Record<string, unknown>
        ) => Promise<string>
      }
    }
    const schema = await getSchema()
    const hoechstens = Math.max(1, optionen.blaetter ?? 10)
    const kontakt = optionalEnv('AGENDA_KONTAKT', 'it@bajour.ch')

    // A scheduled Flow has no user, so these services run as the system.
    const blaetterService = new ItemsService('wochenblaetter', {
      schema,
      knex: database
    })
    const ausgabenService = new ItemsService('wochenblattausgaben', {
      schema,
      knex: database
    })
    const kandidatenService = new ItemsService('wochenblattkandidaten', {
      schema,
      knex: database
    })
    const meldungenService = new ItemsService('meldungen', {
      schema,
      knex: database
    })
    const hinweiseService = new ItemsService('recherchehinweise', {
      schema,
      knex: database
    })
    const files = new FilesService({ schema, knex: database })

    const ergebnis: Ergebnis = {
      blaetter: 0,
      neueAusgaben: 0,
      kandidaten: 0,
      fehler: [],
      hinweise: []
    }

    const blaetter = (await blaetterService.readByQuery({
      filter: { aktiv: { _eq: true } },
      fields: [
        'id',
        'name',
        'archiv_url',
        'konnektor',
        'gemeinde.id',
        'gemeinde.name',
        'abdeckungen.gemeinde.id',
        'abdeckungen.gemeinde.name'
      ],
      limit: hoechstens
    })) as Array<
      Pick<Wochenblatt, 'id' | 'name' | 'archiv_url' | 'konnektor'> & {
        gemeinde: { id: string; name: string }
        abdeckungen: Array<{ gemeinde: { id: string; name: string } }>
      }
    >

    for (const blatt of blaetter) {
      if (
        blatt.konnektor !== 'wordpress-archiv' &&
        blatt.konnektor !== 'lokalzeitungen' &&
        blatt.konnektor !== 'issuu' &&
        blatt.konnektor !== 'localpoint'
      ) {
        logger.warn(
          `wochenblatt: Konnektor "${blatt.konnektor}" hat keinen Leser — ${blatt.name} uebersprungen`
        )
        continue
      }
      ergebnis.blaetter += 1

      try {
        await pruefeBlatt(blatt)
        await blaetterService.updateOne(blatt.id, {
          letzte_pruefung: new Date().toISOString(),
          letzter_fehler: null
        })
      } catch (fehler) {
        const text = fehler instanceof Error ? fehler.message : String(fehler)
        logger.error(fehler, `wochenblatt: ${blatt.name} fehlgeschlagen`)
        ergebnis.fehler.push(`${blatt.name}: ${text}`)
        await blaetterService.updateOne(blatt.id, {
          letzte_pruefung: new Date().toISOString(),
          letzter_fehler: text
        })
      }
    }

    return ergebnis

    interface BlattZeile {
      id: string
      name: string
      archiv_url: string
      konnektor: WochenblattKonnektor
      gemeinde: { id: string; name: string }
      abdeckungen: Array<{ gemeinde: { id: string; name: string } }>
    }

    /** Covered municipalities, main one first — names and ids in step. */
    function abdeckungVon(
      blatt: BlattZeile
    ): Array<{ id: string; name: string }> {
      const liste = [blatt.gemeinde]
      for (const eintrag of blatt.abdeckungen ?? []) {
        if (eintrag.gemeinde.id !== blatt.gemeinde.id)
          liste.push(eintrag.gemeinde)
      }
      return liste
    }

    async function pruefeBlatt(blatt: BlattZeile): Promise<void> {
      const archiv = await fetchAusgabenliste(
        blatt.konnektor,
        blatt.archiv_url,
        {
          kontakt
        }
      )

      const gespeicherte = (await ausgabenService.readByQuery({
        filter: { wochenblatt: { _eq: blatt.id } },
        fields: ['schluessel'],
        limit: -1
      })) as Pick<Wochenblattausgabe, 'schluessel'>[]

      const neue = waehleNeueAusgaben(
        archiv,
        gespeicherte.map((a) => a.schluessel)
      )

      for (const eintrag of neue) {
        ergebnis.neueAusgaben += 1

        const pdf = await ladeAusgabePdfFuer(
          blatt.konnektor,
          eintrag.seiteUrl,
          {
            kontakt
          }
        )
        const layer = await extrahiereText(pdf.daten)
        // Date-keyed archives do not state the printed number, but the PDF's
        // own filename does (RZ-KW34-2026.pdf) — and where the filename says
        // nothing either (Localpoint's are UUIDs), the front page prints it
        // ("BIBO NR. 35"). The attribution wants it; null stays honest.
        const nummer =
          eintrag.nummer ??
          nummerAusDateiname(pdf.pdfUrl) ??
          nummerAusErsterSeite(layer.seitenTexte[0] ?? '')

        const { Readable } = await import('node:stream')
        const dateiId = await files.uploadOne(Readable.from(pdf.daten), {
          title: `${blatt.name} Nr. ${nummer ?? eintrag.schluessel}`,
          filename_download: `${blatt.name.replace(/[^\w. -]/g, '')} ${eintrag.schluessel}.pdf`,
          type: 'application/pdf',
          storage: 'local'
        })

        const ausgabeId = (await ausgabenService.createOne({
          wochenblatt: blatt.id,
          schluessel: eintrag.schluessel,
          slug: eintrag.slug,
          nummer,
          datum: eintrag.datum,
          seite_url: eintrag.seiteUrl,
          pdf_url: pdf.pdfUrl,
          pdf: dateiId,
          seiten: layer.seiten,
          volltext: layer.text,
          status: 'liest'
        })) as string

        try {
          const anzahl = await inventarisiere(
            blatt,
            ausgabeId,
            nummer,
            eintrag.datum,
            pdf.daten,
            layer
          )
          ergebnis.kandidaten += anzahl
          ergebnis.hinweise.push(
            `${blatt.name} Nr. ${nummer ?? eintrag.schluessel}: ${anzahl} Kandidaten`
          )
        } catch (fehler) {
          // The issue row stays — PDF and text layer are already worth having.
          // The inventory can be retried from the workspace.
          const text = fehler instanceof Error ? fehler.message : String(fehler)
          await ausgabenService.updateOne(ausgabeId, {
            status: 'fehler',
            fehler: text
          })
          throw fehler
        }
      }
    }

    /** One Opus call over the issue, steered by what the newsroom decided before. */
    async function inventarisiere(
      blatt: BlattZeile,
      ausgabeId: string,
      nummer: string | null,
      datum: string | null,
      pdfDaten: Buffer,
      layer: { seiten: number; seitenTexte: string[] }
    ): Promise<number> {
      const abdeckung = abdeckungVon(blatt)
      const gemeindeIds = new Map(abdeckung.map((g) => [g.name, g.id]))
      const digest = lernDigest(...(await ladeLernSignale(blatt.id)))
      const seiten = layer.seiten

      // A file past the API's request limit travels as its text layer — the
      // page headers carry the rubric, so nothing the assignment needs is lost.
      const quelle: InventarQuelle = brauchtTextTransport(pdfDaten.length)
        ? { art: 'seitentexte', seitenTexte: layer.seitenTexte }
        : { art: 'pdf', base64: pdfDaten.toString('base64') }

      const antwort = await completeChatJson<unknown>({
        system: INVENTAR_SYSTEM_PROMPT,
        messages: buildInventarMessages(
          quelle,
          {
            name: blatt.name,
            gemeinden: abdeckung.map((g) => g.name),
            nummer,
            datum
          },
          digest
        ),
        model: 'claude-opus-5',
        // Thinking and answer share the budget, and a text-dense paper (the
        // Riehener Zeitung blew through 16k) needs room for both. Streams
        // under the hood (see sendToClaude), and no request is waiting.
        maxTokens: 32000,
        schema: INVENTAR_SCHEMA
      })

      const inventar = parseInventar(
        antwort,
        seiten,
        abdeckung.map((g) => g.name)
      )

      for (const kandidat of inventar.kandidaten) {
        await kandidatenService.createOne({
          ausgabe: ausgabeId,
          titel: kandidat.titel,
          seite: kandidat.seite,
          typ: kandidat.typ,
          gemeinde: gemeindeIds.get(kandidat.gemeinde) ?? blatt.gemeinde.id,
          frontseite: kandidat.frontseite,
          warum_exklusiv: kandidat.warum_exklusiv,
          zusammenfassung: kandidat.zusammenfassung,
          perle_vorschlag: kandidat.perle_vorschlag,
          perle_begruendung: kandidat.perle_begruendung,
          entscheid: 'offen'
        })
      }

      // Research leads land in their own collection — never candidates, never
      // published unchecked; the workspace badge makes a new one unmissable.
      for (const faehrte of inventar.recherchehinweise) {
        await hinweiseService.createOne({
          ausgabe: ausgabeId,
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

      await ausgabenService.updateOne(ausgabeId, {
        status: 'inventarisiert',
        inventar: inventar as unknown as Record<string, unknown>,
        fehler: null
      })

      return inventar.kandidaten.length
    }

    /**
     * The recent teaching of THIS paper — take/reject decisions, municipality
     * corrections and lead verdicts. What in Binningen is a Doublette says
     * nothing about Muttenz, so everything is deliberately per paper.
     */
    async function ladeLernSignale(
      blattId: string
    ): Promise<[LernEintrag[], GemeindeKorrektur[], FaehrtenUrteil[]]> {
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
        limit: LERN_FENSTER
      })) as Array<
        Pick<
          Wochenblattkandidat,
          | 'id'
          | 'titel'
          | 'typ'
          | 'entscheid'
          | 'ablehnungsgrund'
          | 'ablehnungskommentar'
          | 'perle_vorschlag'
        >
      >

      const korrigierte = (await kandidatenService.readByQuery({
        filter: {
          gemeinde_korrigiert: { _eq: true },
          ausgabe: { wochenblatt: { _eq: blattId } }
        },
        sort: ['-date_updated'],
        fields: ['titel', 'gemeinde.name'],
        limit: LERN_FENSTER
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
        limit: LERN_FENSTER
      })) as Array<{ titel: string; status: string; kommentar: string | null }>
      const faehrten: FaehrtenUrteil[] = beurteilte.map((f) => ({
        titel: f.titel,
        brauchbar: f.status === 'brauchbar',
        kommentar: f.kommentar
      }))

      let eintraege: LernEintrag[] = []
      if (kandidaten.length > 0) {
        // A Perle verdict exists only once the Meldung is published —
        // unpublished means undecided, not "no".
        const meldungen = (await meldungenService.readByQuery({
          filter: { kandidat: { _in: kandidaten.map((k) => k.id) } },
          fields: ['kandidat', 'status', 'perle'],
          limit: -1
        })) as Pick<Meldung, 'kandidat' | 'status' | 'perle'>[]
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
  }
})
