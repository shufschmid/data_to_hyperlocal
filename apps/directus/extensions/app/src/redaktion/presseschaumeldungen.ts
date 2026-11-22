// Eine Presseschau-Meldung aus einem Wochenblatt-Kandidaten — der eine Weg,
// den der Knopf am Kandidaten, «Meldungen formulieren» und der 09:00-Lauf
// teilen.
//
// Bis zum 22. November 2026 lag das alles im Endpunkt, weil nur Menschen es
// ausloesten. Seither benotet das Inventar jeden Kandidaten (Stufe 1–4), und
// AB DER SCHWELLE DES TISCHS schreibt der Lauf den Entwurf gleich mit — der
// Gemeindeseiten-Handel. Was darunter liegt, bleibt ohne Artikel liegen, bis
// jemand «Meldungen formulieren» drueckt oder den Kandidaten einzeln nimmt.
//
// Drei Dinge gelten fuer jeden Entwurf, den nicht ein Mensch am Kandidaten
// ausgeloest hat: er LEHRT nichts (kein `lerne`), der ENTSCHEID bleibt offen
// (`uebernehmen: false` — Ablehnen und Weiterreichen verwerfen den Entwurf),
// und PUBLIZIERT wird hier nie; das ist «Alle publizieren» auf dem Tisch.
//
// Die Dienste werden gereicht, damit Lauf (als System) und Endpunkt (als die
// angemeldete Person) dieselbe Funktion rufen.

import { ClaudeFormatError, completeJson } from '../shared/claude'
import { alleDaten, heuteAus } from '../shared/gemeindeseite/datum'
import {
  eigeneFelder,
  ergaenzungsHinweis,
  herkunftFelder,
  OHNE_BEITRAG,
  type RedaktionsBeitrag
} from './ergaenzung'
import { heuteIso } from './feiertage'
import {
  attributionsWarnung,
  buildPresseschauPrompt,
  buildPresseschauRevision,
  formulierbare,
  mitQuelle,
  parsePresseschau,
  PRESSESCHAU_FORMULIEREN_JE_KLICK,
  PRESSESCHAU_SYSTEM_PROMPT,
  ueberlappungsWarnungen,
  zahlWarnungenPresseschau,
  type PresseschauFakten
} from './presseschau'
import { zeitWarnungen } from './spielbericht'
import {
  planeMitteilungTermin,
  terminVorschlagAus,
  wichtigAus,
  type Termin
} from './termin'
import { ladeWichtigkeitSignale, wichtigkeitDigest } from './wichtigkeit'

interface LeseDienst {
  readByQuery(query: Record<string, unknown>): Promise<unknown[]>
  readOne(key: string, query?: Record<string, unknown>): Promise<unknown>
}

interface SchreibDienst {
  readByQuery(query: Record<string, unknown>): Promise<unknown[]>
  createOne(payload: Record<string, unknown>): Promise<string | number>
  updateOne(
    key: string,
    payload: Record<string, unknown>
  ): Promise<string | number>
}

/** Ohne Faktenzusammenfassung gibt es nichts, WORAUS zu schreiben waere. */
export class KeineZusammenfassung extends Error {
  constructor() {
    super('Der Kandidat hat keine Faktenzusammenfassung.')
    this.name = 'KeineZusammenfassung'
  }
}

export interface GeladenePresseschau {
  fakten: PresseschauFakten
  gemeindeId: string
  volltext: string | null
  /** The candidate's page as printed — the original a revision may consult. */
  quelltext: string | null
}

/** Candidate, issue and paper in one read — the facts a press review runs on. */
export async function ladePresseschauFakten(
  kandidaten: Pick<LeseDienst, 'readOne'>,
  kandidatId: string,
  /** The editor's part (`redaktion/ergaenzung.ts`): her additions ride as material, her own text needs no summary. */
  beitrag: RedaktionsBeitrag = OHNE_BEITRAG
): Promise<GeladenePresseschau> {
  const kandidat = (await kandidaten.readOne(kandidatId, {
    fields: [
      'id',
      'titel',
      'seite',
      'typ',
      'frontseite',
      'zusammenfassung',
      'gemeinde.id',
      'gemeinde.name',
      'ausgabe.nummer',
      'ausgabe.schluessel',
      'ausgabe.datum',
      'ausgabe.pdf_url',
      'ausgabe.volltext',
      'ausgabe.seiten_texte',
      'ausgabe.wochenblatt.name',
      'ausgabe.wochenblatt.gemeinde.id',
      'ausgabe.wochenblatt.gemeinde.name'
    ]
  })) as {
    id: string
    titel: string
    seite: number | null
    typ: PresseschauFakten['typ']
    frontseite: boolean
    zusammenfassung: string | null
    /** The per-piece assignment — multi-municipality papers live on this. */
    gemeinde: { id: string; name: string } | null
    ausgabe: {
      nummer: string | null
      schluessel: string
      datum: string | null
      pdf_url: string | null
      volltext: string | null
      seiten_texte: string[] | null
      wochenblatt: { name: string; gemeinde: { id: string; name: string } }
    }
  }

  if (
    (kandidat.zusammenfassung === null ||
      kandidat.zusammenfassung.trim() === '') &&
    beitrag.ergaenzung === null &&
    beitrag.eigene === null
  ) {
    // Without the fact summary there is nothing to write FROM — and writing
    // from the model's memory of the PDF is exactly what the one-source rule
    // forbids. Unless the editor brought the facts.
    throw new KeineZusammenfassung()
  }

  const gemeinde = kandidat.gemeinde ?? kandidat.ausgabe.wochenblatt.gemeinde

  // The page the piece stands on — a front-page candidate carries no page
  // number, but the front IS page one. The FOLLOWING page rides along,
  // because a Reportage regularly runs over: a revision handed only page 8
  // of an 8–9 piece answers "was stand dort?" from half the original.
  const seite = kandidat.seite ?? (kandidat.frontseite ? 1 : null)
  const seitenTexte = kandidat.ausgabe.seiten_texte ?? []
  const quelltextTeile: string[] = []
  if (seite !== null) {
    for (const n of [seite, seite + 1]) {
      const text = seitenTexte[n - 1]
      if (typeof text === 'string' && text.trim() !== '') {
        quelltextTeile.push(`— Seite ${n} —\n${text}`)
      }
    }
  }

  // The only days a termin may name: what the code finds in the summary, the
  // title and the piece's pages — read forward from today, because an
  // announced day lies ahead.
  const datenImText = alleDaten(
    [
      kandidat.titel,
      kandidat.zusammenfassung ?? '',
      ...quelltextTeile,
      beitrag.ergaenzung ?? ''
    ].join('\n'),
    heuteAus(heuteIso())
  )

  return {
    gemeindeId: gemeinde.id,
    volltext: kandidat.ausgabe.volltext,
    quelltext: quelltextTeile.length === 0 ? null : quelltextTeile.join('\n\n'),
    fakten: {
      blatt: kandidat.ausgabe.wochenblatt.name,
      nummer: kandidat.ausgabe.nummer ?? kandidat.ausgabe.schluessel,
      datum: kandidat.ausgabe.datum,
      gemeinde: gemeinde.name,
      titel: kandidat.titel,
      seite: kandidat.seite,
      typ: kandidat.typ,
      frontseite: kandidat.frontseite,
      zusammenfassung: kandidat.zusammenfassung ?? '',
      pdfUrl: kandidat.ausgabe.pdf_url,
      datenImText,
      ergaenzung: beitrag.ergaenzung
    }
  }
}

export interface GeschriebenePresseschau {
  bericht: { titel: string; lead: string; text: string }
  warnungen: string[]
  termin: Termin | null
  wichtig: boolean
}

/**
 * One write with the checks that make it a press review: attribution proven
 * (with one correction retry — a press review without its source is not a
 * press review), digits held to the handed facts, and the text slid over the
 * issue's own words. The overlap check runs BEFORE the source line is
 * appended — the URL's digits are nobody's claim.
 */
export async function presseschauMitChecks(
  fakten: PresseschauFakten,
  volltext: string | null,
  prompt: string
): Promise<GeschriebenePresseschau> {
  // One second attempt at the same prompt when the answer is not parseable
  // JSON — the run and the bulk button write unattended, and the same slip
  // would otherwise cost the candidate its draft (the Gemeindeseiten lesson
  // of 21 September 2026). Any other failure is not retried.
  const schreibe = async (): Promise<unknown> => {
    try {
      return await completeJson<unknown>({
        zweck: 'wochenblaetter:meldung',
        system: PRESSESCHAU_SYSTEM_PROMPT,
        prompt,
        maxTokens: 1500
      })
    } catch (fehler) {
      if (!(fehler instanceof ClaudeFormatError)) throw fehler
      return completeJson<unknown>({
        zweck: 'wochenblaetter:meldung:json-wiederholung',
        system: PRESSESCHAU_SYSTEM_PROMPT,
        prompt,
        maxTokens: 1500
      })
    }
  }
  let antwort = await schreibe()
  let bericht = parsePresseschau(antwort)

  let attribution = attributionsWarnung(
    `${bericht.lead} ${bericht.text}`,
    fakten
  )
  if (attribution !== null) {
    antwort = await completeJson<unknown>({
      zweck: 'wochenblaetter:meldung:nachfassen',
      system: PRESSESCHAU_SYSTEM_PROMPT,
      prompt: buildPresseschauRevision(
        fakten,
        bericht,
        `Nenne die Quelle im Fliesstext: "${fakten.blatt} (Nr. ${fakten.nummer})".`
      ),
      maxTokens: 1500
    })
    bericht = parsePresseschau(antwort)
    attribution = attributionsWarnung(`${bericht.lead} ${bericht.text}`, fakten)
  }

  // The termin rides in the same answer and is bound to the piece the same
  // way a municipal notice's is: a day the code did not find in it is
  // dropped, with a warning.
  const wichtig = wichtigAus(antwort)
  const geplant = planeMitteilungTermin(
    terminVorschlagAus(
      typeof antwort === 'object' && antwort !== null
        ? (antwort as Record<string, unknown>)['termin']
        : null
    ),
    fakten.datenImText ?? [],
    wichtig
  )

  const alles = `${bericht.titel} ${bericht.lead} ${bericht.text}`
  const warnungen = [
    ...zeitWarnungen(alles),
    ...zahlWarnungenPresseschau(alles, fakten),
    ...(attribution === null ? [] : [attribution]),
    ...(volltext !== null && volltext.trim().length >= 50
      ? ueberlappungsWarnungen(alles, volltext)
      : ['Volltext der Ausgabe fehlt — Ueberlappungs-Check uebersprungen.']),
    ...(geplant.warnung === null ? [] : [geplant.warnung]),
    ...ergaenzungsHinweis(fakten)
  ]

  return { bericht, warnungen, termin: geplant.termin, wichtig }
}

export interface PresseschauMeldungDienste {
  /** Reads the candidate with its issue and paper — the system's, in the endpoint too. */
  kandidatenLesen: Pick<LeseDienst, 'readOne'>
  /** Writes the decision — the caller's own. */
  kandidaten: Pick<SchreibDienst, 'updateOne'>
  meldungen: SchreibDienst
}

export interface PresseschauMeldungOptionen {
  /** A person's click decides (`uebernommen`, the learning signal); the run and the bulk button leave the candidate open. */
  uebernehmen: boolean
  /** The desk's `stufe: text` rules, as the article prompt takes them. */
  regeln: readonly string[]
  /** `wichtigkeitDigest` of the desk; loaded here when the caller has none. */
  wichtigkeit?: string
  /** The editor's part (`redaktion/ergaenzung.ts`); the run and the bulk button bring none. */
  beitrag?: RedaktionsBeitrag
}

/** One press-review Meldung for one candidate. */
export async function legePresseschauMeldungAn(
  dienste: PresseschauMeldungDienste,
  kandidatId: string,
  optionen: PresseschauMeldungOptionen
): Promise<{ meldung: string; warnungen: string[] }> {
  const beitrag = optionen.beitrag ?? OHNE_BEITRAG
  const geladen = await ladePresseschauFakten(
    dienste.kandidatenLesen,
    kandidatId,
    beitrag
  )
  const datengrundlage = {
    quelle: 'wochenblatt',
    blatt: geladen.fakten.blatt,
    nummer: geladen.fakten.nummer,
    datum: geladen.fakten.datum,
    seite: geladen.fakten.seite,
    beitrag: geladen.fakten.titel,
    pdf_url: geladen.fakten.pdfUrl,
    ...herkunftFelder(beitrag)
  }

  if (beitrag.eigene !== null) {
    const felder = eigeneFelder(beitrag.eigene, (text) =>
      mitQuelle(text, geladen.fakten)
    )
    const meldungId = (await dienste.meldungen.createOne({
      kandidat: kandidatId,
      gemeinde: geladen.gemeindeId,
      ...felder,
      termin: null,
      termin_vorschlag: null,
      wichtig: null,
      wichtig_vorschlag: null,
      datengrundlage
    })) as string
    if (optionen.uebernehmen) {
      await dienste.kandidaten.updateOne(kandidatId, {
        entscheid: 'uebernommen'
      })
    }
    return {
      meldung: meldungId,
      warnungen: (felder['zeit_warnungen'] as string[] | null) ?? []
    }
  }

  const wichtigkeit =
    optionen.wichtigkeit ??
    wichtigkeitDigest(
      await ladeWichtigkeitSignale(dienste.meldungen, 'kandidat')
    )
  const { bericht, warnungen, termin, wichtig } = await presseschauMitChecks(
    geladen.fakten,
    geladen.volltext,
    buildPresseschauPrompt(geladen.fakten, optionen.regeln, wichtigkeit)
  )

  const meldungId = (await dienste.meldungen.createOne({
    kandidat: kandidatId,
    gemeinde: geladen.gemeindeId,
    titel: bericht.titel,
    lead: bericht.lead,
    text: mitQuelle(bericht.text, geladen.fakten),
    status: 'entwurf',
    verarbeitung: 'idle',
    zeit_warnungen: warnungen.length > 0 ? warnungen : null,
    // The proposal is kept twice: once to edit, once to remember. The
    // newsroom's deviation from the second is the learning signal.
    termin,
    termin_vorschlag: termin,
    wichtig,
    wichtig_vorschlag: wichtig,
    datengrundlage
  })) as string

  if (optionen.uebernehmen) {
    await dienste.kandidaten.updateOne(kandidatId, {
      entscheid: 'uebernommen'
    })
  }
  return { meldung: meldungId, warnungen }
}

export interface FormulierAuswahlDienste {
  blaetter: Pick<LeseDienst, 'readByQuery'>
  ausgaben: Pick<LeseDienst, 'readByQuery'>
  kandidaten: Pick<LeseDienst, 'readByQuery'>
  meldungen: Pick<LeseDienst, 'readByQuery'>
}

interface AuswahlKandidat {
  id: string
  titel: string
  entscheid: string
  zeitbezug: string | null
  anlass_am: string | null
  zusammenfassung: string | null
  vorschlag_wert: number | null
}

/**
 * The desk's candidates, as the desk shows them: the NEWEST issue of each
 * paper (by date, the workspace query's order), candidates by page — and of
 * those, what a draft would be written for (`formulierbare`). With `abStufe`
 * it is the run's selection, without it the button's.
 */
export async function formulierAuswahl(
  dienste: FormulierAuswahlDienste,
  eingabe: {
    blattId?: string | null
    heute: string
    hoechstens?: number
    abStufe?: number | null
  }
): Promise<{
  dran: Array<{ id: string; titel: string }>
  wartend: number
  ohneZusammenfassung: number
}> {
  const blattId = eingabe.blattId ?? null
  const ids = (
    (await dienste.blaetter.readByQuery({
      filter: blattId === null ? {} : { id: { _eq: blattId } },
      fields: ['id'],
      limit: -1
    })) as Array<{ id: string }>
  ).map((b) => b.id)

  const alle: AuswahlKandidat[] = []
  for (const id of ids) {
    const [neueste] = (await dienste.ausgaben.readByQuery({
      filter: { wochenblatt: { _eq: id } },
      fields: ['id'],
      sort: ['-datum'],
      limit: 1
    })) as Array<{ id: string }>
    if (neueste === undefined) continue
    alle.push(
      ...((await dienste.kandidaten.readByQuery({
        filter: { ausgabe: { _eq: neueste.id } },
        fields: [
          'id',
          'titel',
          'entscheid',
          'zeitbezug',
          'anlass_am',
          'zusammenfassung',
          'vorschlag_wert'
        ],
        sort: ['seite'],
        limit: -1
      })) as AuswahlKandidat[])
    )
  }
  if (alle.length === 0) return { dran: [], wartend: 0, ohneZusammenfassung: 0 }

  const beschrieben = (await dienste.meldungen.readByQuery({
    filter: {
      kandidat: { _in: alle.map((k) => k.id) },
      status: { _neq: 'verworfen' }
    },
    fields: ['kandidat'],
    limit: -1
  })) as Array<{ kandidat: string }>
  return formulierbare(
    alle,
    new Set(beschrieben.map((m) => m.kandidat)),
    eingabe.heute,
    eingabe.hoechstens ?? PRESSESCHAU_FORMULIEREN_JE_KLICK,
    eingabe.abStufe ?? null
  )
}

/** Wie viele Entwuerfe ein Lauf schreibt. Ein Modellaufruf je Stueck. */
export const WOCHENBLATT_ENTWUERFE_JE_LAUF = 20

export interface WochenblattEntwuerfeErgebnis {
  geschrieben: number
  /** Die Meldungen, die dieser Lauf geschrieben hat. */
  ids: string[]
  /** Was der Deckel dieses Laufs liegen liess; der naechste holt es. */
  wartend: number
  /** Kandidaten ab der Schwelle ohne Faktenzusammenfassung — benannt, nie still uebergangen. */
  ohneZusammenfassung: number
  fehler: string[]
}

/**
 * Der Lauf schreibt den Entwurf zu jedem offenen Kandidaten der neuesten
 * Ausgaben, der AB DER SCHWELLE benotet ist und noch keinen Artikel hat — die
 * hoechste Stufe zuerst, hoechstens `hoechstens` je Lauf.
 *
 * Ueber ALLE Blaetter und nicht nur ueber die Ausgabe von heute: so greift
 * eine Schwelle, die die Redaktion hinter dem Zahnrad senkt, beim naechsten
 * Lauf, und ein Deckel, der gestern biss, wird heute abgearbeitet. Ein
 * unbenoteter Kandidat (vor dem 22.11.2026 gelesen) bekommt hier nie einen
 * Entwurf — der bleibt beim Knopf.
 */
export async function schreibeWochenblattEntwuerfe(
  dienste: FormulierAuswahlDienste &
    PresseschauMeldungDienste & {
      logger: {
        info: (text: string) => void
        warn: (fehler: unknown, text?: string) => void
      }
    },
  eingabe: {
    schwelle: number
    regeln: readonly string[]
    heute: string
    hoechstens?: number
  }
): Promise<WochenblattEntwuerfeErgebnis> {
  const auswahl = await formulierAuswahl(dienste, {
    heute: eingabe.heute,
    hoechstens: eingabe.hoechstens ?? WOCHENBLATT_ENTWUERFE_JE_LAUF,
    abStufe: eingabe.schwelle
  })
  const ergebnis: WochenblattEntwuerfeErgebnis = {
    geschrieben: 0,
    ids: [],
    wartend: auswahl.wartend,
    ohneZusammenfassung: auswahl.ohneZusammenfassung,
    fehler: []
  }
  if (auswahl.dran.length === 0) return ergebnis

  // Loaded once per run: what the newsroom decided about importance is the
  // same for every article of the desk.
  const wichtigkeit = wichtigkeitDigest(
    await ladeWichtigkeitSignale(dienste.meldungen, 'kandidat')
  )
  for (const kandidat of auswahl.dran) {
    try {
      const { meldung } = await legePresseschauMeldungAn(dienste, kandidat.id, {
        uebernehmen: false,
        regeln: eingabe.regeln,
        wichtigkeit
      })
      ergebnis.ids.push(meldung)
      ergebnis.geschrieben += 1
    } catch (fehler) {
      dienste.logger.warn(
        fehler,
        `wochenblatt: Entwurf zu "${kandidat.titel}" fehlgeschlagen.`
      )
      ergebnis.fehler.push(
        `${kandidat.titel} — ${fehler instanceof Error ? fehler.message : 'Fehler'}`
      )
    }
  }
  if (ergebnis.geschrieben > 0 || ergebnis.wartend > 0)
    dienste.logger.info(
      `wochenblatt: ${ergebnis.geschrieben} Entwuerfe geschrieben, ${ergebnis.wartend} warten.`
    )
  return ergebnis
}
