// The pure half of the Verkehr desk's daily reading: what of a freshly read
// sheet is new, what moved, what vanished — decided against the stored rows,
// with no model and no request anywhere in here. The Directus-bound half
// lives in `operations/quellen-pruefen`, like the EuroAirport's.

import {
  monatDeutsch,
  ordneGemeindeZu,
  type Anlage,
  type Ausgabe,
  type GemeindeZumZuordnen
} from '../shared/verkehr'
import { datumDeutsch } from './amtsblatt'

/** A stored installation, as the comparison needs it. */
export interface GespeicherterStandort {
  id: string
  schluessel: string
  gemeinde: string | null
  aktiv: boolean
  quelle_url: string | null
}

export interface NeuerStandort {
  anlage: Anlage
  gemeinde: string | null
  /** True for an installation in a covered municipality — the desk's proposal. */
  vorschlag: boolean
  begruendung: string | null
}

export interface StandortPlan {
  neu: NeuerStandort[]
  /** Rows still on the sheet: the fields the new reading sets. */
  aktualisieren: Array<{ id: string; felder: Record<string, unknown> }>
  /** Rows the sheet no longer lists — kept, marked inactive. */
  stilllegen: string[]
  hinweise: string[]
}

/**
 * The sheet's address as the rows remember it: without the query string.
 *
 * The page links the PDF with a cache-buster (`?_t=1791369921192`) that the
 * CMS renews on every render, so the same sheet carried a new address every
 * morning and the run fetched and re-planned it daily (measured 19 October
 * 2026). The newsroom's rule is the file: a new document is a new address,
 * and only then are there new installations.
 */
export function blattAdresse(pdfUrl: string): string {
  return pdfUrl.split('?')[0] ?? pdfUrl
}

/** Whether a sheet at this address was already read: every row of a reading carries its address. */
export function blattBekannt(
  bestand: ReadonlyArray<Pick<GespeicherterStandort, 'quelle_url'>>,
  pdfUrl: string
): boolean {
  const gesucht = blattAdresse(pdfUrl)
  return bestand.some(
    (zeile) =>
      zeile.quelle_url !== null && blattAdresse(zeile.quelle_url) === gesucht
  )
}

/**
 * The sheet against the stored rows.
 *
 * A location is new when its key was never stored; it is a PROPOSAL only
 * when it stands in a covered municipality — the newsroom's words of 11
 * October 2026: the Meldung matters when an installation is recognised at a
 * new location in the municipality. Every installation is stored, so the
 * desk shows the whole sheet; a location the sheet dropped is marked
 * inactive and keeps its history. The hints name what happened, so the
 * run's result says so without anyone opening a row.
 *
 * The FIRST sheet is the baseline and proposes nothing (the newsroom's
 * words of 19 October 2026: the installations already known are no hits).
 * A sheet lists what stands today, not what came since the last one, so
 * on the first read every location would look new — the Binningen camera
 * that has stood on the Bottmingerstrasse for years was proposed as news.
 * From the second sheet on, a key the rows never saw is what a new
 * installation looks like.
 */
export function standortPlan(eingabe: {
  anlagen: readonly Anlage[]
  bestand: readonly GespeicherterStandort[]
  gemeinden: readonly GemeindeZumZuordnen[]
  heute: string
  pdfUrl: string
  publiziertAm: string | null
}): StandortPlan {
  const bekannt = new Map(
    eingabe.bestand.map((zeile) => [zeile.schluessel, zeile])
  )
  const erstesBlatt = eingabe.bestand.length === 0
  const namen = new Map(eingabe.gemeinden.map((g) => [g.id, g.name]))
  const gesehen = new Set<string>()
  const neu: NeuerStandort[] = []
  const aktualisieren: StandortPlan['aktualisieren'] = []
  const adresse = blattAdresse(eingabe.pdfUrl)

  for (const anlage of eingabe.anlagen) {
    gesehen.add(anlage.schluessel)
    const gemeinde = ordneGemeindeZu(anlage, eingabe.gemeinden)
    const gemeinsam = {
      art: anlage.art,
      kennung: anlage.kennung,
      ab_wann: anlage.abWann,
      standort: anlage.standort,
      plz: anlage.plz,
      ort: anlage.ort,
      strasse: anlage.strasse,
      geschwindigkeit: anlage.geschwindigkeit,
      oertlichkeit: anlage.oertlichkeit,
      gemeinde,
      aktiv: true,
      zuletzt_gesehen: eingabe.heute,
      quelle_url: adresse,
      publikation_am: eingabe.publiziertAm
    }
    const vorhanden = bekannt.get(anlage.schluessel)
    if (vorhanden === undefined) {
      const name = gemeinde === null ? null : (namen.get(gemeinde) ?? null)
      const vorschlag = gemeinde !== null && !erstesBlatt
      neu.push({
        anlage,
        gemeinde,
        vorschlag,
        begruendung: vorschlag
          ? `Neue ${anlage.art === 'semistationaer' ? 'semistationaere' : 'stationaere'} Anlage in ${name ?? 'einer bespielten Gemeinde'}: ${anlage.standort}${
              anlage.abWann === null
                ? ''
                : `, ab ${datumDeutsch(anlage.abWann)}`
            }.`
          : null
      })
      continue
    }
    aktualisieren.push({ id: vorhanden.id, felder: gemeinsam })
  }

  const stilllegen = eingabe.bestand
    .filter((zeile) => zeile.aktiv && !gesehen.has(zeile.schluessel))
    .map((zeile) => zeile.id)

  const vorschlaege = neu.filter((n) => n.vorschlag).length
  const blatt = `${eingabe.anlagen.length} Standorte auf dem Blatt${
    eingabe.publiziertAm === null
      ? ''
      : ` vom ${datumDeutsch(eingabe.publiziertAm)}`
  }`
  const hinweise = [
    erstesBlatt
      ? `Radaranlagen: erstes Blatt, ${blatt} als Bestand uebernommen — nichts vorgeschlagen, neu ist erst, was ein spaeteres Blatt dazu bringt.`
      : `Radaranlagen: ${blatt}, ${neu.length} neu, davon ${vorschlaege} in bespielten Gemeinden; ${stilllegen.length} nicht mehr aufgefuehrt.`
  ]
  for (const n of neu) if (n.begruendung !== null) hinweise.push(n.begruendung)

  return { neu, aktualisieren, stilllegen, hinweise }
}

/** A stored month of speed controls, as the plan needs it. */
export interface GespeicherterMonat {
  id: string
  jahr: number
  monat: number
  quelle_url: string | null
}

/** How many sheets one run may fetch — a year, like the EuroAirport's. */
export const MAX_BLAETTER_JE_LAUF = 12

export interface Holplan {
  holen: Ausgabe[]
  hinweise: string[]
}

/**
 * Which of the linked months this run fetches, newest first: the ones never
 * stored, and the ones the page now links at another address. A cap that
 * bites is said in the run's result.
 */
export function zuHolenKontrollen(
  ausgaben: readonly Ausgabe[],
  bestand: readonly GespeicherterMonat[],
  hoechstens: number = MAX_BLAETTER_JE_LAUF
): Holplan {
  const bekannt = new Map(bestand.map((m) => [`${m.jahr}-${m.monat}`, m]))
  const offen = ausgaben
    .filter((ausgabe) => {
      const gespeichert = bekannt.get(`${ausgabe.jahr}-${ausgabe.monat}`)
      return gespeichert === undefined || gespeichert.quelle_url !== ausgabe.url
    })
    .sort((a, b) => b.jahr - a.jahr || b.monat - a.monat)
  const holen = offen.slice(0, hoechstens)
  const hinweise =
    offen.length > holen.length
      ? [
          `Geschwindigkeitskontrollen: ${holen.length} von ${offen.length} Monatsblaettern gelesen (Deckel ${hoechstens}), der Rest beim naechsten Lauf.`
        ]
      : []
  return { holen, hinweise }
}

export { monatDeutsch }
