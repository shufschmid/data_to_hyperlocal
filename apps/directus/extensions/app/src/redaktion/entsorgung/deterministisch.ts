// The deterministic path, in the shape the desk already speaks.
//
// `kalenderleser.ts` turns a machine-readable source into collection days.
// This module turns those days into the same `Extraktion` the model produces
// from a printed calendar, so everything downstream — the diff against the
// stored Termine, the Freigabe, the reminders — cannot tell the two paths
// apart and does not have to.
//
// One decision is worth stating, because it is the only place where the two
// paths differ in substance: the weekly routines do not become Termine. That is
// the same rule the prompt states for the model ("a collection that always
// happens on the same weekday belongs in regelmaessig"), applied here by the
// collection's kind rather than by the model's judgement. And like the model
// path, it REPORTS what it classified that way: a whole category that vanished
// by mistake has to be visible, not absent.

import type { Extraktion, ExtrahierterTermin } from '../entsorgung'
import { trenneHinweis, type Abfuhrart } from './arten'
import { liesIcmsTabelle, liesIcs, type KalenderTermin } from './kalenderleser'

/** How a calendar is read. `pdf` is the model path and the default. */
export type Lesart = 'ics' | 'icms' | 'pdf'

/** The two Lesarten that need no model. */
export type DeterministischeLesart = Exclude<Lesart, 'pdf'>

/** True for the Lesarten this module can serve. */
export function istDeterministisch(
  lesart: string | null
): lesart is DeterministischeLesart {
  return lesart === 'ics' || lesart === 'icms'
}

/** The reader the Lesart names. */
export function liesQuelle(
  lesart: DeterministischeLesart,
  text: string
): KalenderTermin[] {
  return lesart === 'ics' ? liesIcs(text) : liesIcmsTabelle(text)
}

export interface ExtraktionOptionen {
  jahr: number
  /** The zone of the document being read; the source's own zone wins over it. */
  zone: string | null
}

/**
 * The collection days as an `Extraktion`.
 *
 * Everything the printed calendar carries around a date — the Bereitstellung,
 * the registration, its deadline — is `null` here, because a machine-readable
 * source does not carry it. Null is the honest answer; inventing a
 * Bereitstellung would be worse than not showing one.
 */
export function alsExtraktion(
  termine: readonly KalenderTermin[],
  optionen: ExtraktionOptionen
): Extraktion {
  const imJahr = termine.filter((t) => t.datum.startsWith(`${optionen.jahr}-`))
  const hinweise: string[] = []
  if (imJahr.length < termine.length) {
    // A municipality's widget shows the turn of the year, and the calendar
    // being read is one year. Said out loud, because a silently shorter year
    // looks exactly like a correctly read one.
    hinweise.push(
      `${termine.length - imJahr.length} Termine der Quelle liegen ausserhalb ` +
        `von ${optionen.jahr} und wurden nicht uebernommen.`
    )
  }

  const laut = imJahr.filter((t) => !t.stumm)
  const zoneVon = (t: KalenderTermin): string | null =>
    t.zone !== '' ? t.zone : optionen.zone

  // Counted by KIND, not by wording. Riehen writes "Schwarzkehricht" and
  // "Schwarzkehricht bis 6 Uhr bereit stellen" in the same calendar, and
  // counting the strings would report one routine twice. The name shown is the
  // shortest wording, which is the name without the instruction.
  const gezaehlt = new Map<Abfuhrart, { name: string; anzahl: number }>()
  for (const t of imJahr.filter((eintrag) => eintrag.stumm)) {
    const name = trenneHinweis(t.artRoh).name
    const bisher = gezaehlt.get(t.art)
    gezaehlt.set(t.art, {
      name:
        bisher === undefined || name.length < bisher.name.length
          ? name
          : bisher.name,
      anzahl: (bisher?.anzahl ?? 0) + 1
    })
  }

  const zonen = [
    ...new Set(
      laut
        .map(zoneVon)
        .filter((zone): zone is string => zone !== null && zone !== '')
    )
  ]

  return {
    jahr: optionen.jahr,
    zonen,
    termine: laut.map((t): ExtrahierterTermin => {
      const { name, hinweis } = trenneHinweis(t.artRoh)
      return {
        kategorie: name,
        zone: zoneVon(t),
        datum: t.datum,
        wochentag_laut_pdf: null,
        // The only thing a machine-readable source carries besides the date:
        // "bis 6 Uhr bereit stellen", which is exactly what this field is for.
        bereitstellung: hinweis,
        anmeldung: null,
        anmeldeschluss: null,
        anmeldeschluss_zeit: null
      }
    }),
    regelmaessig: [...gezaehlt.values()].map(({ name, anzahl }) => ({
      kategorie: name,
      rhythmus: `${anzahl} Termine im Kalender, als Routine gefuehrt und nicht erinnert`
    })),
    hinweise
  }
}
