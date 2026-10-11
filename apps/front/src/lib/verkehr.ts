// Der Verkehr-Tisch, pur: wie die Radarstandorte und die Monatsblaetter der
// Geschwindigkeitskontrollen geordnet, beschriftet und gezaehlt werden. Die
// Komponente rendert, was hier herauskommt; die Regel ist hier, damit ein
// Test sie erreicht.

import type {
  AlleMeldungFelder,
  GeschwindigkeitskontrolleFelder,
  RadarstandortFelder
} from '@/graphql/redaktion'

/** Die oeffentliche Seite des Kantons — verlinkt, nie das PDF hinter der Datentuer. */
export const RADAR_SEITE =
  'https://www.baselland.ch/politik-und-behorden/direktionen/sicherheitsdirektion/polizei/standorte-radaranlagen'

const MONATE = [
  'Januar',
  'Februar',
  'März',
  'April',
  'Mai',
  'Juni',
  'Juli',
  'August',
  'September',
  'Oktober',
  'November',
  'Dezember'
] as const

/** «18. September 2026» aus einem ISO-Tag; null bleibt null. */
export function datumLang(iso: string | null | undefined): string | null {
  if (iso === null || iso === undefined) return null
  const [jahr, monat, tag] = iso.slice(0, 10).split('-').map(Number)
  if (jahr === undefined || monat === undefined || tag === undefined || Number.isNaN(tag)) return iso
  return `${tag}. ${MONATE[monat - 1] ?? monat} ${jahr}`
}

export function monatLang(jahr: number, monat: number): string {
  return `${MONATE[monat - 1] ?? monat} ${jahr}`
}

function artText(art: string): string {
  return art === 'semistationaer' ? 'semistationär' : art === 'stationaer' ? 'stationär' : art
}

/** «Binningerstrasse, Allschwil» — oder die Standortzeile, wo das Blatt keine Strasse trennt. */
export function standortTitel(z: Pick<RadarstandortFelder, 'standort' | 'strasse' | 'ort'>): string {
  if (z.strasse !== null && z.ort !== null) return `${z.strasse}, ${z.ort}`
  return z.standort
}

/** «semistationär · SEMI 03 · 50 km/h · ab 18. September 2026» */
export function standortDetails(
  z: Pick<RadarstandortFelder, 'art' | 'kennung' | 'geschwindigkeit' | 'ab_wann'>
): string {
  const teile = [
    artText(z.art),
    z.kennung,
    z.geschwindigkeit === null ? null : `${z.geschwindigkeit} km/h`,
    z.ab_wann === null ? null : `ab ${datumLang(z.ab_wann)}`
  ]
  return teile.filter((t): t is string => t !== null && t !== '').join(' · ')
}

function lebendig(m: AlleMeldungFelder): boolean {
  return m.status !== 'verworfen'
}

export function meldungZuStandort(
  meldungen: readonly AlleMeldungFelder[],
  standortId: string
): AlleMeldungFelder | null {
  return meldungen.find((m) => (m.radarstandort ?? null)?.id === standortId && lebendig(m)) ?? null
}

export function meldungZuMonat(
  meldungen: readonly AlleMeldungFelder[],
  monatId: string
): AlleMeldungFelder | null {
  return meldungen.find((m) => (m.geschwindigkeitskontrolle ?? null)?.id === monatId && lebendig(m)) ?? null
}

export interface StandortMitMeldung {
  standort: RadarstandortFelder
  meldung: AlleMeldungFelder | null
}

export interface Standortgruppen {
  /** Neu in einer bespielten Gemeinde, noch ohne Meldung — das ist der Tisch. */
  vorschlaege: StandortMitMeldung[]
  /** Die uebrigen Anlagen in bespielten Gemeinden, mit ihrer Meldung, wo eine ist. */
  bespielt: StandortMitMeldung[]
  /** Ausserhalb des Redaktionsgebiets oder nicht mehr auf dem Blatt — eine Klick weit darunter. */
  andere: RadarstandortFelder[]
}

/**
 * Die Anlagen in drei Stapeln. Ein Vorschlag bleibt einer, bis eine Meldung
 * dazu existiert; eine Anlage ausserhalb der bespielten Gemeinden wird
 * gezeigt, aber nie vorgeschlagen — das Blatt ist vollstaendig auf dem Tisch,
 * die Arbeit nicht.
 */
export function ordneStandorte(
  standorte: readonly RadarstandortFelder[],
  meldungen: readonly AlleMeldungFelder[]
): Standortgruppen {
  const vorschlaege: StandortMitMeldung[] = []
  const bespielt: StandortMitMeldung[] = []
  const andere: RadarstandortFelder[] = []
  for (const standort of standorte) {
    if (!standort.aktiv || standort.gemeinde === null) {
      andere.push(standort)
      continue
    }
    const meldung = meldungZuStandort(meldungen, standort.id)
    if (standort.vorschlag && meldung === null) vorschlaege.push({ standort, meldung: null })
    else bespielt.push({ standort, meldung })
  }
  const nachTag = (a: StandortMitMeldung, b: StandortMitMeldung) =>
    (b.standort.erstmals_gesehen ?? '').localeCompare(a.standort.erstmals_gesehen ?? '') ||
    a.standort.standort.localeCompare(b.standort.standort)
  vorschlaege.sort(nachTag)
  bespielt.sort(nachTag)
  andere.sort((a, b) => Number(b.aktiv) - Number(a.aktiv) || a.standort.localeCompare(b.standort))
  return { vorschlaege, bespielt, andere }
}

export interface Monatsbilanz {
  kontrollen: number
  gemessen: number
  uebertretungen: number
  quote: number | null
  meiste: { messort: string; uebertretungen: number; gemessen: number; quote: number | null } | null
  schnellster: {
    vmax: number
    signalisiert: number
    messort: string
    datum: string
    von: string
    bis: string
  } | null
}

function zahl(wert: unknown): number | null {
  return typeof wert === 'number' && Number.isFinite(wert) ? wert : null
}

/** Die gespeicherte Bilanz, geprueft gelesen — ein Blatt ohne Bilanz liefert null, nie eine erfundene. */
export function alsBilanz(roh: unknown): Monatsbilanz | null {
  if (typeof roh !== 'object' || roh === null) return null
  const b = roh as Record<string, unknown>
  const kontrollen = zahl(b['kontrollen'])
  const gemessen = zahl(b['gemessen'])
  const uebertretungen = zahl(b['uebertretungen'])
  if (kontrollen === null || gemessen === null || uebertretungen === null) return null
  const meisteRoh = b['meiste'] as Record<string, unknown> | null | undefined
  const schnellsterRoh = b['schnellster'] as Record<string, unknown> | null | undefined
  return {
    kontrollen,
    gemessen,
    uebertretungen,
    quote: zahl(b['quote']),
    meiste:
      meisteRoh === null || meisteRoh === undefined || typeof meisteRoh['messort'] !== 'string'
        ? null
        : {
            messort: meisteRoh['messort'],
            uebertretungen: zahl(meisteRoh['uebertretungen']) ?? 0,
            gemessen: zahl(meisteRoh['gemessen']) ?? 0,
            quote: zahl(meisteRoh['quote'])
          },
    schnellster:
      schnellsterRoh === null ||
      schnellsterRoh === undefined ||
      typeof schnellsterRoh['messort'] !== 'string' ||
      typeof schnellsterRoh['datum'] !== 'string'
        ? null
        : {
            vmax: zahl(schnellsterRoh['vmax']) ?? 0,
            signalisiert: zahl(schnellsterRoh['signalisiert']) ?? 0,
            messort: schnellsterRoh['messort'],
            datum: schnellsterRoh['datum'],
            von: typeof schnellsterRoh['von'] === 'string' ? schnellsterRoh['von'] : '',
            bis: typeof schnellsterRoh['bis'] === 'string' ? schnellsterRoh['bis'] : ''
          }
  }
}

function prozent(wert: number | null): string {
  return wert === null ? '' : ` (${String(wert).replace('.', ',')} %)`
}

/** «9 Kontrollen · 738 Fahrzeuge · 157 Übertretungen (21,3 %)» */
export function bilanzText(bilanz: Monatsbilanz): string {
  return `${bilanz.kontrollen} ${bilanz.kontrollen === 1 ? 'Kontrolle' : 'Kontrollen'} · ${bilanz.gemessen} Fahrzeuge · ${bilanz.uebertretungen} Übertretungen${prozent(bilanz.quote)}`
}

/** «Meiste Übertretungen: Hinterkirchweg, 35 von 99 (35,4 %)» */
export function meisteText(bilanz: Monatsbilanz): string | null {
  if (bilanz.meiste === null) return null
  return `Meiste Übertretungen: ${bilanz.meiste.messort}, ${bilanz.meiste.uebertretungen} von ${bilanz.meiste.gemessen}${prozent(bilanz.meiste.quote)}`
}

/** «Schnellstes Fahrzeug: 48 km/h bei 30 km/h, Hinterlindenweg, 8. September 2026, 07:12–08:48 Uhr» */
export function schnellsterText(bilanz: Monatsbilanz): string | null {
  const s = bilanz.schnellster
  if (s === null) return null
  const zeit = s.von === '' ? '' : `, ${s.von}–${s.bis} Uhr`
  return `Schnellstes Fahrzeug: ${s.vmax} km/h bei ${s.signalisiert} km/h, ${s.messort}, ${datumLang(s.datum)}${zeit}`
}

export interface MonatMitMeldung {
  monat: GeschwindigkeitskontrolleFelder
  bilanz: Monatsbilanz | null
  meldung: AlleMeldungFelder | null
}

/** Die Monate, neueste zuerst, jeder mit seiner Bilanz und seiner Meldung. */
export function ordneMonate(
  monate: readonly GeschwindigkeitskontrolleFelder[],
  meldungen: readonly AlleMeldungFelder[]
): MonatMitMeldung[] {
  return [...monate]
    .sort((a, b) => b.jahr - a.jahr || b.monat - a.monat)
    .map((monat) => ({
      monat,
      bilanz: alsBilanz(monat.bilanz),
      meldung: meldungZuMonat(meldungen, monat.id)
    }))
}

/** Wie viele der neuesten Monate je Gemeinde ohne Meldung zaehlen — der Rueckstand des ersten Lesens ist keine Arbeit. */
export const OFFENE_MONATE_JE_GEMEINDE = 2

/**
 * Der Zaehler des Tischs: neue Anlagen ohne Meldung, plus die neuesten
 * Monate je Gemeinde ohne Meldung. Sieben Monate Rueckstand beim ersten
 * Lesen sind kein Berg Arbeit, sondern Archiv — darum nur die letzten zwei.
 */
export function zaehlerVerkehr(
  standorte: readonly RadarstandortFelder[],
  monate: readonly GeschwindigkeitskontrolleFelder[],
  meldungen: readonly AlleMeldungFelder[]
): number {
  const offeneStandorte = ordneStandorte(standorte, meldungen).vorschlaege.length
  const jeGemeinde = new Map<string, number>()
  let offeneMonate = 0
  for (const { monat, meldung } of ordneMonate(monate, meldungen)) {
    const schluessel = monat.gemeinde?.id ?? '?'
    const bisher = jeGemeinde.get(schluessel) ?? 0
    if (bisher >= OFFENE_MONATE_JE_GEMEINDE) continue
    jeGemeinde.set(schluessel, bisher + 1)
    if (meldung === null) offeneMonate += 1
  }
  return offeneStandorte + offeneMonate
}
