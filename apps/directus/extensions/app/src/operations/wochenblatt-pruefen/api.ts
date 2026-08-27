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
          // Per page, so the workspace can show the original wording next to a
          // candidate or lead — checking against the source must not require
          // opening the PDF.
          seiten_texte: layer.seitenTexte,
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
          // A new issue makes the previous one's UNDECIDED proposals stale —
          // the dashboard must not pile up week over week. Decided rows stay:
          // they are the learning signal.
          await raeumeAlteVorschlaegeAuf(blatt.id, ausgabeId)
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
      // published unchecked; they sit on the CHEFREDAKTION desk until judged,
      // surviving new issues. The page's own text travels with the lead, so
      // checking it never depends on the issue row staying around.
      for (const faehrte of inventar.recherchehinweise) {
        await hinweiseService.createOne({
          ausgabe: ausgabeId,
          gemeinde:
            faehrte.gemeinde === null
              ? null
              : (gemeindeIds.get(faehrte.gemeinde) ?? null),
          titel: faehrte.titel,
          fundort: faehrte.fundort,
          seite: faehrte.seite,
          begruendung: faehrte.begruendung,
          quelltext:
            faehrte.seite === null
              ? null
              : (layer.seitenTexte[faehrte.seite - 1] ?? null),
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
     * Undecided CANDIDATES of a paper's OLDER issues, cleared once a newer
     * one is inventoried — the editor's desk must not pile up week over week.
     *
     * An open candidate the editor never touched carries no learning signal
     * and no meaning once the next issue is out. Everything decided
     * (uebernommen, abgelehnt, weitergereicht) stays untouched: those rows
     * ARE the memory. Perle proposals are spared too: their verdict belongs
     * to the Chefredaktion and survives new issues — pending on her desk,
     * decided as memory. Research leads are deliberately NOT expired here —
     * they sit on the Chefredaktion desk until judged, however long that
     * takes.
     */
    async function raeumeAlteVorschlaegeAuf(
      blattId: string,
      neueAusgabeId: string
    ): Promise<void> {
      const alteOffene = (await kandidatenService.readByQuery({
        filter: {
          _and: [
            { entscheid: { _eq: 'offen' } },
            { perle_vorschlag: { _neq: true } },
            { ausgabe: { _neq: neueAusgabeId } },
            { ausgabe: { wochenblatt: { _eq: blattId } } }
          ]
        },
        fields: ['id'],
        limit: -1
      })) as { id: string }[]
      if (alteOffene.length === 0) return

      // An open candidate cannot have a Meldung (taking one over sets
      // uebernommen), but an admin edit could — never orphan a Meldung.
      const verknuepfte = (await meldungenService.readByQuery({
        filter: { kandidat: { _in: alteOffene.map((k) => k.id) } },
        fields: ['kandidat'],
        limit: -1
      })) as { kandidat: string }[]
      const mitMeldung = new Set(verknuepfte.map((m) => m.kandidat))
      for (const kandidat of alteOffene) {
        if (!mitMeldung.has(kandidat.id)) {
          await kandidatenService.deleteOne(kandidat.id)
        }
      }
    }

    /**
     * The recent teaching of THIS paper — take/reject decisions, municipality
     * corrections and lead verdicts. What in Binningen is a Doublette says
     * nothing about Muttenz, so everything is deliberately per paper.
     */
    async function ladeLernSignale(
      blattId: string
    ): Promise<[LernEintrag[], GemeindeKorrektur[], FaehrtenUrteil[]]> {
      // Decided candidates — plus the ones whose Perle question the
      // Chefredaktion answered even though nobody took or rejected them:
      // that verdict is a learning signal of its own.
      const kandidaten = (await kandidatenService.readByQuery({
        filter: {
          _and: [
            { ausgabe: { wochenblatt: { _eq: blattId } } },
            {
              _or: [
                { entscheid: { _neq: 'offen' } },
                { perle: { _nnull: true } }
              ]
            }
          ]
        },
        sort: ['-date_updated'],
        fields: [
          'id',
          'titel',
          'typ',
          'entscheid',
          'ablehnungsgrund',
          'ablehnungskommentar',
          'perle_vorschlag',
          'perle'
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
          | 'perle'
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

      // The verdict lives on the candidate itself; null means it still sits
      // on the Chefredaktion's desk, undecided, not "no".
      const eintraege: LernEintrag[] = kandidaten.map((k) => ({
        titel: k.titel,
        typ: k.typ,
        entscheid: k.entscheid,
        ablehnungsgrund: k.ablehnungsgrund,
        ablehnungskommentar: k.ablehnungskommentar,
        perleVorschlag: k.perle_vorschlag,
        perleBestaetigt: k.perle
      }))

      return [eintraege, korrekturen, faehrten]
    }
  }
})
