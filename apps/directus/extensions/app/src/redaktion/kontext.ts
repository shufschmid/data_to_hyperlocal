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

/**
 * Above this many distinct values a text column is an id, not a dimension.
 *
 * 60, not 12: the Motorfahrzeugbestand's `fahrzeugart` carries 42 categories
 * CANTON-WIDE (measured 8.9.2026 — a municipality slice shows ~15), and at 12
 * the column fell out as a dimension: its rows landed in one pot and the "mean
 * per category" averaged mopeds with cars. Real category columns sit at
 * double-digit counts; identifiers (addresses, names, ids) sit far above 60.
 * A column between the two is handled by `verworfeneKategorien`: aggregation
 * is REFUSED and the refusal says why — never a silent pooled mean.
 */
const MAX_AUSPRAEGUNGEN = 60
/**
 * How many lines of one kind a prompt carries before the rest is DECLARED.
 *
 * This caps rendering, never arithmetic: figures are computed over everything,
 * and an overflow always prints its own "(N weitere …)" line. The old value 30
 * cut alphabetically and silently — late-alphabet categories simply vanished
 * from the briefing and from both sides of the comparison.
 */
const MAX_GRUPPEN = 120

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
function zaehleAuspraegungen(
  zeilen: readonly OdsRecord[]
): Map<string, Set<string>> {
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

  return auspraegungen
}

export function findeDimensionen(zeilen: readonly OdsRecord[]): string[] {
  return [...zaehleAuspraegungen(zeilen).entries()]
    .filter(([, menge]) => menge.size >= 2 && menge.size <= MAX_AUSPRAEGUNGEN)
    .map(([feld]) => feld)
    .sort()
}

export interface VerworfeneKategorie {
  feld: string
  auspraegungen: number
}

/**
 * Non-identity category columns too wide to group by.
 *
 * These poison every pooled figure: rows that differ in such a column are
 * different things, and a mean across them is the meaningless 79.72 from the
 * header comment — one notch above the threshold instead of below it. The
 * describe functions REFUSE to aggregate while one exists and say why. The
 * newsroom's rule: compute over the whole and the comparable, or say plainly
 * that no comparable figure exists. Never a silent pooled mean.
 *
 * `ausser` names columns the caller accounts for itself — the period column of
 * a time series, which legitimately has hundreds of values.
 */
export function verworfeneKategorien(
  zeilen: readonly OdsRecord[],
  ausser: readonly string[] = []
): VerworfeneKategorie[] {
  return [...zaehleAuspraegungen(zeilen).entries()]
    .filter(
      ([feld, menge]) =>
        !ausser.includes(feld) && menge.size > MAX_AUSPRAEGUNGEN
    )
    .map(([feld, menge]) => ({ feld, auspraegungen: menge.size }))
    .sort((a, b) => a.feld.localeCompare(b.feld))
}

/** The refusal, spelled out — this line goes into the prompt instead of a mean. */
function verworfenText(verworfen: readonly VerworfeneKategorie[]): string {
  const spalten = verworfen
    .map((v) => `"${v.feld}" (${v.auspraegungen} Auspraegungen)`)
    .join(', ')
  return (
    `(keine vergleichbaren Kennzahlen: Spalte ${spalten} ist zu breit zum ` +
    `Gruppieren — ein Schnitt darueber wuerde unvergleichbare Zeilen mitteln)`
  )
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
 * UNCAPPED on purpose — arithmetic runs over everything; only rendering
 * (`beschreibeKanton`, `beschreibeEinordnung`) limits lines, and declares it.
 *
 * `dimensionen` can be handed in so two sides of a comparison group the SAME
 * way: the canton's columns decide, or a municipality whose slice happens to
 * carry fewer distinct values would group differently and every comparison key
 * would silently miss.
 */
export function kennzahlen(
  zeilen: readonly OdsRecord[],
  dimensionen: readonly string[] = findeDimensionen(zeilen)
): Kennzahl[] {
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

  return ergebnis.sort(
    (a, b) => a.gruppe.localeCompare(b.gruppe) || a.feld.localeCompare(b.feld)
  )
}

/**
 * One line per row, identity columns removed — unless `zeigeIdentitaet` is on:
 * the deep-revision block hands the WHOLE period over, and there the
 * municipality name is the one column the rows are useless without.
 */
export function verdichteZeilen(
  zeilen: readonly OdsRecord[],
  hoechstens = 40,
  zeigeIdentitaet = false
): string {
  const zeilenTexte: string[] = []

  for (const zeile of zeilen.slice(0, hoechstens)) {
    const teile: string[] = []

    for (const [feld, wert] of Object.entries(zeile)) {
      if (!zeigeIdentitaet && IDENTITAETSFELDER.has(feld.toLowerCase())) {
        continue
      }
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
  const verworfen = verworfeneKategorien(zeilen)
  if (verworfen.length > 0) return verworfenText(verworfen)

  const zahlen = kennzahlen(zeilen)
  if (zahlen.length === 0) return '(keine numerischen Werte im Datensatz)'

  const linien = zahlen
    .slice(0, MAX_GRUPPEN)
    .map(
      (k) =>
        `- ${k.gruppe} — ${k.feld}: Schnitt ${formatZahl(k.schnitt)}, ` +
        `tiefster ${formatZahl(k.kleinster)}, hoechster ${formatZahl(k.groesster)} ` +
        `(Werte aus ${k.anzahl} Gemeinden)`
    )
  if (zahlen.length > MAX_GRUPPEN) {
    linien.push(
      `- (${zahlen.length - MAX_GRUPPEN} weitere Gruppen nicht gezeigt)`
    )
  }
  return linien.join('\n')
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
  // A column too wide to group by poisons every pooled mean — refuse and say
  // why, instead of comparing averages of unlike rows.
  const verworfen = verworfeneKategorien(alleZeilen)
  if (verworfen.length > 0) return verworfenText(verworfen)

  // The canton's columns decide the grouping for BOTH sides: a municipality
  // slice that happens to carry fewer distinct values would otherwise group
  // differently, and every comparison key would miss in silence.
  const dimensionen = findeDimensionen(alleZeilen)
  const kantonal = new Map(
    kennzahlen(alleZeilen, dimensionen).map((k) => [`${k.gruppe}|${k.feld}`, k])
  )
  const saetze: string[] = []

  for (const k of kennzahlen(eigeneZeilen, dimensionen)) {
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

  if (saetze.length === 0) return '(kein Vergleich moeglich)'
  const gezeigt = saetze.slice(0, MAX_GRUPPEN)
  if (saetze.length > MAX_GRUPPEN) {
    gezeigt.push(
      `(${saetze.length - MAX_GRUPPEN} weitere Vergleiche nicht gezeigt)`
    )
  }
  return gezeigt.join('\n')
}

/**
 * The whole municipality slice belongs in the working material — with a ceiling
 * against the pathological case only.
 *
 * The old cap was 60 stored and 40 in the prompt, and it bit in production:
 * Binningen's Motorfahrzeugbestand slice is 56 rows sorted by Fahrzeugart, so
 * "Personenwagen" fell past the prompt cut — and a revision asking about cars
 * answered from Leichtmotorfahrzeuge instead. Measured slices run 50–100 rows;
 * 800 is far above anything real and still no dataset dump.
 */
export const MAX_GRUNDLAGE_ZEILEN = 800

/**
 * The rows an article was written from, stored on the message for
 * fact-checking — and since the revision fix, complete: an instruction must be
 * answerable from the same material the article stands on.
 */
export function datengrundlage(
  zeilen: readonly OdsRecord[],
  periode: string,
  hoechstens = MAX_GRUNDLAGE_ZEILEN
): Record<string, unknown> {
  return {
    periode,
    zeilen_gesamt: zeilen.length,
    zeilen: zeilen.slice(0, hoechstens)
  }
}

/** Fresh rows for one revision: the municipality's own, and the whole period slice. */
export interface FrischeZeilen {
  eigene: OdsRecord[]
  alle: OdsRecord[]
  /**
   * The municipality's rows across ALL periods, when the deep fetch brought
   * them — the revision's time axis, fresh instead of whatever a run stored.
   */
  verlaufEigene?: OdsRecord[]
}

export interface Arbeitsmaterial {
  zeilen: OdsRecord[]
  /**
   * Null when no COMPLETE comparison basis exists. Deliberately not a fallback
   * chain: the last resort used to be `lauf.kontext.alle_zeilen`, a 400-row
   * sample of what can be a 3500-row period, and its sample-"Kantonsschnitt"
   * went into articles as fact. The newsroom's rule since: compute over
   * everything, or say plainly that no comparison is available — the prompt
   * renders null as exactly that sentence, and the percentage check then
   * flags every percentage the model writes anyway.
   */
  einordnung: string | null
  /** True when it came fresh from the source — the stored evidence is then refreshed. */
  frisch: boolean
}

/**
 * What one article is written — or rewritten — from.
 *
 * Freshly fetched rows win: a revision must see the WHOLE original source, not
 * the slice an older cap happened to store ("beim Ueberarbeiten muss der ganze
 * Umfang der Original-Quelle verfuegbar sein" — the newsroom's words). Without
 * fresh rows, the stored material stands — including its stored einordnung,
 * computed over the full period slice at stage A. A row from before that fix
 * carries none, and none is what it gets: null, never a sample.
 */
export function arbeitsmaterial(
  grundlage: { zeilen?: unknown; einordnung?: unknown },
  frisch: FrischeZeilen | null
): Arbeitsmaterial {
  if (frisch !== null && frisch.eigene.length > 0) {
    return {
      zeilen: frisch.eigene.slice(0, MAX_GRUNDLAGE_ZEILEN),
      einordnung: beschreibeEinordnung(frisch.eigene, frisch.alle),
      frisch: true
    }
  }

  const zeilen = Array.isArray(grundlage.zeilen)
    ? (grundlage.zeilen as OdsRecord[])
    : []
  const einordnung =
    typeof grundlage.einordnung === 'string' && grundlage.einordnung !== ''
      ? grundlage.einordnung
      : null
  return { zeilen, einordnung, frisch: false }
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
  /** Oldest first. Thinned to `MAX_PERIODEN` — endpoints always survive. */
  werte: Reihenwert[]
  /**
   * How many periods the source actually holds. More than `werte.length` means
   * the series was thinned, and the rendering says so — a trend claim over
   * unseen gaps is exactly the kind of sentence this project must not print.
   * Missing on rows stored before the field existed; treated as complete.
   */
  perioden_gesamt?: number
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
  // A category column too wide to group by would pool unlike rows into every
  // period's sum — the same poison as in `kennzahlen`. No series beats a wrong
  // one; `beschreibeKantonZeitreihe` names the reason where it renders.
  if (verworfeneKategorien(zeilen, [periodenFeld]).length > 0) return []

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

      ergebnis.push({
        gruppe,
        feld,
        werte: duenneAus(werte, MAX_PERIODEN),
        perioden_gesamt: werte.length
      })
    }
  }

  // Uncapped: this is arithmetic and stored evidence. Rendering caps and
  // declares — see `beschreibeZeitreihen`.
  return ergebnis.sort(
    (a, b) => a.gruppe.localeCompare(b.gruppe) || a.feld.localeCompare(b.feld)
  )
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

/** True when the series shows fewer periods than the source holds. */
function istAusgeduennt(reihe: Zeitreihe): boolean {
  return (
    typeof reihe.perioden_gesamt === 'number' &&
    reihe.perioden_gesamt > reihe.werte.length
  )
}

function reihenZeile(reihe: Zeitreihe, etikett = ''): string {
  const werte = reihe.werte
    .map((w) => `${w.periode}: ${formatZahl(w.wert)}`)
    .join(' · ')
  const kuerzung = istAusgeduennt(reihe)
    ? ` (${reihe.werte.length} von ${reihe.perioden_gesamt} Perioden gezeigt)`
    : ''
  return `- ${reihe.gruppe} — ${reihe.feld}${etikett}: ${werte}${kuerzung}`
}

/**
 * Rendering caps and cuts get DECLARED here — arithmetic upstream is uncapped.
 * A thinned series says so on its own line, and one shared caution keeps the
 * model from claiming a trend over years it never saw.
 */
function reihenLinien(reihen: readonly Zeitreihe[], etikett = ''): string {
  const linien = reihen
    .slice(0, MAX_GRUPPEN)
    .map((reihe) => reihenZeile(reihe, etikett))
  if (reihen.length > MAX_GRUPPEN) {
    linien.push(
      `- (${reihen.length - MAX_GRUPPEN} weitere Reihen nicht gezeigt)`
    )
  }
  if (reihen.some(istAusgeduennt)) {
    linien.push(
      'Zwischenperioden sind ausgelassen — keine Aussagen wie "kontinuierlich"',
      'oder "Hoechststand" ueber die Luecken hinweg.'
    )
  }
  return linien.join('\n')
}

/** One line per series: "Sektor 1 — arbeitsstatten: 2011: 21 · 2017: 18 · 2023: 16". */
export function beschreibeZeitreihen(reihen: readonly Zeitreihe[]): string {
  if (reihen.length === 0)
    return '(keine Vergleichswerte aus frueheren Perioden)'

  return reihenLinien(reihen)
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
  const verworfen = verworfeneKategorien(zeilen, [periodenFeld])
  if (verworfen.length > 0) return verworfenText(verworfen)

  const reihen = zeitreihen(zeilen, periodenFeld)
  if (reihen.length === 0) {
    return '(keine kantonalen Vergleichswerte aus frueheren Perioden)'
  }

  return reihenLinien(reihen, ' (Summe aller Gemeinden)')
}
