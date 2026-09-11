// Catching percentages the model worked out for itself.
//
// The generator is handed every comparison ready-made — "Grüngut: 34.9
// gegenueber 91.42 im Kantonsschnitt — 61.83 Prozent unter dem Kantonsschnitt".
// It still occasionally recomputes one and gets it wrong: an observed article
// turned that 61.83 into "rund 68 Prozent". Nothing about the sentence looks
// wrong, which is precisely why a human proofreader waves it through.
//
// So percentages are checked rather than trusted. Only percentages: the raw
// values appear in the text legitimately and in many forms, while a percentage
// is always a derived figure and always one we supplied — or, since the deep
// revisions, one that is honestly DERIVABLE from the handed rows:
// `ableitbareProzentangaben` pre-computes that space (shares within families of
// like rows, changes along the handed time series), so "der Elektro-Anteil an
// den Personenwagen betraegt 6,6 Prozent" verifies and an invented figure still
// gets flagged.

import type { OdsRecord } from '../shared/ods'
import { findeDimensionen, istZahl, type Zeitreihe } from './kontext'

/** German decimals use a comma; the data uses a point. Accept both. */
const PROZENT = /(\d+(?:[.,]\d+)?)\s*(?:Prozent|%)/gi

export function findeProzentangaben(text: string): number[] {
  const gefunden: number[] = []

  for (const treffer of text.matchAll(PROZENT)) {
    const roh = (treffer[1] ?? '').replace(',', '.')
    const zahl = Number.parseFloat(roh)
    if (Number.isFinite(zahl)) gefunden.push(zahl)
  }

  return gefunden
}

/**
 * Percentages in the text that we never supplied.
 *
 * The tolerance is what makes this usable rather than pedantic: an article that
 * rounds 61.83 to "rund 62 Prozent" is doing its job, and flagging that would
 * train the editor to ignore the warnings. One percentage point of slack
 * accepts honest rounding and still catches 68 against 61.83.
 */
export function unbelegteProzentangaben(
  text: string,
  erlaubt: readonly number[],
  toleranz = 1
): number[] {
  return findeProzentangaben(text).filter(
    (zahl) => !erlaubt.some((quelle) => Math.abs(zahl - quelle) <= toleranz)
  )
}

/**
 * Pulls the percentages out of what `beschreibeEinordnung` produced.
 *
 * Null einordnung means null allowance: without a complete comparison basis
 * there is no legitimate percentage, so every one the model writes gets
 * flagged. This used to bless percentages derived from a 400-row sample.
 */
export function erlaubteProzentangaben(einordnung: string | null): number[] {
  if (einordnung === null) return []
  return findeProzentangaben(einordnung)
}

/** A ceiling against pathological inputs — the Set stops growing, silently
 * ALLOWING less rather than more, which errs on the flagging side. */
const MAX_ABLEITUNGEN = 20000

/**
 * Every percentage that honest arithmetic can derive from the handed rows.
 *
 * Three families of legitimate derivations, matching what an editor's Vorgabe
 * actually asks for ("wie ist der Anteil Elektro?", "wie hat sich der Bestand
 * veraendert?"):
 * - a row's share of the slice total, per numeric column,
 * - a row's share within its FAMILY — rows equal in every dimension but one
 *   (Elektro among the Personenwagen; Personenwagen among the Benziner),
 * - the change between any two points of a handed time series.
 *
 * Rounded to two decimals; `unbelegteProzentangaben`'s one-point tolerance
 * absorbs the model's own honest rounding.
 */
export function ableitbareProzentangaben(
  zeilen: readonly OdsRecord[],
  reihen: readonly Zeitreihe[] = []
): number[] {
  const werte = new Set<number>()
  const merke = (wert: number): void => {
    if (Number.isFinite(wert) && werte.size < MAX_ABLEITUNGEN) {
      werte.add(Math.round(wert * 100) / 100)
    }
  }

  const dimensionen = findeDimensionen(zeilen)
  const numerisch = new Set<string>()
  for (const zeile of zeilen) {
    for (const [feld, wert] of Object.entries(zeile)) {
      if (istZahl(wert)) numerisch.add(feld)
    }
  }

  for (const feld of numerisch) {
    const mitWert = zeilen.filter((z) => istZahl(z[feld]))

    // Share of the whole slice.
    const total = mitWert.reduce((s, z) => s + (z[feld] as number), 0)
    if (total > 0) {
      for (const z of mitWert) merke(((z[feld] as number) / total) * 100)
    }

    // Share within each family: all dimensions equal but one.
    for (const frei of dimensionen) {
      const rest = dimensionen.filter((d) => d !== frei)
      const familien = new Map<string, number>()
      for (const z of mitWert) {
        const schluessel = rest.map((d) => String(z[d] ?? '')).join('')
        familien.set(
          schluessel,
          (familien.get(schluessel) ?? 0) + (z[feld] as number)
        )
      }
      for (const z of mitWert) {
        const summe =
          familien.get(rest.map((d) => String(z[d] ?? '')).join('')) ?? 0
        if (summe > 0) merke(((z[feld] as number) / summe) * 100)
      }
    }
  }

  // Changes along the handed series — between ANY two points, because "seit
  // Mai 2024" and "gegenueber dem Vorjahr" are both fair questions.
  for (const reihe of reihen) {
    for (let i = 0; i < reihe.werte.length; i += 1) {
      const von = reihe.werte[i]?.wert
      if (von === undefined || von === 0) continue
      for (let j = i + 1; j < reihe.werte.length; j += 1) {
        const bis = reihe.werte[j]?.wert
        if (bis === undefined) continue
        merke(((bis - von) / Math.abs(von)) * 100)
      }
    }
  }

  return [...werte]
}

export interface UngenaueAngabe {
  zahl: number
  naechster: number
}

/**
 * Percentages close enough to a legitimate value to pass the coarse check but
 * too far off to be honest rounding — the model computed, and computed
 * sloppily. Measured on the first deep revision: 511 of 9'399 Personenwagen is
 * 5.44 Prozent, the article said "5,2" — inside the one-point tolerance,
 * outside anything rounding could produce.
 *
 * The honesty bar depends on how the text prints the figure: an integer claim
 * ("5 Prozent") may sit half a point off its source, a decimal claim ("5,2
 * Prozent") asserts precision and must be within `fein` of one.
 */
export function ungenaueProzentangaben(
  text: string,
  erlaubt: readonly number[],
  fein = 0.15,
  grob = 1
): UngenaueAngabe[] {
  const ergebnis: UngenaueAngabe[] = []

  for (const zahl of findeProzentangaben(text)) {
    let naechster: number | null = null
    for (const quelle of erlaubt) {
      if (Math.abs(zahl - quelle) > grob) continue
      if (
        naechster === null ||
        Math.abs(zahl - quelle) < Math.abs(zahl - naechster)
      ) {
        naechster = quelle
      }
    }
    // No source at all — that is `unbelegteProzentangaben`'s finding, not ours.
    if (naechster === null) continue

    const zulaessig = Number.isInteger(zahl) ? 0.5 : fein
    if (Math.abs(zahl - naechster) > zulaessig) {
      ergebnis.push({ zahl, naechster })
    }
  }

  return ergebnis
}

/** The retry correction for sloppy arithmetic, naming the right figures. */
export function ungenauKorrekturHinweis(
  ungenau: readonly UngenaueAngabe[]
): string {
  if (ungenau.length === 0) return ''
  return (
    'Der Text rundet Prozentangaben falsch: ' +
    ungenau
      .map((u) => `${u.zahl} Prozent statt korrekt ${u.naechster} Prozent`)
      .join(', ') +
    '. Rechne exakt aus den uebergebenen Zahlen und runde erst am Schluss.'
  )
}

/** The correction handed back on the retry, naming the offending figures. */
export function zahlenKorrekturHinweis(unbelegt: readonly number[]): string {
  if (unbelegt.length === 0) return ''

  return (
    `Der Text enthaelt Prozentangaben, die nicht aus der Einordnung stammen: ` +
    `${unbelegt.map((z) => `${z} Prozent`).join(', ')}. ` +
    'Rechne nicht selbst — uebernimm die Prozentangaben aus der Einordnung ' +
    'woertlich oder lass sie weg.'
  )
}
