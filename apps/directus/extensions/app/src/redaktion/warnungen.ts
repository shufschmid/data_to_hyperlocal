// The FACES of the warnings a desk writes into `meldungen.zeit_warnungen`.
//
// One column carries every complaint a check can raise — relative time
// references, percentages nobody supplied, digits that stand in no fact, a
// private person named, a source line missing. That is right for the editor,
// who reads one list; it is not enough for a consumer, who has to know WHICH
// check spoke. The Pruefsiegel sorts them (`endpoints/api/projektion.ts`), and
// it can only do that against the exact wording the writers produce.
//
// So the wording lives here, once, and the writers build from it. Nothing in
// this module is a new rule: it is the shape of the rules that already exist,
// pulled out of the three places that were each holding one of them.

import { ZEITMUSTER } from './zeitbezug'

/** The exact face of a number warning — `spielbericht.ts` and five desks. */
export const ZAHL_WARNUNG = /^Zahl "(\d+)" steht nicht in den Angaben\.$/

export function zahlWarnung(zahl: string): string {
  return `Zahl "${zahl}" steht nicht in den Angaben.`
}

/** A percentage the model worked out for itself — `drain.ts` via `zahlen.ts`. */
export const UNBELEGTE_PROZENTANGABE = /^ungepruefte Prozentangabe: [\d.,]+%$/

export function unbelegteProzentWarnung(zahl: number): string {
  return `ungepruefte Prozentangabe: ${zahl}%`
}

/** One that is derivable but off — same check, same family of warning. */
export const UNGENAUE_PROZENTANGABE =
  /^ungenaue Prozentangabe: [\d.,]+% \(berechnet: [\d.,]+%\)$/

export function ungenaueProzentWarnung(
  zahl: number,
  naechster: number
): string {
  return `ungenaue Prozentangabe: ${zahl}% (berechnet: ${naechster}%)`
}

/**
 * A relative time reference as the non-statistics desks report it.
 *
 * The statistics run writes the bare word instead (`drain.ts` passes
 * `zeitbezug`'s own hits straight through), which is why sorting needs both
 * this pattern AND the word list — see `istZeitwarnung`.
 */
export const ZEIT_WARNUNG = /^Relativer Zeitbezug: "[^"]+"$/

export function zeitWarnung(wort: string): string {
  return `Relativer Zeitbezug: "${wort}"`
}

/**
 * Whether a warning came out of the time check.
 *
 * Two forms, both measured: the sentence above, and the bare word the
 * statistics run passes through from `zeitbezug.ts`. A warning is only ever
 * the whole word — the desks push one hit per entry — so an exact lookup is
 * right here where a substring match would swallow half the other warnings.
 */
export function istZeitwarnung(warnung: string): boolean {
  return ZEIT_WARNUNG.test(warnung) || ZEITMUSTER.has(warnung)
}

/** The day summary compared with the Bund's interim count, not its final result. */
export const BUND_ZWISCHENSTAND = /^Zwischenresultat des Bundes /

/**
 * Without a single comma: `zeit_warnungen` is stored as CSV, and a comma cuts
 * a warning into pieces (measured: one warning became eight tags). So the
 * figures are rounded to whole percents, a half Stand is written «½», and the
 * commas inside a Vorlage's title are dropped.
 */
export function bundZwischenstandWarnung(z: {
  titel: string
  antwort: 'angenommen' | 'abgelehnt'
  jaProzent: number | null
  staendeJa: number | null
  staendeNein: number | null
  stand: string | null
}): string {
  const staende = (n: number) =>
    `${Math.floor(n) === 0 && n % 1 !== 0 ? '' : Math.floor(n)}${n % 1 === 0 ? '' : '½'}`
  const zeit =
    z.stand === null
      ? ''
      : ` (Stand ${z.stand.slice(8, 10)}.${z.stand.slice(5, 7)}.${z.stand.slice(0, 4)} ${z.stand.slice(11, 16)} Uhr)`
  const teile = [
    `Schweiz vorläufig ${z.antwort === 'angenommen' ? 'Ja' : 'Nein'}`,
    z.jaProzent === null
      ? null
      : `mit rund ${Math.round(z.jaProzent)} Prozent Ja`,
    z.staendeJa === null || z.staendeNein === null
      ? null
      : `und bisher ${staende(z.staendeJa)} zu ${staende(z.staendeNein)} Ständen`
  ].filter((t): t is string => t !== null)
  const titel = z.titel.replace(/\s*,\s*/g, ' ')
  return `Zwischenresultat des Bundes${zeit}: «${titel}» — ${teile.join(' ')}. Prüfen ob das Bundesresultat klar genug ist bevor der Vergleich mit der Schweiz stehen bleibt.`
}

/** Whether a warning came out of one of the number checks. */
export function istZahlwarnung(warnung: string): boolean {
  return (
    ZAHL_WARNUNG.test(warnung) ||
    UNBELEGTE_PROZENTANGABE.test(warnung) ||
    UNGENAUE_PROZENTANGABE.test(warnung)
  )
}
