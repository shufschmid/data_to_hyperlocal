// Der Termin einer Meldung — wann sie fuer die Leserin zaehlt, und an welchen
// Tagen der Dorfkoenig sie bringen soll.
//
// Die Schnittstelle dafuer hat der Dorfkoenig am 21. September 2026
// vorgeschlagen (SCHNITTSTELLE.md, „Termin und Auftritte"): je Artikel ein
// optionales `termin` mit `ideal` (der Anmeldeschluss, der erste Tag, der Tag
// der Sperrung), `ende` (der letzte Tag, an dem die Meldung noch Sinn hat) und
// `auftritte` (die Lesetage im Briefing, hoechstens fuenf). Fehlt die Liste,
// bringt er die Meldung einmal, am Werktag vor `ideal` — die bisherige Regel.
//
// Die Redaktion hat am 22. September 2026 gesagt, was sie will: der Termin
// wird uebergeben; bei WICHTIGEN Anlaessen, bei denen sich eine fruehe
// Ankuendigung anbietet, mehrere Auftritte — die erste Ankuendigung sofort,
// dann der Termin, bei laengeren Ausstellungen auch der letzte Tag, an dem
// sich ein Besuch noch lohnt. Sie will den Vorschlag aendern koennen, im Blog
// muss davon nichts erscheinen, und das System soll lernen, was sie als
// wichtig einstuft.
//
// Drei Dinge entscheidet darum CODE, nie das Modell: dass ein Datum, das der
// Dorfkoenig bekommt, im Material stand; dass `ende` nicht vor `ideal` liegt
// und kein Auftritt hinter `ende`; und WELCHER Tag „sofort" ist — der erste
// Lesetag nach der Publikation, aus `publiziert_am` gerechnet, nicht aus dem
// Tag, an dem der Lauf schrieb: ein Artikel liegt oft Tage auf dem Tisch,
// bevor er publiziert wird, und ein Lesetag in der Vergangenheit ist fuer den
// Dorfkoenig kein Auftritt.

import { heuteIso, istNewsletterTag, verschiebe } from './feiertage'
import type { Zugang } from '../types/schema'

/** Wie der Dorfkoenig ihn haben will — hoechstens fuenf Lesetage. */
export const AUFTRITTE_MAX = 5

/**
 * Ab dieser Spanne bekommt ein offen zugaenglicher Anlass seinen LETZTEN Tag
 * als Auftritt: eine Ausstellung, die Wochen laeuft, ist an einem Tag gesehen,
 * und ihr letzter Tag heisst fuer die Leserin „letzte Gelegenheit". Ein Kurs
 * oder ein Lager bekommt das nie — sein Ende geht nur die Teilnehmenden an.
 */
export const LETZTE_GELEGENHEIT_AB_TAGEN = 7

/** Was auf der Meldung liegt. `auftritte` sind ISO-Tage, ohne „sofort" — das rechnet die Auslieferung. */
export interface Termin {
  ideal: string
  ende: string
  auftritte: string[]
}

/** Was der Dorfkoenig bekommt. `auftritte` fehlt, wenn seine Standardregel gelten soll. */
export interface ApiTermin {
  ideal: string
  ende: string
  auftritte?: string[]
}

const ISO_TAG = /^\d{4}-\d{2}-\d{2}$/

export function istIsoTag(wert: unknown): wert is string {
  if (typeof wert !== 'string' || !ISO_TAG.test(wert)) return false
  const [j, m, t] = wert.split('-').map(Number)
  const d = new Date(Date.UTC(j ?? 0, (m ?? 1) - 1, t ?? 1))
  return (
    d.getUTCFullYear() === j &&
    d.getUTCMonth() === (m ?? 1) - 1 &&
    d.getUTCDate() === t
  )
}

/**
 * Der erste Lesetag NACH einem Tag: Montag bis Freitag, kein Basler Feiertag.
 *
 * Das Briefing erscheint fruehmorgens und wird am Abend davor produziert —
 * der Tag der Publikation selbst ist also schon vorbei. Wer am Freitag
 * publiziert, wird am Montag gelesen.
 */
export function naechsterLesetag(nach: string): string {
  let tag = verschiebe(nach, 1)
  for (let i = 0; i < 14 && !istNewsletterTag(tag); i += 1) {
    tag = verschiebe(tag, 1)
  }
  return tag
}

/** Der Kalendertag der Publikation in Schweizer Zeit — aus dem Zeitstempel der Zeile. */
export function publikationsTag(publiziertAm: string | null): string | null {
  if (publiziertAm === null) return null
  const d = new Date(publiziertAm)
  if (Number.isNaN(d.getTime())) return null
  return heuteIso(d)
}

function sortiertOhneDoppel(tage: readonly string[]): string[] {
  return [...new Set(tage)].sort()
}

export interface TerminPruefung {
  termin: Termin | null
  /** Warum nichts uebernommen wurde — auf Deutsch, fuer die Zeile. */
  fehler: string | null
}

/**
 * Was von aussen kommt — vom Modell oder von der Redaktion —, wird geprueft,
 * bevor es auf die Zeile darf. Ein Fehler kostet den Termin, nie die Meldung,
 * und wird benannt.
 */
export function pruefeTermin(roh: unknown): TerminPruefung {
  if (roh === null || roh === undefined) return { termin: null, fehler: null }
  if (typeof roh !== 'object') {
    return { termin: null, fehler: 'Der Termin ist kein Objekt.' }
  }
  const o = roh as Record<string, unknown>
  if (o['ideal'] === null || o['ideal'] === undefined) {
    return { termin: null, fehler: null }
  }
  if (!istIsoTag(o['ideal'])) {
    return {
      termin: null,
      fehler: 'Der ideale Tag ist kein Kalendertag (JJJJ-MM-TT).'
    }
  }
  const ideal = o['ideal']
  let ende = ideal
  if (o['ende'] !== null && o['ende'] !== undefined) {
    if (!istIsoTag(o['ende'])) {
      return {
        termin: null,
        fehler: 'Das Ende ist kein Kalendertag (JJJJ-MM-TT).'
      }
    }
    ende = o['ende']
  }
  if (ende < ideal) {
    return { termin: null, fehler: 'Das Ende liegt vor dem idealen Tag.' }
  }
  const rohAuftritte = o['auftritte']
  const auftritte: string[] = []
  if (rohAuftritte !== null && rohAuftritte !== undefined) {
    if (!Array.isArray(rohAuftritte)) {
      return { termin: null, fehler: 'Die Auftritte sind keine Liste.' }
    }
    for (const a of rohAuftritte) {
      if (!istIsoTag(a)) {
        return {
          termin: null,
          fehler: 'Ein Auftritt ist kein Kalendertag (JJJJ-MM-TT).'
        }
      }
      if (a > ende) {
        return {
          termin: null,
          fehler: `Der Auftritt am ${a} liegt nach dem Ende.`
        }
      }
      auftritte.push(a)
    }
  }
  const bereinigt = sortiertOhneDoppel(auftritte)
  if (bereinigt.length > AUFTRITTE_MAX) {
    return {
      termin: null,
      fehler: `Hoechstens ${AUFTRITTE_MAX} Auftritte — es sind ${bereinigt.length}.`
    }
  }
  return { termin: { ideal, ende, auftritte: bereinigt }, fehler: null }
}

export function tageZwischen(von: string, bis: string): number {
  const a = Date.parse(`${von}T00:00:00Z`)
  const b = Date.parse(`${bis}T00:00:00Z`)
  return Math.round((b - a) / 86_400_000)
}

/**
 * Die Auftritte, die der Code zu einem Termin vorschlaegt.
 *
 * Nicht wichtig: keine — der Dorfkoenig bringt die Meldung einmal am Werktag
 * vor dem Termin, wie bisher. Wichtig: der Termin selbst; „sofort" kommt bei
 * der Auslieferung dazu, weil erst dann feststeht, wann publiziert wurde.
 * Ein offener Anlass, der lange genug laeuft, bekommt auch seinen letzten Tag.
 */
export function planeAuftritte(
  ideal: string,
  ende: string,
  wichtig: boolean,
  zugang: Zugang | null = null
): string[] {
  if (!wichtig) return []
  const tage = [ideal]
  if (
    zugang === 'offen' &&
    tageZwischen(ideal, ende) >= LETZTE_GELEGENHEIT_AB_TAGEN
  ) {
    tage.push(ende)
  }
  return sortiertOhneDoppel(tage)
}

export interface AnlassFuerTermin {
  anker: string | null
  anker_am: string | null
  frist_am: string | null
  von: string
  bis: string | null
  termine: readonly string[] | null
  zugang: Zugang | null
}

/**
 * Der Termin eines Anlasses — aus seinen Feldern, ohne Modell.
 *
 * `ideal` ist der Anmeldeschluss, wo es einen gibt, sonst der Tag, den der
 * Anker meint (der erste Tag, der letzte Tag einer Ausstellung, der
 * abgesagte Termin), sonst der erste Termin. `ende` ist der letzte bekannte
 * Tag. Ein Dauerangebot hat keinen Termin: es gilt an jedem Tag, und der
 * Dorfkoenig soll es nicht an einen binden.
 */
export function planeAnlassTermin(
  z: AnlassFuerTermin,
  wichtig: boolean
): Termin | null {
  if (z.anker === 'dauerangebot' || z.anker === 'routine') return null
  const ideal = z.frist_am ?? z.anker_am ?? z.von
  if (!istIsoTag(ideal)) return null
  const letzter =
    z.termine === null || z.termine.length === 0
      ? null
      : (z.termine[z.termine.length - 1] ?? null)
  const kandidat = z.bis ?? letzter ?? ideal
  const ende = istIsoTag(kandidat) && kandidat > ideal ? kandidat : ideal
  return {
    ideal,
    ende,
    auftritte: planeAuftritte(ideal, ende, wichtig, z.zugang)
  }
}

export interface MitteilungsTerminVorschlag {
  ideal: string | null
  ende: string | null
}

/**
 * Der Termin einer Gemeinde-Mitteilung — vom Modell aus dem Text gelesen,
 * vom Code an das Material gebunden.
 *
 * Das Modell darf nur Tage nennen, die der Code selbst im Wortlaut gefunden
 * hat (`alleDaten`). Ein Tag, der nicht darunter ist, ist erfunden oder
 * verrechnet, und der Termin faellt weg — mit einer Warnung, nicht still.
 */
export function planeMitteilungTermin(
  vorschlag: MitteilungsTerminVorschlag | null,
  gefunden: readonly string[],
  wichtig: boolean
): { termin: Termin | null; warnung: string | null } {
  if (vorschlag === null || vorschlag.ideal === null) {
    return { termin: null, warnung: null }
  }
  const erlaubt = new Set(gefunden)
  if (!istIsoTag(vorschlag.ideal) || !erlaubt.has(vorschlag.ideal)) {
    return {
      termin: null,
      warnung: `Termin nicht uebernommen: der Tag ${String(vorschlag.ideal)} steht nicht im Wortlaut.`
    }
  }
  let ende = vorschlag.ideal
  if (vorschlag.ende !== null) {
    if (!istIsoTag(vorschlag.ende) || !erlaubt.has(vorschlag.ende)) {
      return {
        termin: null,
        warnung: `Termin nicht uebernommen: das Ende ${String(vorschlag.ende)} steht nicht im Wortlaut.`
      }
    }
    ende = vorschlag.ende < vorschlag.ideal ? vorschlag.ideal : vorschlag.ende
  }
  return {
    termin: {
      ideal: vorschlag.ideal,
      ende,
      auftritte: planeAuftritte(vorschlag.ideal, ende, wichtig)
    },
    warnung: null
  }
}

/** Liest `{"ideal": "...", "ende": "..."}` aus einer Modellantwort — oder nichts. */
export function terminVorschlagAus(
  roh: unknown
): MitteilungsTerminVorschlag | null {
  if (roh === null || roh === undefined || typeof roh !== 'object') return null
  const o = roh as Record<string, unknown>
  const ideal = typeof o['ideal'] === 'string' ? o['ideal'].trim() : null
  if (ideal === null || ideal === '') return null
  const ende =
    typeof o['ende'] === 'string' && o['ende'].trim() !== ''
      ? o['ende'].trim()
      : null
  return { ideal, ende }
}

/** Liest das `wichtig` einer Modellantwort — fehlt es, gilt „nicht wichtig". */
export function wichtigAus(roh: unknown): boolean {
  if (roh === null || roh === undefined || typeof roh !== 'object') return false
  return (roh as Record<string, unknown>)['wichtig'] === true
}

/**
 * Was der Dorfkoenig bekommt.
 *
 * Bei einem wichtigen Anlass steht „sofort" vorne: der erste Lesetag nach der
 * Publikation — nur, wenn er nicht schon hinter `ende` liegt. Alles ueber
 * `ende` hinaus faellt weg, Doppelte werden eins, mehr als fuenf gibt es nicht
 * (die fruehesten bleiben, weil sie zuerst dran sind). Ohne Auftritte fehlt
 * die Liste ganz, und die Standardregel des Dorfkoenigs gilt.
 */
export function apiTermin(
  termin: Termin | null,
  wichtig: boolean | null,
  publiziertAm: string | null
): ApiTermin | null {
  if (termin === null) return null
  const tage = [...termin.auftritte]
  const publiziert = publikationsTag(publiziertAm)
  if (wichtig === true && publiziert !== null) {
    tage.unshift(naechsterLesetag(publiziert))
  }
  const auftritte = sortiertOhneDoppel(
    tage.filter((t) => t <= termin.ende)
  ).slice(0, AUFTRITTE_MAX)
  return auftritte.length === 0
    ? { ideal: termin.ideal, ende: termin.ende }
    : { ideal: termin.ideal, ende: termin.ende, auftritte }
}

/** Liest einen gespeicherten Termin, so wie Directus ihn zurueckgibt — tolerant, nie werfend. */
export function terminAus(roh: unknown): Termin | null {
  return pruefeTermin(roh).termin
}
