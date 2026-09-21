// Eine Meldung je vorgeschlagener Gemeinde-Mitteilung — geschrieben im Lauf,
// nicht erst auf Klick.
//
// Dieselbe Abmachung wie beim Sporttisch (`spielberichte.ts`): die Redaktion
// findet morgens einen geschriebenen Artikel und keinen Knopf. Sie sagte es am
// 21. September 2026 so: die Gemeindeseite laufe sehr gut, es solle nur noch
// „publizieren" zu klicken sein.
//
// **Nur die VORSCHLAEGE.** Was die Sichtung nicht vorgeschlagen hat, bleibt
// liegen wie bisher — auf dem Tisch, einen Klick entfernt, ohne Artikel. Das
// ist die halbe Ersparnis: ein Modellaufruf je Vorschlag statt je Zeile.
//
// **Und es LEHRT nicht.** Die drei Entscheide der Redaktion sind das
// Lernsignal dieses Tischs; ein Artikel, den der Lauf schreibt, ist keiner.
// Darum steht hier kein `lerne(…)` — und darum bleiben Ablehnen und
// Weiterreichen auf der Zeile stehen, auch wenn der Artikel schon dasteht.

import { completeJson, ClaudeFormatError } from '../shared/claude'
import {
  attributionsWarnung,
  buildMitteilungPrompt,
  MELDUNG_SYSTEM_PROMPT,
  mitQuelle,
  parseMitteilung,
  buildMitteilungRevision,
  ueberlappungsWarnungen,
  volltextVon,
  zahlWarnungen,
  zeitWarnungen,
  linkWarnungen,
  type MitteilungFakten
} from './gemeindeseite'

/** Wie viele Meldungen ein Lauf schreibt. Ein Modellaufruf je Stueck. */
export const GEMEINDE_MELDUNGEN_JE_LAUF = 20

export interface MitteilungRohzeile {
  id: string
  url: string
  url_kanonisch: string | null
  quelle_seite: string | null
  titel: string
  teaser: string | null
  publiziert_am: string | null
  veranstaltung_am: string | null
  kategorie: string | null
  text: string | null
  text_abgeschnitten: boolean
  anhaenge: Array<{
    bezeichnung: string
    url: string
    typ: 'pdf' | 'link'
    gelesen: boolean
    text?: string | null
    grund?: string
  }> | null
  entscheid: string
  vorschlag_begruendung: string | null
  gemeinde: { id: string; name: string }
}

export const MITTEILUNG_FELDER = [
  'id',
  'url',
  'url_kanonisch',
  'quelle_seite',
  'titel',
  'teaser',
  'publiziert_am',
  'veranstaltung_am',
  'kategorie',
  'text',
  'text_abgeschnitten',
  'anhaenge',
  'entscheid',
  'vorschlag_begruendung',
  'gemeinde.id',
  'gemeinde.name'
]

export function mitteilungFakten(zeile: MitteilungRohzeile): MitteilungFakten {
  return {
    gemeinde: zeile.gemeinde.name,
    titel: zeile.titel,
    teaser: zeile.teaser,
    publiziertAm: zeile.publiziert_am,
    veranstaltungAm: zeile.veranstaltung_am,
    kategorie: zeile.kategorie,
    text: zeile.text ?? '',
    textAbgeschnitten: zeile.text_abgeschnitten,
    anhaenge: (zeile.anhaenge ?? []).map((a) => ({
      bezeichnung: a.bezeichnung,
      url: a.url,
      typ: a.typ,
      gelesen: a.gelesen,
      text: a.text ?? null,
      grund: a.grund ?? null
    })),
    // The page the article is shown on — canonical where known.
    url: zeile.url_kanonisch ?? zeile.url
  }
}

/**
 * Ob aus dieser Zeile ueberhaupt ein Artikel werden darf.
 *
 * Kein Artikel aus Titel und Anriss: er LIEST sich vollstaendig und ist es
 * nicht. Der Leser hat gespeichert, was er bekam; war das nichts, ist die
 * ehrliche Antwort eine Absage.
 */
export function hatMaterial(fakten: MitteilungFakten): boolean {
  if (fakten.text.trim() !== '') return true
  return fakten.anhaenge.some((a) => a.gelesen && (a.text ?? '').trim() !== '')
}

/**
 * Ein Versuch, und bei unlesbarem JSON genau ein zweiter.
 *
 * Gemessen am ersten unbeaufsichtigten Lauf (21.09.2026): einer von zwanzig
 * Artikeln scheiterte daran, dass die Antwort kein gueltiges JSON war — NICHT
 * am Token-Limit, dafuer gaebe es einen eigenen Fehler. Solange ein Mensch
 * den Knopf drueckte, war das ein sichtbarer Fehlschlag und ein zweiter
 * Klick; jetzt schreibt der Lauf, und derselbe Ausrutscher wuerde die Zeile
 * jeden Tag aufs Neue kosten. Ein zweiter Versuch mit demselben Prompt kostet
 * einen Aufruf und heilt einen Zufall — hilft er nicht, scheitert die Zeile
 * laut wie bisher.
 */
async function schreibeEinmalMitNachfassen(prompt: string): Promise<unknown> {
  try {
    return await completeJson<unknown>({
      system: MELDUNG_SYSTEM_PROMPT,
      prompt,
      maxTokens: 1500
    })
  } catch (fehler) {
    if (!(fehler instanceof ClaudeFormatError)) throw fehler
    return completeJson<unknown>({
      system: MELDUNG_SYSTEM_PROMPT,
      prompt,
      maxTokens: 1500
    })
  }
}

/**
 * The article, with the checks that make its rules real: attribution to
 * the municipality (retried once), digits against the handed material,
 * absolute dates, no self-written links, and the verbatim-overlap check
 * against the municipality's own text — a Meldung in the municipality's
 * words is its press release, not our reporting.
 */
export async function mitteilungMitChecks(
  fakten: MitteilungFakten,
  prompt: string
): Promise<{
  bericht: { titel: string; lead: string; text: string }
  warnungen: string[]
}> {
  let bericht = parseMitteilung(await schreibeEinmalMitNachfassen(prompt))

  let attribution = attributionsWarnung(
    `${bericht.lead} ${bericht.text}`,
    fakten
  )
  if (attribution !== null) {
    bericht = parseMitteilung(
      await completeJson<unknown>({
        system: MELDUNG_SYSTEM_PROMPT,
        prompt: buildMitteilungRevision(
          fakten,
          bericht,
          `Nenne die Quelle im Fliesstext: "wie die Gemeinde ${fakten.gemeinde} mitteilt".`
        ),
        maxTokens: 1500
      })
    )
    attribution = attributionsWarnung(`${bericht.lead} ${bericht.text}`, fakten)
  }

  const alles = `${bericht.titel} ${bericht.lead} ${bericht.text}`
  const warnungen = [
    ...zeitWarnungen(alles),
    ...zahlWarnungen(alles, fakten),
    ...linkWarnungen(alles),
    ...ueberlappungsWarnungen(
      `${bericht.lead} ${bericht.text}`,
      volltextVon(fakten)
    ).map((w) => w.replace('aus dem Blatt', 'aus der Mitteilung')),
    ...(attribution === null ? [] : [attribution])
  ]

  return { bericht, warnungen }
}

/** Was der Artikel dem Dorfkoenig ohne Join mitgibt. */
export function datengrundlageVon(
  zeile: MitteilungRohzeile,
  fakten: MitteilungFakten
): Record<string, unknown> {
  return {
    quelle: 'gemeindeseite',
    quelle_name: `Gemeinde ${zeile.gemeinde.name}`,
    gemeinde: zeile.gemeinde.name,
    titel: zeile.titel,
    publiziert_am: zeile.publiziert_am,
    // Working material, not a field of the door: a consumer reads the day
    // out of the text, which says it absolutely.
    veranstaltung_am: zeile.veranstaltung_am,
    kategorie: zeile.kategorie,
    url: fakten.url,
    quelle_seite: zeile.quelle_seite,
    anhaenge: fakten.anhaenge.map((a) => ({
      bezeichnung: a.bezeichnung,
      url: a.url,
      typ: a.typ,
      gelesen: a.gelesen
    })),
    text_abgeschnitten: zeile.text_abgeschnitten
  }
}

interface ItemsServiceLike {
  readByQuery(query: Record<string, unknown>): Promise<unknown[]>
  createOne(payload: Record<string, unknown>): Promise<string | number>
  updateOne(
    key: string,
    payload: Record<string, unknown>
  ): Promise<string | number>
}

export interface GemeindeMeldungKontext {
  mitteilungen: ItemsServiceLike
  meldungen: ItemsServiceLike
  regeln: readonly string[]
  logger: { info: (text: string) => void; warn: (...args: unknown[]) => void }
}

/** Eine Meldung aus einer Zeile — der eine Weg, den Knopf und Lauf teilen. */
export async function schreibeGemeindeMeldung(
  kontext: Pick<
    GemeindeMeldungKontext,
    'mitteilungen' | 'meldungen' | 'regeln'
  >,
  zeile: MitteilungRohzeile
): Promise<{ meldung: string; warnungen: string[] }> {
  const fakten = mitteilungFakten(zeile)
  const { bericht, warnungen } = await mitteilungMitChecks(
    fakten,
    buildMitteilungPrompt(fakten, kontext.regeln)
  )

  const meldungId = (await kontext.meldungen.createOne({
    gemeindemitteilung: zeile.id,
    gemeinde: zeile.gemeinde.id,
    titel: bericht.titel,
    lead: bericht.lead,
    text: mitQuelle(bericht.text, fakten),
    status: 'entwurf',
    verarbeitung: 'idle',
    zeit_warnungen: warnungen.length > 0 ? warnungen : null,
    datengrundlage: datengrundlageVon(zeile, fakten)
  })) as string

  await kontext.mitteilungen.updateOne(zeile.id, {
    entscheid: 'uebernommen'
  })

  return { meldung: meldungId, warnungen }
}

export interface GemeindeMeldungenErgebnis {
  geschrieben: number
  /** Vorschlaege ohne lesbaren Text — benannt, nie still uebergangen. */
  ohneText: string[]
  /** Was der Deckel dieses Laufs liegen liess; der naechste holt es. */
  wartend: number
  fehler: string[]
}

/**
 * Jeder Vorschlag ohne Artikel bekommt seinen — hoechstens `hoechstens` je Lauf.
 *
 * Die Reihenfolge ist die des Tischs: das Naechstliegende zuerst, damit ein
 * Rueckstand die dringenden Zeilen nicht hinter den alten begraebt.
 */
export async function schreibeGemeindeMeldungen(
  kontext: GemeindeMeldungKontext,
  hoechstens: number = GEMEINDE_MELDUNGEN_JE_LAUF
): Promise<GemeindeMeldungenErgebnis> {
  const ergebnis: GemeindeMeldungenErgebnis = {
    geschrieben: 0,
    ohneText: [],
    wartend: 0,
    fehler: []
  }

  const beschrieben = (await kontext.meldungen.readByQuery({
    filter: {
      gemeindemitteilung: { _nnull: true },
      status: { _neq: 'verworfen' }
    },
    fields: ['gemeindemitteilung'],
    limit: -1
  })) as Array<{ gemeindemitteilung: string | null }>
  const schonBeschrieben = new Set(
    beschrieben.flatMap((m) =>
      m.gemeindemitteilung === null ? [] : [m.gemeindemitteilung]
    )
  )

  const vorschlaege = (await kontext.mitteilungen.readByQuery({
    filter: { vorschlag: { _eq: true }, entscheid: { _eq: 'offen' } },
    fields: MITTEILUNG_FELDER,
    sort: ['-publiziert_am', '-date_created'],
    limit: -1
  })) as MitteilungRohzeile[]

  const offen = vorschlaege.filter((z) => !schonBeschrieben.has(z.id))
  const dran = offen.slice(0, hoechstens)
  ergebnis.wartend = offen.length - dran.length

  for (const zeile of dran) {
    if (!hatMaterial(mitteilungFakten(zeile))) {
      ergebnis.ohneText.push(`${zeile.gemeinde.name}: ${zeile.titel}`)
      continue
    }
    try {
      await schreibeGemeindeMeldung(kontext, zeile)
      ergebnis.geschrieben += 1
    } catch (fehler) {
      kontext.logger.warn(
        fehler,
        `gemeindeseiten: Meldung zu "${zeile.titel}" fehlgeschlagen.`
      )
      ergebnis.fehler.push(
        `${zeile.gemeinde.name}: ${zeile.titel} — ${
          fehler instanceof Error ? fehler.message : 'Fehler'
        }`
      )
    }
  }

  if (ergebnis.geschrieben > 0 || ergebnis.wartend > 0) {
    kontext.logger.info(
      `gemeindeseiten: ${ergebnis.geschrieben} Meldungen geschrieben, ${ergebnis.wartend} warten.`
    )
  }
  return ergebnis
}
