// Reading a printed waste calendar, and refusing to believe it too easily.
//
// The PDF is the source of record — municipalities check what goes into the
// letterbox more carefully than what goes on the website — but it is also a
// dense grid of bare day numbers under twelve month columns, which is exactly
// the shape a model can misread while sounding certain. Two things make that
// survivable.
//
// The first is that the calendar prints redundancy: every row names its weekday
// ("Papier, Karton — Mittwoch") and every cell a day of the month. Weekday and
// date are two independent statements about the same fact, so a mismatch is
// arithmetic we can check without asking anyone. `wochentagWarnung` is that check.
//
// The second is what we refuse to store. The weekly Hauskehricht needs no
// reminder — a fixed weekday is something residents know — and a reminder for
// it every week would train them to ignore the rest. So regular collections
// never become Termine; they are kept as a note on the calendar, and the model
// is asked to say what it classified that way, so an entire category that was
// dropped by mistake is visible rather than absent.

import type Anthropic from '@anthropic-ai/sdk'
import { verschiebe } from './feiertage'

export interface ExtrahierterTermin {
  kategorie: string
  zone: string | null
  /** ISO date, `YYYY-MM-DD`. */
  datum: string
  /** The weekday as printed next to the row — our cross-check, not a fact we use. */
  wochentag_laut_pdf: string | null
  bereitstellung: string | null
  anmeldung: string | null
  anmeldeschluss: string | null
  /**
   * The time of day the registration closes, `HH:MM`.
   *
   * It decides which edition the reminder belongs in, not just what the text
   * says: a deadline at 11.30 is still reachable from that morning's
   * newsletter, one at 08.00 is not.
   */
  anmeldeschluss_zeit: string | null
}

/**
 * One row of the printed calendar: a collection, its rules, and its dates.
 *
 * This mirrors how the calendar is actually laid out — "Papier, Karton |
 * Mittwoch | Bereitstellung … " once, then twelve day numbers across the month
 * columns. Asking for the same shape instead of a flat list of dates means the
 * instruction text is transcribed once per collection rather than once per
 * date, which is both closer to the source and about a tenth of the output.
 */
export interface ExtrahierteAbfuhr {
  kategorie: string
  zone: string | null
  /** The weekday as printed for the row — our cross-check, not a fact we use. */
  wochentag_laut_pdf: string | null
  daten: string[]
  bereitstellung: string | null
  anmeldung: string | null
  /**
   * The weekday a registration closes on ("Montag"), when the calendar states a
   * rule rather than dates. The actual deadline per collection is computed from
   * it — the last such weekday before the collection — because that is
   * arithmetic, and arithmetic is not the model's job.
   */
  anmeldung_wochentag: string | null
  /** The clock time of that deadline, `HH:MM` — "Montag 11.30 Uhr" → "11:30". */
  anmeldung_uhrzeit: string | null
}

export interface RegelmaessigeAbfuhr {
  kategorie: string
  rhythmus: string
}

export interface Extraktion {
  jahr: number
  zonen: string[]
  termine: ExtrahierterTermin[]
  regelmaessig: RegelmaessigeAbfuhr[]
  hinweise: string[]
}

export const EXTRAKTION_SYSTEM_PROMPT = `Du liest den gedruckten Abfuhrkalender einer Schweizer Gemeinde und gibst seinen Inhalt als Daten zurueck.

Der Kalender ist eine Tabelle: pro Abfuhrart eine Zeile mit ihren Regeln, darin
die Termine als Tageszahlen unter den Monatsspalten. Gib genau diese Struktur
zurueck — eine Abfuhr je Zeile, mit allen ihren Daten.

Was in "abfuhren" gehoert:
- Nur unregelmaessige Abfuhren und Sammlungen: Papier/Karton, Gruen- und
  Bioabfuhr mit einzelnen Daten, Haeckseldienst, Altmetall, Sonderabfaelle,
  Sammeltage.
- Eine Abfuhr, die immer am gleichen Wochentag stattfindet ("jeden Mittwoch"),
  gehoert NICHT hierher, sondern nach "regelmaessig", mit ihrem Rhythmus.
  Das gilt auch, wenn der Kalender jeden einzelnen Tag mit einem Symbol
  markiert: zaehle die Markierungen nicht ab, sondern erkenne den Rhythmus.
  Faellt eine woechentliche Abfuhr einzelne Male aus (Feiertagswoche), gehoert
  der Ausfall nach "hinweise", nicht jedes Datum nach "abfuhren".
- Ausnahmen von einer regelmaessigen Abfuhr ("*14. Dienstag statt Mittwoch")
  sind sehr wohl aufzufuehren. Sie sind der Grund, warum es diese Meldungen gibt.
  Nimm sie als eigene Zeile mit dem abweichenden Wochentag.
- Oeffnungszeiten, Abendoeffnungen und Schliesstage von Werkhof, Recyclingpark
  oder Sammelstellen sind KEINE Abfuhren — auch dann nicht, wenn der Kalender
  sie an einzelnen Tagen markiert. Fasse die Oeffnungszeiten in einem Satz
  unter "regelmaessig" zusammen; ausserordentliche Schliesstage gehoeren nach
  "hinweise".

Regeln, ohne Ausnahme:
- Schreibe die Daten ab. Rechne nichts aus und leite nichts her. Steht unter
  "Maerz" die Zahl 4, ist das der 4. Maerz des Kalenderjahres.
- "wochentag_laut_pdf" ist der Wochentag, wie er in der Zeile steht. Korrigiere
  ihn nicht, auch wenn er dir zu einem Datum nicht zu passen scheint.
- Hat die Gemeinde Zonen (Plateaus, Gebiete, Quartiere), ist jede Zone eine
  eigene Zeile mit ihren eigenen Daten. Verwende die Bezeichnungen des
  Kalenders. Ohne Zonen: null.
- "bereitstellung" ist die Regel, wann und wie das Material bereitstehen muss
  ("fruehestens 18 Uhr am Vorabend, spaetestens 7 Uhr am Abfuhrtag"), woertlich
  aus dem Kalender.
- "anmeldung" ist die vollstaendige Anmelderegel samt Telefon oder Formular.
  "anmeldung_wochentag" ist der Wochentag, an dem die Anmeldung schliesst
  ("Montag"), wenn der Kalender eine solche Frist nennt — sonst null. Nenne nur
  den Wochentag, kein Datum: das Datum wird berechnet.
  "anmeldung_uhrzeit" ist die Uhrzeit dieser Frist als "HH:MM" — aus
  "Montag 11.30 Uhr" wird "11:30". Nennt der Kalender statt einer Uhrzeit nur
  eine Tageszeit ("bis Montagvormittag"), gib das Wort zurueck: "Vormittag",
  "Mittag", "Nachmittag" oder "Abend". Ohne jede Zeitangabe: null. Diese
  Angabe entscheidet, in welcher Ausgabe die Erinnerung erscheint; rate sie
  nicht.
  "anmeldung_tage_vorher" ist die Frist, wenn der Kalender sie als Abstand
  nennt: aus "Anmeldung bis vier Tage vorher" wird 4. Sonst null. Auch hier
  wird der Stichtag berechnet, nicht geraten.
- Was unklar oder widerspruechlich ist, gehoert nach "hinweise". Rate nicht.
  Das gilt auch fuer einzelne Daten: Kannst du eine Tageszahl nicht sicher
  lesen, lass genau dieses Datum weg und benenne die Luecke in "hinweise" —
  leite es NICHT aus dem Rhythmus der anderen Daten ab. Ein fehlender Termin
  wird von der Redaktion nachgetragen; ein falscher erreicht die Leserinnen.
- Schweizer Rechtschreibung: "ss" statt "ß".`

export const EXTRAKTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['jahr', 'zonen', 'abfuhren', 'regelmaessig', 'hinweise'],
  properties: {
    jahr: { type: 'integer' },
    zonen: { type: 'array', items: { type: 'string' } },
    abfuhren: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'kategorie',
          'zone',
          'wochentag_laut_pdf',
          'daten',
          'bereitstellung',
          'anmeldung',
          'anmeldung_wochentag',
          'anmeldung_uhrzeit',
          'anmeldung_tage_vorher'
        ],
        properties: {
          kategorie: { type: 'string' },
          zone: { type: ['string', 'null'] },
          wochentag_laut_pdf: { type: ['string', 'null'] },
          daten: { type: 'array', items: { type: 'string' } },
          bereitstellung: { type: ['string', 'null'] },
          anmeldung: { type: ['string', 'null'] },
          anmeldung_wochentag: { type: ['string', 'null'] },
          anmeldung_uhrzeit: { type: ['string', 'null'] },
          anmeldung_tage_vorher: { type: ['integer', 'null'] }
        }
      }
    },
    regelmaessig: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kategorie', 'rhythmus'],
        properties: {
          kategorie: { type: 'string' },
          rhythmus: { type: 'string' }
        }
      }
    },
    hinweise: { type: 'array', items: { type: 'string' } }
  }
} as const satisfies Record<string, unknown>

/**
 * The one user turn: the PDF itself, then what we want from it.
 *
 * The document block goes first. Anthropic's guidance is that a document read
 * before the question is understood better than one appended after it, and the
 * municipality and year are the two facts that let the model check it is
 * looking at the calendar we think it is.
 */
export function buildExtraktionMessages(
  pdfBase64: string,
  gemeinde: string,
  jahr: number,
  zone: string | null = null
): Anthropic.MessageParam[] {
  return [
    {
      role: 'user',
      content: [
        {
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: pdfBase64
          }
        },
        {
          type: 'text',
          text: [
            zone === null
              ? `Das ist der Abfuhrkalender ${jahr} der Gemeinde ${gemeinde}.`
              : `Das ist der Abfuhrkalender ${jahr} der Gemeinde ${gemeinde}, und zwar` +
                ` das Dokument fuer die Zone "${zone}" — Gemeinden wie diese drucken` +
                ` je Zone einen eigenen Kalender. Alle Termine hier gelten fuer diese Zone.`,
            '',
            'Gib je unregelmaessiger Abfuhr eine Zeile mit allen ihren Daten',
            'zurueck, dazu die regelmaessigen Abfuhren als "regelmaessig" und',
            'alles Unklare als "hinweise".'
          ].join('\n')
        }
      ]
    }
  ]
}

const ISO_DATUM = /^\d{4}-\d{2}-\d{2}$/

function istEchtesDatum(iso: string): boolean {
  if (!ISO_DATUM.test(iso)) return false
  // Guards against 31 February: the round-trip only survives a real date.
  return new Date(`${iso}T00:00:00Z`).toISOString().slice(0, 10) === iso
}

function text(wert: unknown): string | null {
  if (typeof wert !== 'string') return null
  const sauber = wert.trim()
  return sauber === '' ? null : sauber
}

/**
 * A clock time as `HH:MM`, or null when it is not one.
 *
 * Swiss calendars write "11.30 Uhr", the schema asks for "11:30", and the model
 * obliges most of the time — this accepts both rather than losing a deadline to
 * a separator. Null is the safe answer: the planner then treats the deadline as
 * early and moves the reminder a day forward, which is a weaker reminder rather
 * than a useless one.
 */
export function normalisiereUhrzeit(wert: string): string | null {
  // The separator is optional so a bare "7 Uhr" survives; the minutes are only
  // read when one is present, which keeps "11.75" from parsing as a time.
  const treffer = /^\s*(\d{1,2})(?:[.:h]\s*(\d{2}))?\s*(?:Uhr)?\s*$/i.exec(wert)
  if (treffer === null) return null

  const stunde = Number(treffer[1])
  const minute = Number(treffer[2] ?? '0')
  if (stunde > 23 || minute > 59) return null

  return `${String(stunde).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

/**
 * A deadline's time as the planner understands it: `HH:MM`, or a canonical
 * time-of-day word where the calendar names no clock time.
 *
 * "Anmeldung bis Montagvormittag" carries real scheduling information — the
 * Vormittag ends at noon, after the newsletter is read, so the reminder still
 * belongs in Monday's edition (see `fristNachLesezeit`). Dropping the word to
 * null would move the reminder to Friday and turn a call to action into a note
 * to self. Morning words stay null on purpose: they close around reading time,
 * and there the safe answer really is the day before.
 */
export function normalisiereFristzeit(wert: string): string | null {
  const uhrzeit = normalisiereUhrzeit(wert)
  if (uhrzeit !== null) return uhrzeit

  const wort =
    /^\s*(?:\p{L}+(?:tag|woch)s?)?\s*[-,]?\s*(vormittag|mittag|nachmittag|abend)s?\s*$/iu.exec(
      wert
    )
  if (wort === null) return null

  const kanon = wort[1] ?? ''
  return kanon.charAt(0).toUpperCase() + kanon.slice(1).toLowerCase()
}

/**
 * The model's answer is a promise, not a proof.
 *
 * The JSON schema guarantees the shape; this guarantees the business rules —
 * that dates are dates, that they belong to this calendar's year, that a
 * deadline precedes its collection. A row that fails is dropped and named in
 * `hinweise`, because a calendar that silently lost the Sonderabfälle day is
 * worse than one that says it could not read it.
 */
export function parseExtraktion(
  antwort: unknown,
  erwartetesJahr: number,
  dokumentZone: string | null = null
): Extraktion {
  if (typeof antwort !== 'object' || antwort === null) {
    throw new Error('Antwort ist kein Objekt.')
  }
  const roh = antwort as Record<string, unknown>

  if (!Array.isArray(roh.abfuhren)) throw new Error('Feld "abfuhren" fehlt.')

  const hinweise: string[] = Array.isArray(roh.hinweise)
    ? roh.hinweise.filter((h): h is string => typeof h === 'string')
    : []

  // A per-zone document (the Riehen case) settles the zone before the model
  // says anything: the label is printed on the cover, the editor typed it, and
  // every date inside belongs to it. Whatever zones the model reports for
  // single rows are ignored — a fact we already hold is never re-derived.
  const zonen: string[] =
    dokumentZone !== null
      ? [dokumentZone]
      : Array.isArray(roh.zonen)
        ? [
            ...new Set(
              roh.zonen.filter(
                (z): z is string => typeof z === 'string' && z.trim() !== ''
              )
            )
          ]
        : []

  const regelmaessig: RegelmaessigeAbfuhr[] = Array.isArray(roh.regelmaessig)
    ? roh.regelmaessig.flatMap((eintrag) => {
        if (typeof eintrag !== 'object' || eintrag === null) return []
        const e = eintrag as Record<string, unknown>
        const kategorie = text(e.kategorie)
        const rhythmus = text(e.rhythmus)
        return kategorie === null
          ? []
          : [{ kategorie, rhythmus: rhythmus ?? '' }]
      })
    : []

  const termine: ExtrahierterTermin[] = []
  const gesehen = new Set<string>()

  for (const eintrag of roh.abfuhren) {
    if (typeof eintrag !== 'object' || eintrag === null) continue
    const e = eintrag as Record<string, unknown>

    const kategorie = text(e.kategorie)
    if (kategorie === null || !Array.isArray(e.daten)) continue

    const zone = dokumentZone ?? text(e.zone)
    // A zone the calendar never declared is a sign the model invented a split;
    // keep the dates, report the zone. Moot for per-zone documents, where the
    // zone is forced above.
    if (
      dokumentZone === null &&
      zone !== null &&
      zonen.length > 0 &&
      !zonen.includes(zone)
    ) {
      hinweise.push(
        `Zone "${zone}" kommt in der Zonenliste des Kalenders nicht vor.`
      )
    }

    const wochentagLautPdf = text(e.wochentag_laut_pdf)
    const bereitstellung = text(e.bereitstellung)
    const anmeldung = text(e.anmeldung)
    const anmeldungWochentag = text(e.anmeldung_wochentag)

    const uhrzeitRoh = text(e.anmeldung_uhrzeit)
    const anmeldungUhrzeit =
      uhrzeitRoh === null ? null : normalisiereFristzeit(uhrzeitRoh)
    if (uhrzeitRoh !== null && anmeldungUhrzeit === null) {
      hinweise.push(
        `"${kategorie}": Anmeldezeit "${uhrzeitRoh}" ist keine Uhrzeit — die Erinnerung erscheint sicherheitshalber einen Tag frueher.`
      )
    }

    // "bis vier Tage vorher": a distance, not a weekday. Sanity-bounded — a
    // deadline more than a month before its collection is a misreading.
    const tageVorherRoh = e.anmeldung_tage_vorher
    const tageVorher =
      typeof tageVorherRoh === 'number' &&
      Number.isInteger(tageVorherRoh) &&
      tageVorherRoh >= 1 &&
      tageVorherRoh <= 31
        ? tageVorherRoh
        : null

    for (const rohesDatum of e.daten) {
      const datum = text(rohesDatum)
      if (datum === null) continue

      if (!istEchtesDatum(datum)) {
        hinweise.push(`"${kategorie}": unlesbares Datum "${datum}" verworfen.`)
        continue
      }

      // A calendar prints its own year, plus the first days of the next one
      // ("14.+28." under Dezember, then the January collections). A date
      // outside that window means the model read the wrong column.
      const jahr = Number(datum.slice(0, 4))
      if (jahr !== erwartetesJahr && jahr !== erwartetesJahr + 1) {
        hinweise.push(
          `"${kategorie}" am ${datum} gehoert nicht zum Kalenderjahr ${erwartetesJahr} und wurde verworfen.`
        )
        continue
      }

      const schluessel = `${kategorie}|${zone ?? ''}|${datum}`
      if (gesehen.has(schluessel)) continue
      gesehen.add(schluessel)

      // Two printed shapes of the same fact, both computed here rather than by
      // the model: "bis zum Mittwoch vorher" walks back to that weekday,
      // "bis vier Tage vorher" (Pratteln) subtracts days.
      const anmeldeschluss =
        anmeldungWochentag !== null
          ? letzterWochentagVor(datum, anmeldungWochentag)
          : tageVorher !== null
            ? verschiebe(datum, -tageVorher)
            : null

      if (anmeldungWochentag !== null && anmeldeschluss === null) {
        hinweise.push(
          `"${kategorie}": Anmeldetag "${anmeldungWochentag}" ist kein Wochentag — Frist weggelassen.`
        )
      }

      termine.push({
        kategorie,
        zone,
        datum,
        wochentag_laut_pdf: wochentagLautPdf,
        bereitstellung,
        anmeldung,
        anmeldeschluss,
        anmeldeschluss_zeit: anmeldeschluss === null ? null : anmeldungUhrzeit
      })
    }
  }

  // Merging zones into "ganze Gemeinde" only makes sense when one document
  // covers them all (Binningen). A per-zone document sees a single zone by
  // definition — its counterpart lives in another PDF.
  const zusammengefasst =
    dokumentZone === null ? fasseZonenZusammen(termine, zonen) : termine

  return {
    jahr: typeof roh.jahr === 'number' ? roh.jahr : erwartetesJahr,
    zonen,
    termine: zusammengefasst.sort(
      (a, b) =>
        a.datum.localeCompare(b.datum) || a.kategorie.localeCompare(b.kategorie)
    ),
    regelmaessig,
    hinweise
  }
}

/**
 * A collection that happens everywhere on the same day is not zone-specific.
 *
 * The calendar prints the Häckseldienst inside both plateau tables because
 * that is how the page is laid out, not because the two differ — the dates and
 * the rules are identical. Kept apart, it produces two entries in the list, and
 * a reminder that says "sowohl im Ostplateau als auch im Westplateau" about
 * something that was never split. Kept together, it is one entry for the whole
 * municipality, and the cross-zone sentence correctly stays away.
 *
 * The instructions have to match too: same day, different rules per zone is a
 * real difference and stays two Termine.
 */
export function fasseZonenZusammen(
  termine: readonly ExtrahierterTermin[],
  zonen: readonly string[]
): ExtrahierterTermin[] {
  if (zonen.length < 2) return [...termine]

  const gruppen = new Map<string, ExtrahierterTermin[]>()
  for (const termin of termine) {
    const schluessel = `${termin.kategorie}|${termin.datum}`
    const bisher = gruppen.get(schluessel)
    if (bisher === undefined) gruppen.set(schluessel, [termin])
    else bisher.push(termin)
  }

  const ergebnis: ExtrahierterTermin[] = []

  for (const gruppe of gruppen.values()) {
    const erster = gruppe[0]
    if (erster === undefined) continue

    const abgedeckt = new Set(
      gruppe
        .map((termin) => termin.zone)
        .filter((zone): zone is string => zone !== null)
    )
    const alleZonen = zonen.every((zone) => abgedeckt.has(zone))
    const gleicheRegeln = gruppe.every(
      (termin) =>
        termin.bereitstellung === erster.bereitstellung &&
        termin.anmeldung === erster.anmeldung &&
        termin.anmeldeschluss === erster.anmeldeschluss &&
        termin.anmeldeschluss_zeit === erster.anmeldeschluss_zeit
    )

    if (alleZonen && gleicheRegeln) ergebnis.push({ ...erster, zone: null })
    else ergebnis.push(...gruppe)
  }

  return ergebnis
}

const WOCHENTAGE = [
  'Sonntag',
  'Montag',
  'Dienstag',
  'Mittwoch',
  'Donnerstag',
  'Freitag',
  'Samstag'
] as const

/** The weekday the date actually falls on, in German. */
export function wochentagName(iso: string): string {
  const tag = new Date(`${iso}T00:00:00Z`).getUTCDay()
  return WOCHENTAGE[tag] ?? ''
}

/** Index of a German weekday name, tolerating abbreviations and asterisks. */
function wochentagNummer(name: string): number | null {
  const sauber = name
    .toLowerCase()
    .replace(/[^a-zäöü]/g, '')
    .replace(/ae/g, 'ä')
  const treffer = WOCHENTAGE.findIndex((tag) => {
    const klein = tag.toLowerCase()
    return klein === sauber || (sauber.length >= 2 && klein.startsWith(sauber))
  })
  return treffer === -1 ? null : treffer
}

/**
 * The registration deadline for one collection date.
 *
 * The calendar states a rule, not dates: "Anmeldeschluss Montag 11.30 Uhr vor
 * dem gewuenschten Termin". Turning that into a date for each of the ten
 * Häckseldienst tours is arithmetic, so the model states the weekday and this
 * computes the rest — the last such weekday strictly before the collection.
 * Asking a model to do it ten times would be ten chances to be quietly wrong.
 */
export function letzterWochentagVor(
  datum: string,
  wochentag: string
): string | null {
  const ziel = wochentagNummer(wochentag)
  if (ziel === null) return null

  const tage = Date.parse(`${datum}T00:00:00Z`) / 86_400_000
  if (Number.isNaN(tage)) return null

  const heutiger = new Date(tage * 86_400_000).getUTCDay()
  // Strictly before: a deadline on the collection day itself is no deadline.
  const abstand = ((heutiger - ziel + 7 - 1) % 7) + 1

  return new Date((tage - abstand) * 86_400_000).toISOString().slice(0, 10)
}

/**
 * The cross-check the printed calendar hands us for free.
 *
 * "Mittwoch 7." is two statements about one day, and a model that slid one
 * column while reading a twelve-month grid breaks exactly this agreement. The
 * mismatch is flagged on the Termin rather than corrected: which of the two the
 * calendar got right is not ours to decide, and an editor with the PDF open
 * settles it in seconds.
 */
export function wochentagWarnung(termin: ExtrahierterTermin): string | null {
  const laut = termin.wochentag_laut_pdf
  if (laut === null) return null

  const tatsaechlich = wochentagName(termin.datum)
  // The calendar writes "Mittwoch", sometimes "Mittwoch*" or "Mi" — a
  // containment test in both directions covers the abbreviations without a
  // table of them.
  const a = laut.toLowerCase()
  const b = tatsaechlich.toLowerCase()
  if (a.includes(b) || b.startsWith(a.replace(/[^a-zäöü]/gi, ''))) return null

  return `Der Kalender nennt "${laut}", der ${termin.datum} ist aber ein ${tatsaechlich}.`
}

/** A Termin as it is stored — the shape both sides of a re-extraction speak. */
export interface GespeicherterTermin {
  id: string
  kategorie: string
  zone: string | null
  datum: string
  bereitstellung: string | null
  anmeldung: string | null
  anmeldeschluss: string | null
  anmeldeschluss_zeit: string | null
  geprueft: boolean
  meldung: string | null
}

export interface TerminDiff {
  anlegen: ExtrahierterTermin[]
  aktualisieren: Array<{
    id: string
    termin: ExtrahierterTermin
    meldung: string | null
  }>
  loeschen: GespeicherterTermin[]
  /** Meldungen whose facts no longer hold and must be written again. */
  invalidiereMeldungen: string[]
}

function schluessel(termin: {
  kategorie: string
  zone: string | null
  datum: string
}): string {
  return `${termin.kategorie}|${termin.zone ?? ''}|${termin.datum}`
}

function anweisungenGeaendert(
  alt: GespeicherterTermin,
  neu: ExtrahierterTermin
): boolean {
  return (
    alt.bereitstellung !== neu.bereitstellung ||
    alt.anmeldung !== neu.anmeldung ||
    alt.anmeldeschluss !== neu.anmeldeschluss ||
    alt.anmeldeschluss_zeit !== neu.anmeldeschluss_zeit
  )
}

/**
 * What a second reading of the calendar changes.
 *
 * Re-extraction has to be safe to run: a corrected PDF arrives in March, and
 * the eleven months of confirmed dates must not all lose their confirmation
 * because the file changed. So identity is `(Kategorie, Zone, Datum)` — a row
 * that still says the same thing keeps its `geprueft` flag and its Meldung.
 *
 * What did change invalidates: a moved date or a new registration deadline
 * makes any article written from it wrong, and an article is a cache of the
 * facts it was written from. The Meldung ids come back so the caller can
 * discard them; regenerating is cheap, publishing a wrong date is not.
 */
export function diffTermine(
  alt: readonly GespeicherterTermin[],
  neu: readonly ExtrahierterTermin[]
): TerminDiff {
  const altNachSchluessel = new Map(
    alt.map((termin) => [schluessel(termin), termin])
  )
  const neuSchluessel = new Set(neu.map(schluessel))

  const diff: TerminDiff = {
    anlegen: [],
    aktualisieren: [],
    loeschen: [],
    invalidiereMeldungen: []
  }

  for (const termin of neu) {
    const bestehend = altNachSchluessel.get(schluessel(termin))
    if (bestehend === undefined) {
      diff.anlegen.push(termin)
      continue
    }
    if (anweisungenGeaendert(bestehend, termin)) {
      diff.aktualisieren.push({
        id: bestehend.id,
        termin,
        meldung: bestehend.meldung
      })
      if (bestehend.meldung !== null)
        diff.invalidiereMeldungen.push(bestehend.meldung)
    }
  }

  for (const termin of alt) {
    if (neuSchluessel.has(schluessel(termin))) continue
    diff.loeschen.push(termin)
    if (termin.meldung !== null) diff.invalidiereMeldungen.push(termin.meldung)
  }

  diff.invalidiereMeldungen = [...new Set(diff.invalidiereMeldungen)]
  return diff
}

/** Fields whose change makes a confirmed Termin unconfirmed again. */
const INHALTLICHE_FELDER = [
  'datum',
  'anmeldeschluss',
  'anmeldeschluss_zeit',
  'bereitstellung',
  'anmeldung',
  'zone',
  'kategorie'
] as const

/**
 * Whether a write touches the facts of a Termin — as opposed to bookkeeping
 * like `geprueft` or the `meldung` link.
 *
 * The action hook decides on THIS, not on `ruecksetzungTermin`: by the time the
 * action runs, the filter has already merged `geprueft: false` into the same
 * payload, and a guard on "geprueft present" would read its own filter's work
 * as a confirmation write and never invalidate anything.
 */
export function beruehrtInhalt(payload: Record<string, unknown>): boolean {
  return INHALTLICHE_FELDER.some((feld) => feld in payload)
}

/**
 * Whether a write to a Termin has to drop its confirmation.
 *
 * An editor can correct a date in the Directus admin UI, which is not a path
 * any endpoint sees — so this is a hook rule, and this is its decision, kept
 * pure so it can be tested without a database. Confirming is itself a write
 * (`geprueft: true`), and that one must obviously not undo itself.
 */
export function ruecksetzungTermin(
  payload: Record<string, unknown>
): { geprueft: false } | null {
  if ('geprueft' in payload) return null
  return beruehrtInhalt(payload) ? { geprueft: false } : null
}

/**
 * The regular collections, as the note that replaces them.
 *
 * They produce no reminders, but the calendar's own words about them are what
 * an editor needs when a reader asks why the Hauskehricht is never mentioned.
 */
export function merkblattText(extraktion: Extraktion): string {
  const zeilen: string[] = []

  if (extraktion.regelmaessig.length > 0) {
    zeilen.push('Regelmaessige Abfuhren — erzeugen keine Erinnerungen:')
    for (const abfuhr of extraktion.regelmaessig) {
      zeilen.push(`- ${abfuhr.kategorie}: ${abfuhr.rhythmus}`)
    }
  }
  if (extraktion.zonen.length > 0) {
    if (zeilen.length > 0) zeilen.push('')
    zeilen.push(`Zonen: ${extraktion.zonen.join(', ')}`)
  }
  if (extraktion.hinweise.length > 0) {
    if (zeilen.length > 0) zeilen.push('')
    zeilen.push('Hinweise aus der Auslesung:')
    for (const hinweis of extraktion.hinweise) zeilen.push(`- ${hinweis}`)
  }

  return zeilen.join('\n')
}

/**
 * The calendar's Merkblatt when it consists of several documents.
 *
 * One section per document, headed by its zone, so an editor can tell which
 * PDF said what. A calendar with a single unzoned document keeps the plain
 * form — a heading over the only section would be noise.
 */
export function merkblattGesamt(
  abschnitte: ReadonlyArray<{ zone: string | null; extraktion: Extraktion }>
): string {
  if (abschnitte.length === 1 && abschnitte[0]?.zone == null) {
    const erster = abschnitte[0]
    return erster === undefined ? '' : merkblattText(erster.extraktion)
  }

  return abschnitte
    .map(({ zone, extraktion }) => {
      const inhalt = merkblattText(extraktion)
      const titel = zone ?? 'Ganze Gemeinde'
      return inhalt === '' ? `— ${titel} —` : `— ${titel} —\n${inhalt}`
    })
    .join('\n\n')
}
