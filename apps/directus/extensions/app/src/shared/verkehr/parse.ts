// The two traffic sheets the Verkehr desk reads, as text — no model anywhere
// near a figure.
//
// 1. The Polizei Basel-Landschaft's «Standorte von automatischen
//    Kontrollanlagen»: one PDF, re-uploaded under a new name whenever a
//    speed-camera location changes (the file name carries the day of the
//    newest entry, `20261007_…`). Semi-stationary installations come as
//    blocks of `SEMI nn / Ab wann / Standort / Geschwindigkeit / Örtlichkeit`
//    separated by lines of asterisks; stationary ones as the same block
//    without the number and the date. Measured on the sheet of 7 October
//    2026: six installations, two of them in covered municipalities
//    (Allschwil, Binningen).
//
// 2. The Gemeindepolizei Reinach's monthly «Geschwindigkeitskontrollen»: one
//    PDF per month, one line per control — date, time window, street, signed
//    limit, vehicles measured, violations, highest speed — and, in some
//    months, a second table of the traffic-statistics device SR7 (a period,
//    a street, vehicles measured, V85). Measured over March to September
//    2026: the table shape is stable, but the HEADER is not — the March sheet
//    is titled «Geschwindigkeitskontrollen Januar 2026, Datum 31.01.2026»
//    over rows from 4 to 25 March. The month therefore comes from the rows,
//    and the header's disagreement is a finding on the row.

export type AnlageArt = 'semistationaer' | 'stationaer'

export interface Anlage {
  art: AnlageArt
  /** «SEMI 03» — only the semi-stationary ones carry one. */
  kennung: string | null
  /** ISO day the installation is in place from — semi-stationary only. */
  abWann: string | null
  /** The location line as printed: «4123 Allschwil, Binningerstrasse». */
  standort: string
  plz: string | null
  ort: string | null
  strasse: string | null
  /** The signed limit in km/h. */
  geschwindigkeit: number | null
  oertlichkeit: string | null
  /** Identity across sheets: the kind and the normalised location. */
  schluessel: string
}

export interface Standortblatt {
  anlagen: Anlage[]
  /** German sentences about what the sheet carried that could not be read — never silent. */
  hinweise: string[]
}

const TRENNER = /^\*{10,}$/
const SEITENZAHL = /^\d+\/\d+$/
const KENNUNG = /^(SEMI\s*\d+)$/i
const AB_WANN = /^Ab wann:\s*(.*)$/i
const STANDORT = /^Standort:\s*(.*)$/i
const GESCHWINDIGKEIT = /^Geschwindigkeit:\s*(\d+)/i
const OERTLICHKEIT = /^(?:Ö|Oe)rtlichkeit:\s*(.*)$/i

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** «25.09.2026» → «2026-09-25»; null for anything else. */
export function isoAusDeutsch(text: string): string | null {
  const treffer = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(text.trim())
  if (treffer === null) return null
  const [, tag, monat, jahr] = treffer
  return `${jahr}-${(monat ?? '').padStart(2, '0')}-${(tag ?? '').padStart(2, '0')}`
}

/** The location line taken apart: postcode, place and street where the sheet prints them that way. */
export function zerlegeStandort(standort: string): {
  plz: string | null
  ort: string | null
  strasse: string | null
} {
  const mitStrasse = /^(\d{4})\s+([^,]+?)\s*,\s*(.+)$/.exec(standort)
  if (mitStrasse !== null) {
    return {
      plz: mitStrasse[1] ?? null,
      ort: (mitStrasse[2] ?? '').trim() || null,
      strasse: (mitStrasse[3] ?? '').trim() || null
    }
  }
  const nurOrt = /^(\d{4})\s+(.+)$/.exec(standort)
  if (nurOrt !== null) {
    return {
      plz: nurOrt[1] ?? null,
      ort: (nurOrt[2] ?? '').trim() || null,
      strasse: null
    }
  }
  return { plz: null, ort: null, strasse: null }
}

export function anlagenSchluessel(art: AnlageArt, standort: string): string {
  return `${art}|${slug(standort)}`
}

interface Block {
  art: AnlageArt
  kennung: string | null
  abWann: string | null
  standort: string | null
  geschwindigkeit: number | null
  oertlichkeit: string | null
  /** Which field the last key line set — a bare line continues it. */
  zuletzt: 'standort' | 'oertlichkeit' | 'andere' | null
}

/**
 * Reads the canton's sheet. A block without a location is reported, not
 * guessed; a location that appears twice keeps its first reading and says
 * so; prose between the section title and the first block (the sheet's own
 * caveats) is skipped without a word, because it is not an installation.
 */
export function parseStandortblatt(text: string): Standortblatt {
  const zeilen = text
    .split(/\r?\n/)
    .map((z) => z.replace(/\f/g, '').trim())
    .filter((z) => z !== '' && !SEITENZAHL.test(z))

  const anlagen: Anlage[] = []
  const hinweise: string[] = []
  const gesehen = new Set<string>()
  let art: AnlageArt | null = null
  let block: Block | null = null

  const schliesse = (): void => {
    if (block === null) return
    const b = block
    block = null
    const hatteSchluessel =
      b.kennung !== null || b.abWann !== null || b.geschwindigkeit !== null
    if (b.standort === null) {
      if (hatteSchluessel)
        hinweise.push(
          `Ein Block ohne Standort wurde uebergangen (${b.kennung ?? 'ohne Kennung'}).`
        )
      return
    }
    const schluessel = anlagenSchluessel(b.art, b.standort)
    if (gesehen.has(schluessel)) {
      hinweise.push(
        `Der Standort «${b.standort}» steht zweimal auf dem Blatt — die erste Nennung gilt.`
      )
      return
    }
    gesehen.add(schluessel)
    anlagen.push({
      art: b.art,
      kennung: b.kennung,
      abWann: b.abWann,
      standort: b.standort,
      ...zerlegeStandort(b.standort),
      geschwindigkeit: b.geschwindigkeit,
      oertlichkeit: b.oertlichkeit,
      schluessel
    })
  }

  const oeffne = (): Block | null => {
    if (art === null) return null
    if (block === null) {
      block = {
        art,
        kennung: null,
        abWann: null,
        standort: null,
        geschwindigkeit: null,
        oertlichkeit: null,
        zuletzt: null
      }
    }
    return block
  }

  for (const zeile of zeilen) {
    if (/^Semistation/i.test(zeile)) {
      schliesse()
      art = 'semistationaer'
      continue
    }
    if (/^Station/i.test(zeile)) {
      schliesse()
      art = 'stationaer'
      continue
    }
    if (TRENNER.test(zeile)) {
      schliesse()
      continue
    }

    let treffer: RegExpExecArray | null
    if ((treffer = KENNUNG.exec(zeile)) !== null) {
      const b = oeffne()
      if (b === null) continue
      b.kennung = (treffer[1] ?? '').replace(/\s+/g, ' ').toUpperCase()
      b.zuletzt = 'andere'
    } else if ((treffer = AB_WANN.exec(zeile)) !== null) {
      const b = oeffne()
      if (b === null) continue
      const iso = isoAusDeutsch(treffer[1] ?? '')
      if (iso === null)
        hinweise.push(
          `«Ab wann: ${treffer[1] ?? ''}» ist kein Datum — nicht gelesen.`
        )
      b.abWann = iso
      b.zuletzt = 'andere'
    } else if ((treffer = STANDORT.exec(zeile)) !== null) {
      const b = oeffne()
      if (b === null) continue
      b.standort = (treffer[1] ?? '').trim()
      b.zuletzt = 'standort'
    } else if ((treffer = GESCHWINDIGKEIT.exec(zeile)) !== null) {
      const b = oeffne()
      if (b === null) continue
      b.geschwindigkeit = Number.parseInt(treffer[1] ?? '', 10)
      b.zuletzt = 'andere'
    } else if ((treffer = OERTLICHKEIT.exec(zeile)) !== null) {
      const b = oeffne()
      if (b === null) continue
      b.oertlichkeit = (treffer[1] ?? '').trim().replace(/,$/, '')
      b.zuletzt = 'oertlichkeit'
    } else if (block !== null) {
      // A wrapped field: «Örtlichkeit: Innerorts, …, Einmündung,» continues
      // on the next line (measured on Binningen's Bottmingerstrasse).
      const b: Block = block
      if (b.zuletzt === 'oertlichkeit') {
        b.oertlichkeit =
          `${(b.oertlichkeit ?? '').replace(/,$/, '')}, ${zeile.replace(/,$/, '')}`.replace(
            /^, /,
            ''
          )
      } else if (b.zuletzt === 'standort') {
        b.standort = `${b.standort ?? ''} ${zeile}`.trim()
      }
      // Prose before the first key line of a block (the sheet's caveats) is
      // not part of any installation and is left alone.
    }
  }
  schliesse()

  return { anlagen, hinweise }
}

/** A covered municipality as the assignment needs it. */
export interface GemeindeZumZuordnen {
  id: string
  name: string
  /**
   * `gemeinden.plz` — a JSON list of postcodes in the schema, a string with
   * commas or spaces from an older row or a test. Both are read; the first
   * live run (11 October 2026) failed on the list with `.split is not a
   * function`.
   */
  plz: ReadonlyArray<string | number> | string | number | null
}

/** The postcodes of a municipality, whatever shape the row carries them in. */
export function postleitzahlen(plz: GemeindeZumZuordnen['plz']): string[] {
  if (plz === null || plz === undefined) return []
  const roh = Array.isArray(plz)
    ? plz.map(String)
    : String(plz).split(/[\s,;]+/)
  return roh.map((c) => c.trim()).filter((c) => c !== '')
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Which covered municipality an installation stands in: the postcode first
 * (4123 is Allschwil and nothing else), the place name with word boundaries
 * second (an installation «A2/A3 Augst» prints no postcode). Null for every
 * installation outside the newsroom's area — stored all the same, so the
 * sheet is complete on the desk, but proposed never.
 */
export function ordneGemeindeZu(
  anlage: Pick<Anlage, 'plz' | 'ort' | 'standort'>,
  gemeinden: readonly GemeindeZumZuordnen[]
): string | null {
  if (anlage.plz !== null) {
    for (const g of gemeinden) {
      if (postleitzahlen(g.plz).includes(anlage.plz)) return g.id
    }
  }
  const text = anlage.ort ?? anlage.standort
  for (const g of gemeinden) {
    const muster = new RegExp(
      `(^|[^\\p{L}])${escapeRegExp(g.name)}(?=$|[^\\p{L}])`,
      'u'
    )
    if (muster.test(text)) return g.id
  }
  return null
}

// ---------------------------------------------------------------------------
// Reinach's monthly speed-control sheet
// ---------------------------------------------------------------------------

export interface Kontrolle {
  /** ISO day of the control. */
  datum: string
  von: string
  bis: string
  messort: string
  /** The signed limit in km/h. */
  signalisiert: number
  gemessen: number
  uebertretungen: number
  /** The highest measured speed in km/h. */
  vmax: number
}

/** One period of the traffic-statistics device SR7. */
export interface Messung {
  von: string
  bis: string
  messort: string
  signalisiert: number
  gemessen: number
  /** The speed 85 percent of the measured vehicles stayed under, km/h. */
  v85: number
}

export interface Kontrollblatt {
  /** From the ROWS — the header lies (measured: the March sheet is headed «Januar»). */
  jahr: number | null
  monat: number | null
  /** The sheet's own «Datum:» line, ISO; the day the police issued it. */
  stand: string | null
  kontrollen: Kontrolle[]
  messungen: Messung[]
  hinweise: string[]
}

// The signed limit comes with or without its unit: the May 2026 sheet prints
// «Dornacherweg 30 36258 33 km/h» where every other line prints «30 km/h»
// (measured on the first live run, 11 October 2026).
const KONTROLLE =
  /^(\d{2})\.(\d{2})\.(\d{4})\s+(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s*Uhr\s+(.+?)\s+(\d+)\s*(?:km\/h)?\s+(\d+)\s+(\d+)\s+(\d+)\s*km\/h\s*$/
const MESSUNG =
  /^(\d{2})\.(\d{2})\.\s*(?:(\d{4})\s+)?bis\s+(\d{2})\.(\d{2})\.(\d{4})\s+(.+?)\s+(\d+)\s*(?:km\/h)?\s+(\d+)\s+(\d+(?:[.,]\d+)?)\s*km\/h\s*$/
const STAND = /Datum:\s*(\d{1,2}\.\d{1,2}\.\d{4})/
const KOPF = /Geschwindigkeitskontrollen\s+(\p{L}+)\s+(\d{4})/u
const DATUMSZEILE = /^\d{2}\.\d{2}\./

export const MONATE: Readonly<Record<string, number>> = {
  januar: 1,
  februar: 2,
  maerz: 3,
  märz: 3,
  april: 4,
  mai: 5,
  juni: 6,
  juli: 7,
  august: 8,
  september: 9,
  oktober: 10,
  november: 11,
  dezember: 12
}

const MONATSNAMEN = [
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

/** «September 2026» — how the desk and the facts name a month. */
export function monatDeutsch(jahr: number, monat: number): string {
  return `${MONATSNAMEN[monat - 1] ?? monat} ${jahr}`
}

function zeit(text: string): string {
  const [h, m] = text.split(':')
  return `${(h ?? '').padStart(2, '0')}:${m ?? '00'}`
}

export function parseKontrollblatt(text: string): Kontrollblatt {
  const zeilen = text
    .split(/\r?\n/)
    .map((z) => z.replace(/\f/g, '').trim())
    .filter((z) => z !== '')

  const kontrollen: Kontrolle[] = []
  const messungen: Messung[] = []
  const hinweise: string[] = []
  let stand: string | null = null
  let kopfMonat: { jahr: number; monat: number } | null = null

  for (const zeile of zeilen) {
    const standTreffer = STAND.exec(zeile)
    if (standTreffer !== null && stand === null) {
      stand = isoAusDeutsch(standTreffer[1] ?? '')
    }
    const kopf = KOPF.exec(zeile)
    if (kopf !== null && kopfMonat === null) {
      const monat = MONATE[(kopf[1] ?? '').toLowerCase()]
      if (monat !== undefined)
        kopfMonat = { jahr: Number.parseInt(kopf[2] ?? '', 10), monat }
    }

    const k = KONTROLLE.exec(zeile)
    if (k !== null) {
      kontrollen.push({
        datum: `${k[3]}-${k[2]}-${k[1]}`,
        von: zeit(k[4] ?? ''),
        bis: zeit(k[5] ?? ''),
        messort: (k[6] ?? '').trim(),
        signalisiert: Number.parseInt(k[7] ?? '', 10),
        gemessen: Number.parseInt(k[8] ?? '', 10),
        uebertretungen: Number.parseInt(k[9] ?? '', 10),
        vmax: Number.parseInt(k[10] ?? '', 10)
      })
      continue
    }
    const m = MESSUNG.exec(zeile)
    if (m !== null) {
      const bisJahr = Number.parseInt(m[6] ?? '', 10)
      const vonMonat = Number.parseInt(m[2] ?? '', 10)
      const bisMonat = Number.parseInt(m[5] ?? '', 10)
      // «27.02. bis 26.03.2026»: the first day borrows the year of the last,
      // minus one across New Year.
      const vonJahr =
        m[3] !== undefined
          ? Number.parseInt(m[3], 10)
          : vonMonat > bisMonat
            ? bisJahr - 1
            : bisJahr
      messungen.push({
        von: `${vonJahr}-${m[2]}-${m[1]}`,
        bis: `${m[6]}-${m[5]}-${m[4]}`,
        messort: (m[7] ?? '').trim(),
        signalisiert: Number.parseInt(m[8] ?? '', 10),
        gemessen: Number.parseInt(m[9] ?? '', 10),
        v85: Number.parseFloat((m[10] ?? '').replace(',', '.'))
      })
      continue
    }
    if (DATUMSZEILE.test(zeile)) {
      hinweise.push(`Zeile nicht gelesen: «${zeile}»`)
    }
  }

  // The month is the rows', not the header's. The most frequent one wins;
  // rows from another month are a finding, never dropped.
  const zaehler = new Map<string, number>()
  for (const k of kontrollen) {
    const monat = k.datum.slice(0, 7)
    zaehler.set(monat, (zaehler.get(monat) ?? 0) + 1)
  }
  let jahr: number | null = null
  let monat: number | null = null
  if (zaehler.size > 0) {
    const [haeufigster] = [...zaehler.entries()].sort((a, b) => b[1] - a[1])
    const [j, m] = (haeufigster?.[0] ?? '').split('-')
    jahr = Number.parseInt(j ?? '', 10)
    monat = Number.parseInt(m ?? '', 10)
    if (zaehler.size > 1) {
      const andere = [...zaehler.keys()].filter((k) => k !== haeufigster?.[0])
      hinweise.push(
        `Das Blatt traegt Kontrollen aus mehreren Monaten (${andere.join(', ')}).`
      )
    }
  } else if (messungen.length > 0) {
    const letzte = messungen[messungen.length - 1]
    if (letzte !== undefined) {
      jahr = Number.parseInt(letzte.bis.slice(0, 4), 10)
      monat = Number.parseInt(letzte.bis.slice(5, 7), 10)
    }
  }
  if (kopfMonat !== null && jahr !== null && monat !== null) {
    if (kopfMonat.jahr !== jahr || kopfMonat.monat !== monat) {
      hinweise.push(
        `Der Kopf des Blatts nennt ${monatDeutsch(kopfMonat.jahr, kopfMonat.monat)}, die Zeilen sind ${monatDeutsch(jahr, monat)} — die Zeilen gelten.`
      )
      // A header that names the wrong month carries the wrong month's date
      // too («Datum: 31.01.2026» over March rows); no date beats a stale one.
      stand = null
    }
  }

  return { jahr, monat, stand, kontrollen, messungen, hinweise }
}

/** A month and year read off Reinach's file name: «009-September-2026.pdf». */
export function monatAusDateiname(
  url: string
): { jahr: number; monat: number } | null {
  const treffer = /(\d{3})-([\p{L}]+)-(\d{4})\.pdf(?:\?.*)?$/iu.exec(url)
  if (treffer === null) return null
  const monat = MONATE[(treffer[2] ?? '').toLowerCase()]
  if (monat === undefined) return null
  return { jahr: Number.parseInt(treffer[3] ?? '', 10), monat }
}

export interface Strassenbilanz {
  messort: string
  kontrollen: number
  gemessen: number
  uebertretungen: number
  /** Percent, one decimal; null when nothing was measured. */
  quote: number | null
}

export interface Zusammenfassung {
  kontrollen: number
  gemessen: number
  uebertretungen: number
  quote: number | null
  /** Every street, most violations first — the whole sheet, never a sample. */
  strassen: Strassenbilanz[]
  /** The street with the most violations. */
  meiste: Strassenbilanz | null
  /**
   * The street with the highest share of violations among those with at
   * least `MINDESTENS_GEMESSEN` vehicles — three of five is not a rate.
   */
  hoechsteQuote: Strassenbilanz | null
  /** The fastest measured vehicle, with where and when. */
  schnellster: {
    vmax: number
    signalisiert: number
    messort: string
    datum: string
    von: string
    bis: string
  } | null
}

export const MINDESTENS_GEMESSEN = 50

function prozent(teil: number, ganzes: number): number | null {
  if (ganzes <= 0) return null
  return Math.round((teil / ganzes) * 1000) / 10
}

/**
 * What a month adds up to — computed over EVERY control line, by code. The
 * questions the newsroom asked on 11 October 2026: how many violations,
 * where most, when and by how much was the fastest vehicle over.
 */
export function zusammenfassung(
  kontrollen: readonly Kontrolle[]
): Zusammenfassung {
  const jeStrasse = new Map<string, Strassenbilanz>()
  let gemessen = 0
  let uebertretungen = 0
  let schnellster: Zusammenfassung['schnellster'] = null

  for (const k of kontrollen) {
    gemessen += k.gemessen
    uebertretungen += k.uebertretungen
    const bisher = jeStrasse.get(k.messort) ?? {
      messort: k.messort,
      kontrollen: 0,
      gemessen: 0,
      uebertretungen: 0,
      quote: null
    }
    bisher.kontrollen += 1
    bisher.gemessen += k.gemessen
    bisher.uebertretungen += k.uebertretungen
    jeStrasse.set(k.messort, bisher)
    if (schnellster === null || k.vmax > schnellster.vmax) {
      schnellster = {
        vmax: k.vmax,
        signalisiert: k.signalisiert,
        messort: k.messort,
        datum: k.datum,
        von: k.von,
        bis: k.bis
      }
    }
  }

  const strassen = [...jeStrasse.values()]
    .map((s) => ({ ...s, quote: prozent(s.uebertretungen, s.gemessen) }))
    .sort(
      (a, b) =>
        b.uebertretungen - a.uebertretungen || (b.quote ?? 0) - (a.quote ?? 0)
    )

  const mitGenug = strassen
    .filter((s) => s.gemessen >= MINDESTENS_GEMESSEN && s.quote !== null)
    .sort((a, b) => (b.quote ?? 0) - (a.quote ?? 0))

  return {
    kontrollen: kontrollen.length,
    gemessen,
    uebertretungen,
    quote: prozent(uebertretungen, gemessen),
    strassen,
    meiste: strassen[0] ?? null,
    hoechsteQuote: mitGenug[0] ?? null,
    schnellster
  }
}
