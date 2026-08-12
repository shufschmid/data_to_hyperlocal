import type { OdsRecord } from '../shared/ods'

// Turning portal rows into the few lines a prompt can actually use.
//
// The hard part is not formatting, it is arithmetic that stays honest.
//
// Dataset 12060 carries a `wert` column whose rows are sometimes tonnes and
// sometimes kilograms per inhabitant, across seven waste categories. Averaging
// that column produces a number — 79.72 — that is not wrong so much as
// meaningless, and a model handed it will faithfully turn it into "46 percent
// above the cantonal average" in a published article. So every figure here is
// computed **within a group of like rows**, never across them, and a group
// carries its own label so the number is never quoted without its unit.

/** Columns that identify the municipality rather than say something about it. */
const IDENTITAETSFELDER = new Set([
  'gemeinde',
  'gemeindename',
  'gdename',
  'name',
  'bfs_gemeindenummer',
  'gemeindenummer',
  'bfs_nummer',
  'gdenr',
  'entity_id',
  'district',
  'bezirk'
])

/** Above this many distinct values a text column is an id, not a dimension. */
const MAX_AUSPRAEGUNGEN = 12
/** Hard ceiling so a wide dataset cannot flood the prompt. */
const MAX_GRUPPEN = 30

export function istZahl(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function formatZahl(value: number): string {
  const gerundet =
    Math.abs(value) >= 100 ? Math.round(value) : Math.round(value * 100) / 100
  return gerundet.toLocaleString('de-CH')
}

function beschreibeWert(value: unknown): string | null {
  if (istZahl(value)) return formatZahl(value)
  if (typeof value === 'string' && value.trim() !== '') return value.trim()
  if (typeof value === 'boolean') return value ? 'ja' : 'nein'
  return null
}

/**
 * The text columns that split the rows into comparable groups — `kategorie` and
 * `einheit` in the waste statistics.
 *
 * A column with one distinct value carries no information (the period, once the
 * slice is filtered). A column with very many is an identifier, not a
 * dimension, and grouping by it would give every row its own group and every
 * average a sample size of one.
 */
export function findeDimensionen(zeilen: readonly OdsRecord[]): string[] {
  const auspraegungen = new Map<string, Set<string>>()

  for (const zeile of zeilen) {
    for (const [feld, wert] of Object.entries(zeile)) {
      if (IDENTITAETSFELDER.has(feld.toLowerCase())) continue
      if (typeof wert !== 'string' || wert.trim() === '') continue

      const menge = auspraegungen.get(feld) ?? new Set<string>()
      menge.add(wert)
      auspraegungen.set(feld, menge)
    }
  }

  return [...auspraegungen.entries()]
    .filter(([, menge]) => menge.size >= 2 && menge.size <= MAX_AUSPRAEGUNGEN)
    .map(([feld]) => feld)
    .sort()
}

function gruppenSchluessel(
  zeile: OdsRecord,
  dimensionen: readonly string[]
): string {
  const teile = dimensionen
    .map((feld) => zeile[feld])
    .filter(
      (wert): wert is string => typeof wert === 'string' && wert.trim() !== ''
    )

  return teile.length === 0 ? 'gesamt' : teile.join(' · ')
}

export interface Kennzahl {
  /** Label of the comparable group, e.g. "Glas · kg pro Einw.". */
  gruppe: string
  feld: string
  schnitt: number
  kleinster: number
  groesster: number
  anzahl: number
}

/**
 * Mean, min and max per numeric column — computed separately inside each group
 * of like rows.
 *
 * Never across groups: that is the bug this function exists to make impossible.
 */
export function kennzahlen(zeilen: readonly OdsRecord[]): Kennzahl[] {
  const dimensionen = findeDimensionen(zeilen)
  const gesammelt = new Map<string, Map<string, number[]>>()

  for (const zeile of zeilen) {
    const gruppe = gruppenSchluessel(zeile, dimensionen)
    const jeFeld = gesammelt.get(gruppe) ?? new Map<string, number[]>()

    for (const [feld, wert] of Object.entries(zeile)) {
      if (IDENTITAETSFELDER.has(feld.toLowerCase())) continue
      if (!istZahl(wert)) continue

      const werte = jeFeld.get(feld) ?? []
      werte.push(wert)
      jeFeld.set(feld, werte)
    }

    if (jeFeld.size > 0) gesammelt.set(gruppe, jeFeld)
  }

  const ergebnis: Kennzahl[] = []

  for (const [gruppe, jeFeld] of gesammelt) {
    for (const [feld, werte] of jeFeld) {
      ergebnis.push({
        gruppe,
        feld,
        schnitt: werte.reduce((summe, w) => summe + w, 0) / werte.length,
        kleinster: Math.min(...werte),
        groesster: Math.max(...werte),
        anzahl: werte.length
      })
    }
  }

  return ergebnis
    .sort(
      (a, b) => a.gruppe.localeCompare(b.gruppe) || a.feld.localeCompare(b.feld)
    )
    .slice(0, MAX_GRUPPEN)
}

/** One line per row, identity columns removed. */
export function verdichteZeilen(
  zeilen: readonly OdsRecord[],
  hoechstens = 40
): string {
  const zeilenTexte: string[] = []

  for (const zeile of zeilen.slice(0, hoechstens)) {
    const teile: string[] = []

    for (const [feld, wert] of Object.entries(zeile)) {
      if (IDENTITAETSFELDER.has(feld.toLowerCase())) continue
      const text = beschreibeWert(wert)
      if (text === null) continue
      teile.push(`${feld}: ${text}`)
    }

    if (teile.length > 0) zeilenTexte.push(`- ${teile.join(', ')}`)
  }

  if (zeilen.length > hoechstens) {
    zeilenTexte.push(
      `- (${zeilen.length - hoechstens} weitere Zeilen nicht gezeigt)`
    )
  }

  return zeilenTexte.length === 0
    ? '(keine verwertbaren Werte)'
    : zeilenTexte.join('\n')
}

/**
 * The canton-wide picture, one line per comparable group.
 *
 * Each line names its group, so a figure can never be quoted without the
 * category and unit it belongs to.
 */
export function beschreibeKanton(zeilen: readonly OdsRecord[]): string {
  const zahlen = kennzahlen(zeilen)
  if (zahlen.length === 0) return '(keine numerischen Werte im Datensatz)'

  return zahlen
    .map(
      (k) =>
        `- ${k.gruppe} — ${k.feld}: Schnitt ${formatZahl(k.schnitt)}, ` +
        `tiefster ${formatZahl(k.kleinster)}, hoechster ${formatZahl(k.groesster)} ` +
        `(Werte aus ${k.anzahl} Gemeinden)`
    )
    .join('\n')
}

/**
 * Where one municipality sits against the rest — compared like with like.
 *
 * A municipality's glass in kilograms per inhabitant is put against the
 * canton's glass in kilograms per inhabitant, and against nothing else.
 */
export function beschreibeEinordnung(
  eigeneZeilen: readonly OdsRecord[],
  alleZeilen: readonly OdsRecord[]
): string {
  const kantonal = new Map(
    kennzahlen(alleZeilen).map((k) => [`${k.gruppe}|${k.feld}`, k])
  )
  const saetze: string[] = []

  for (const k of kennzahlen(eigeneZeilen)) {
    const gegenstueck = kantonal.get(`${k.gruppe}|${k.feld}`)
    if (gegenstueck === undefined || gegenstueck.schnitt === 0) continue

    const abweichung =
      ((k.schnitt - gegenstueck.schnitt) / Math.abs(gegenstueck.schnitt)) * 100
    const richtung =
      Math.abs(abweichung) < 1
        ? 'auf dem Kantonsschnitt'
        : `${formatZahl(Math.abs(abweichung))} Prozent ${abweichung > 0 ? 'ueber' : 'unter'} dem Kantonsschnitt`

    saetze.push(
      `${k.gruppe}: ${formatZahl(k.schnitt)} gegenueber ${formatZahl(gegenstueck.schnitt)} im Kantonsschnitt — ${richtung}`
    )
  }

  return saetze.length === 0 ? '(kein Vergleich moeglich)' : saetze.join('\n')
}

/**
 * The rows an article was written from, stored on the message for
 * fact-checking. Capped for the same reason the prompt is.
 */
export function datengrundlage(
  zeilen: readonly OdsRecord[],
  periode: string,
  hoechstens = 60
): Record<string, unknown> {
  return {
    periode,
    zeilen_gesamt: zeilen.length,
    zeilen: zeilen.slice(0, hoechstens)
  }
}

// --- the time axis -----------------------------------------------------------
//
// Everything above works on one period. That is enough for "how does this
// municipality compare to the canton" and not nearly enough for the instruction
// an editor actually gives: compare with last year and with ten years ago.
//
// Without these rows in the material, such an instruction has exactly two
// possible outcomes, and both are bad: the model refuses, or it invents a
// plausible earlier figure. So when a run carries an instruction, it also
// carries the history — condensed the same way as everything else, per group of
// like rows, never across.

export interface Reihenwert {
  periode: string
  wert: number
}

export interface Zeitreihe {
  /** Same group label as `kennzahlen`, e.g. "Glas · kg pro Einw.". */
  gruppe: string
  feld: string
  /** Oldest first. */
  werte: Reihenwert[]
}

/** How many periods of one series reach a prompt. Oldest and newest survive. */
const MAX_PERIODEN = 12

/**
 * One series per group and numeric column, across all periods in `zeilen`.
 *
 * Values inside a period are summed, not averaged: the input here is the rows
 * of a single municipality, where two rows of the same group in the same period
 * are parts of one total. Across municipalities the caller must not use this —
 * `beschreibeKantonZeitreihe` sums deliberately and says so in its label.
 */
export function zeitreihen(
  zeilen: readonly OdsRecord[],
  periodenFeld: string
): Zeitreihe[] {
  const dimensionen = findeDimensionen(zeilen).filter(
    (feld) => feld !== periodenFeld
  )
  const gesammelt = new Map<string, Map<string, Map<string, number>>>()

  for (const zeile of zeilen) {
    const periode = beschreibeWert(zeile[periodenFeld])
    if (periode === null) continue

    const gruppe = gruppenSchluessel(zeile, dimensionen)
    const jeFeld =
      gesammelt.get(gruppe) ?? new Map<string, Map<string, number>>()

    for (const [feld, wert] of Object.entries(zeile)) {
      if (feld === periodenFeld) continue
      if (IDENTITAETSFELDER.has(feld.toLowerCase())) continue
      if (!istZahl(wert)) continue

      const jePeriode = jeFeld.get(feld) ?? new Map<string, number>()
      jePeriode.set(periode, (jePeriode.get(periode) ?? 0) + wert)
      jeFeld.set(feld, jePeriode)
    }

    if (jeFeld.size > 0) gesammelt.set(gruppe, jeFeld)
  }

  const ergebnis: Zeitreihe[] = []

  for (const [gruppe, jeFeld] of gesammelt) {
    for (const [feld, jePeriode] of jeFeld) {
      // A series of one period is not a series — it is the current value, and
      // that is already in the figures above.
      if (jePeriode.size < 2) continue

      const werte = [...jePeriode.entries()]
        .map(([periode, wert]) => ({ periode, wert }))
        .sort((a, b) => a.periode.localeCompare(b.periode))

      ergebnis.push({ gruppe, feld, werte: duenneAus(werte, MAX_PERIODEN) })
    }
  }

  return ergebnis
    .sort(
      (a, b) => a.gruppe.localeCompare(b.gruppe) || a.feld.localeCompare(b.feld)
    )
    .slice(0, MAX_GRUPPEN)
}

/**
 * Thins a long series while keeping both ends.
 *
 * The ends are what an editor asks about — "and ten years ago?" — so dropping
 * the oldest entry to fit a cap would remove the one figure the instruction
 * needs. Evenly spaced in between.
 */
export function duenneAus(
  werte: readonly Reihenwert[],
  hoechstens: number
): Reihenwert[] {
  if (werte.length <= hoechstens) return [...werte]
  if (hoechstens <= 2) {
    const erster = werte[0]
    const letzter = werte[werte.length - 1]
    return erster === undefined || letzter === undefined
      ? []
      : [erster, letzter]
  }

  const schritt = (werte.length - 1) / (hoechstens - 1)
  const behalten: Reihenwert[] = []

  for (let i = 0; i < hoechstens; i += 1) {
    const wert = werte[Math.round(i * schritt)]
    if (wert !== undefined) behalten.push(wert)
  }

  return behalten
}

/** One line per series: "Sektor 1 — arbeitsstatten: 2011: 21 · 2017: 18 · 2023: 16". */
export function beschreibeZeitreihen(reihen: readonly Zeitreihe[]): string {
  if (reihen.length === 0)
    return '(keine Vergleichswerte aus frueheren Perioden)'

  return reihen
    .map(
      (reihe) =>
        `- ${reihe.gruppe} — ${reihe.feld}: ` +
        reihe.werte
          .map((w) => `${w.periode}: ${formatZahl(w.wert)}`)
          .join(' · ')
    )
    .join('\n')
}

/**
 * The canton's own development, summed over all municipalities per period.
 *
 * A sum, not a mean, and the label says so — a mean over municipalities and a
 * cantonal total are different numbers, and an article that calls one the other
 * is wrong in a way no proofreader catches.
 */
export function beschreibeKantonZeitreihe(
  zeilen: readonly OdsRecord[],
  periodenFeld: string
): string {
  const reihen = zeitreihen(zeilen, periodenFeld)
  if (reihen.length === 0) {
    return '(keine kantonalen Vergleichswerte aus frueheren Perioden)'
  }

  return reihen
    .map(
      (reihe) =>
        `- ${reihe.gruppe} — ${reihe.feld} (Summe aller Gemeinden): ` +
        reihe.werte
          .map((w) => `${w.periode}: ${formatZahl(w.wert)}`)
          .join(' · ')
    )
    .join('\n')
}
