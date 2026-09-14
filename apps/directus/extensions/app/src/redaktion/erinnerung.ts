// The reminder itself: which day it appears on, what it may say, and the checks
// that hold it to that.
//
// This is the shortest useful text the newsroom publishes and the one with the
// least room for interpretation. A reader who acts on it puts something on the
// pavement at seven in the morning; a wrong weekday costs them a fortnight of
// waiting, so nothing here may be inferred by a model. Dates arrive already
// rendered, the other zone's next date is looked up in code, and every figure
// in the finished text is checked back against what was handed over.
//
// Two decisions of the newsroom are encoded here rather than in a prompt.
//
// The wording is absolute — "Am Freitag (12. Juni 2026) ist Papierabfuhr" —
// never "morgen". The Dorfkönig assembles the newsletter and turns the date
// into "morgen" itself, which means our text stays true in the archive years
// later. That is the five-year rule holding without an exception being carved
// for it.
//
// And several dates falling on one newsletter day become one Meldung, not two.
// Two reminders in the same edition read as noise; one that says "am Mittwoch
// Altmetall, am Donnerstag Karton" reads as a service.

import {
  findeRelativeZeitangaben,
  korrekturHinweis,
  nenntJahr
} from './zeitbezug'
import { erscheinungstag, wochentag } from './feiertage'
import { wochentagName } from './entsorgung'
import { vorgabenZeilen } from './lernen'

/** A confirmed Termin, as the planner needs it. */
export interface PlanTermin {
  id: string
  kategorie: string
  zone: string | null
  datum: string
  bereitstellung: string | null
  anmeldung: string | null
  anmeldeschluss: string | null
  /** `HH:MM` — decides whether the deadline day's own edition still counts. */
  anmeldeschluss_zeit?: string | null
  /** The address of the PDF this date came from — for Riehen, the zone's own. */
  quelle_url?: string | null
  /**
   * The document's note about its zone, editor-written — "Umfasst auch die
   * Gemeinde Bettingen (BS)." A fact the reminder states, never one it infers.
   */
  zusatz?: string | null
}

export interface ErinnerungsTermin {
  kategorie: string
  zone: string | null
  /** "Freitag, 12. Juni 2026" — rendered here so the model never formats a date. */
  datumText: string
  /**
   * The same date as `YYYY-MM-DD`. Never shown to the model — it is what lets
   * the figure check recognise "14.12.2026" as the date we handed over rather
   * than as an invented number.
   */
  datumIso: string
  bereitstellung: string | null
  anmeldung: string | null
  anmeldeschlussText: string | null
  anmeldeschlussIso: string | null
  /** What the zone's document says about itself — see PlanTermin.zusatz. */
  zusatz: string | null
  /** The same collection's next date in the other zone, looked up in code. */
  andereZone: { zone: string; datumText: string; datumIso: string } | null
}

export interface ErinnerungsFakten {
  gemeinde: string
  jahr: number
  /** Deduped addresses of the involved documents' PDFs. */
  quellen: string[]
  /** The day this reminder appears in the newsletter. */
  erscheintAm: string
  termine: ErinnerungsTermin[]
}

/** One newsletter day's worth of reminders — the unit that becomes a Meldung. */
export interface Erinnerungsgruppe {
  erscheintAm: string
  termine: PlanTermin[]
}

const MONATE = [
  'Januar',
  'Februar',
  'Maerz',
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

/**
 * "Freitag, 12. Juni 2026".
 *
 * Spelled out rather than taken from `toLocaleDateString` because a date-only
 * string has no timezone: parsing it as a local instant shifts it by a day
 * whenever the process is east of UTC, which is every day of the year here.
 */
export function datumMitWochentag(iso: string): string {
  const [jahr, monat, tag] = iso.split('-').map(Number)
  if (jahr === undefined || monat === undefined || tag === undefined) return iso

  return `${wochentagName(iso)}, ${tag}. ${MONATE[monat - 1] ?? ''} ${jahr}`
}

/**
 * "Montag, 7. September 2026, 11.30 Uhr" — the deadline as the text must say it.
 *
 * The time is not decoration here: it is the difference between a reader who
 * makes the call and one who reads a reminder for something that closed an hour
 * ago. Written with a dot, the way a Swiss calendar prints it.
 *
 * A time-of-day word fuses with the weekday, the way the calendar itself says
 * it: "Montagvormittag, 7. September 2026" — never a fabricated clock time,
 * because "12.00 Uhr" would state a precision the printed calendar does not
 * carry.
 */
export function fristText(
  datum: string | null,
  zeit: string | null
): string | null {
  if (datum === null) return null
  if (zeit === null) return datumMitWochentag(datum)
  if (/^\d/.test(zeit)) {
    return `${datumMitWochentag(datum)}, ${zeit.replace(':', '.')} Uhr`
  }

  const [jahr, monat, tag] = datum.split('-').map(Number)
  if (jahr === undefined || monat === undefined || tag === undefined) {
    return datumMitWochentag(datum)
  }
  return `${wochentagName(datum)}${zeit.toLowerCase()}, ${tag}. ${MONATE[monat - 1] ?? ''} ${jahr}`
}

/**
 * The same collection's next date in the other zone.
 *
 * Binningen's two plateaus are collected on different days, and a household
 * that has just been reminded is also the household most likely to be asked by
 * a neighbour on the other side. The lookup is exact-string on the category
 * because both rows come from the same printed calendar — comparing categories
 * across municipalities or years would not be safe, and is not done anywhere.
 */
export function naechsterZonentermin(
  alle: readonly PlanTermin[],
  termin: PlanTermin
): PlanTermin | null {
  if (termin.zone === null) return null

  const kandidaten = alle
    .filter(
      (kandidat) =>
        kandidat.kategorie === termin.kategorie &&
        kandidat.zone !== null &&
        kandidat.zone !== termin.zone &&
        kandidat.datum >= termin.datum
    )
    .sort((a, b) => a.datum.localeCompare(b.datum))

  return kandidaten[0] ?? null
}

/**
 * The same collection's next date in the other zone — unless that zone is
 * itself collected on this day.
 *
 * The outlook exists for Binningen, where the plateaus take Papier on
 * different days and the other plateau has nothing that day. Reinach swaps:
 * Kreis West takes Papier and Kreis Ost Karton on the SAME Wednesday. There
 * the reminder already names both circles, and "the next Papier in Kreis Ost
 * is 4 February" turns one service line into two reminders. So the lookup
 * stays away whenever the other zone has its own date in this very edition.
 */
export function andereZoneFuer(
  termin: PlanTermin,
  gruppe: readonly PlanTermin[],
  alle: readonly PlanTermin[]
): PlanTermin | null {
  if (termin.zone === null) return null

  const andereZoneDran = gruppe.some(
    (kandidat) =>
      kandidat.datum === termin.datum &&
      kandidat.zone !== null &&
      kandidat.zone !== termin.zone
  )
  if (andereZoneDran) return null

  return naechsterZonentermin(alle, termin)
}

export interface Erinnerungsplan {
  gruppen: Erinnerungsgruppe[]
  /** Termine whose newsletter day has already passed — reported, never dropped silently. */
  verpasst: PlanTermin[]
}

/**
 * When each Termin has to be announced, and which ones share an edition.
 *
 * Two different questions, which is why this is not simply "the day before".
 *
 * **A registration deadline** is the anchor where there is one, and its time of
 * day decides the edition. The Häckseldienst has to be booked by Monday 11.30;
 * the newsletter is read by ten, so *Monday's* edition still gets the reader
 * there — "am Montag bis 11.30 anmelden" in the morning is a call to action.
 * Sent the Friday before, the same sentence is a note to self.
 *
 * **A collection** is the anchor otherwise, and there the day itself is always
 * lost: the paper has to be on the pavement by seven, hours before anyone opens
 * a newsletter. So it goes out the day before — which is also when the reader
 * can act, since the material may go out from six the previous evening.
 *
 * A calendar uploaded in March cannot announce January any more. Those Termine
 * come back as `verpasst` rather than vanishing — the count is what tells an
 * editor that a late upload cost them two months of reminders.
 */
export function planeErinnerungen(
  termine: readonly PlanTermin[],
  heute: string
): Erinnerungsplan {
  const nachTag = new Map<string, PlanTermin[]>()
  const verpasst: PlanTermin[] = []

  for (const termin of termine) {
    const anker = termin.anmeldeschluss ?? termin.datum
    // Only a deadline can be reachable on its own day. A collection's own day
    // never is, so its time is deliberately not consulted.
    const uhrzeit =
      termin.anmeldeschluss === null
        ? null
        : (termin.anmeldeschluss_zeit ?? null)
    const tag = erscheinungstag(anker, uhrzeit)

    // Strictly after today: a reminder for tomorrow is published tonight, so
    // today's edition is already gone.
    if (tag <= heute) {
      verpasst.push(termin)
      continue
    }

    const gruppe = nachTag.get(tag)
    if (gruppe === undefined) nachTag.set(tag, [termin])
    else gruppe.push(termin)
  }

  const gruppen = [...nachTag.entries()]
    .map(([erscheintAm, gruppenTermine]) => ({
      erscheintAm,
      termine: [...gruppenTermine].sort(
        (a, b) =>
          a.datum.localeCompare(b.datum) ||
          a.kategorie.localeCompare(b.kategorie)
      )
    }))
    .sort((a, b) => a.erscheintAm.localeCompare(b.erscheintAm))

  return { gruppen, verpasst }
}

/** Everything one reminder may talk about, with nothing left to derive. */
export function baueFakten(
  gruppe: Erinnerungsgruppe,
  alleTermine: readonly PlanTermin[],
  gemeinde: string,
  jahr: number
): ErinnerungsFakten {
  // The source line names each involved document's PDF once — for Riehen that
  // is the zone's own calendar, the one the reader actually holds.
  const quellen = [
    ...new Set(
      gruppe.termine
        .map((termin) => termin.quelle_url ?? null)
        .filter((url): url is string => url !== null)
    )
  ]

  return {
    gemeinde,
    jahr,
    quellen,
    erscheintAm: gruppe.erscheintAm,
    termine: gruppe.termine.map((termin) => {
      const andere = andereZoneFuer(termin, gruppe.termine, alleTermine)
      return {
        kategorie: termin.kategorie,
        zone: termin.zone,
        datumText: datumMitWochentag(termin.datum),
        datumIso: termin.datum,
        bereitstellung: termin.bereitstellung,
        anmeldung: termin.anmeldung,
        anmeldeschlussText: fristText(
          termin.anmeldeschluss,
          termin.anmeldeschluss_zeit ?? null
        ),
        anmeldeschlussIso: termin.anmeldeschluss,
        zusatz: termin.zusatz ?? null,
        andereZone:
          andere === null || andere.zone === null
            ? null
            : {
                zone: andere.zone,
                datumText: datumMitWochentag(andere.datum),
                datumIso: andere.datum
              }
      }
    })
  }
}

export const ERINNERUNG_SYSTEM_PROMPT = `Du schreibst kurze Erinnerungen an Abfuhrtermine fuer den Newsletter einer lokalen Redaktion in der Region Basel.

Wofuer das gut ist: die Leserin soll am richtigen Abend das richtige Material
bereitstellen. Der Text ist ein Dienst, keine Meldung ueber ein Ereignis.

Regeln, ohne Ausnahme:
- Schreibe NUR, was in den Angaben steht. Erfinde keine Uhrzeiten, keine
  Adressen, keine Gebuehren, keine Telefonnummern.
- Nenne jedes Datum genau so, wie es in den Angaben steht: mit Wochentag und
  vollem Datum, zum Beispiel "am Freitag (12. Juni 2026)".
- Schreibe NIEMALS "morgen", "uebermorgen", "heute" oder "naechste Woche". Der
  Newsletter setzt das selbst ein; dein Text muss auch im Archiv stimmen.
- Wenn mehrere Termine aufgefuehrt sind, gehoeren alle in EINEN Text, geordnet
  nach Datum.
- Mehrere Abfuhren am selben Tag — in derselben oder in verschiedenen Zonen —
  sind EIN Termin: nenne sie in einem Satz mit dem Datum genau einmal ("wird
  im Kreis West Papier und im Kreis Ost Karton abgeholt"), nie als zwei
  Erinnerungen.
- Gibt es eine Anmeldefrist, ist sie die wichtigste Angabe. Sie gehoert in den
  Lead, mit Datum UND Uhrzeit. Die Frist kann auf den Erscheinungstag selbst
  fallen — das ist Absicht, damit die Leserin am Morgen noch anmelden kann.
- Nenne die Bereitstellungsregel, wenn eine dasteht — sie ist der Grund, warum
  die Erinnerung einen Tag vorher kommt.
- Gibt es einen Termin der anderen Zone, nenne ihn am Schluss in einem Satz.
- Steht ein Hinweis zur Zone dabei (etwa dass sie eine weitere Gemeinde
  umfasst), nenne ihn in einem Nebensatz.
- Sprich die Leserin sachlich an, ohne Ausrufezeichen und ohne Werbeton.
- Schweizer Rechtschreibung: "ss" statt "ß".

Umfang: Titel (maximal 70 Zeichen), Lead (ein Satz), Text (ein bis zwei kurze
Absaetze, durch Leerzeilen getrennt).

Antworte ausschliesslich mit JSON:
{"titel": "...", "lead": "...", "text": "..."}`

/** One collection day inside a reminder, with everything collected on it. */
export interface Abfuhrtag {
  datumIso: string
  datumText: string
  termine: ErinnerungsTermin[]
}

/**
 * The reminder's Termine by collection day.
 *
 * A newsletter edition can announce several days (a Häckseldienst deadline
 * and a Papier collection), and one day can carry several collections —
 * Altmetall and Sonderabfall in the same municipality, or Papier in Kreis West
 * and Karton in Kreis Ost. The newsroom's rule is that the DAY is the unit
 * the reader acts on: one date, one sentence, everything that goes out.
 */
export function abfuhrtage(termine: readonly ErinnerungsTermin[]): Abfuhrtag[] {
  const nachDatum = new Map<string, ErinnerungsTermin[]>()
  for (const termin of termine) {
    const bisher = nachDatum.get(termin.datumIso)
    if (bisher === undefined) nachDatum.set(termin.datumIso, [termin])
    else bisher.push(termin)
  }

  return [...nachDatum.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([datumIso, liste]) => ({
      datumIso,
      datumText: liste[0]?.datumText ?? datumMitWochentag(datumIso),
      termine: [...liste].sort(
        (a, b) =>
          (a.zone ?? '').localeCompare(b.zone ?? '') ||
          a.kategorie.localeCompare(b.kategorie)
      )
    }))
}

/** The details of one collection, indented under its line where asked. */
function terminDetails(termin: ErinnerungsTermin, einzug: string): string[] {
  const zeilen: string[] = []
  if (termin.anmeldeschlussText !== null) {
    zeilen.push(`${einzug}Anmeldeschluss: ${termin.anmeldeschlussText}`)
  }
  if (termin.anmeldung !== null) {
    zeilen.push(`${einzug}Anmeldung: ${termin.anmeldung}`)
  }
  if (termin.zusatz !== null) {
    zeilen.push(`${einzug}Hinweis zur Zone: ${termin.zusatz}`)
  }
  if (termin.andereZone !== null) {
    zeilen.push(
      `${einzug}Naechster Termin derselben Abfuhr in ${termin.andereZone.zone}: ${termin.andereZone.datumText}`
    )
  }
  return zeilen
}

/**
 * The facts as plain lines — shared by the first write and every revision, so
 * the two cannot drift apart.
 *
 * Rendered per collection DAY, not per collection: a day with one collection
 * keeps the familiar block, a day with several becomes one block that lists
 * them — the shape the text is asked to take.
 */
function faktenZeilen(fakten: ErinnerungsFakten): string[] {
  const zeilen: string[] = [`Gemeinde: ${fakten.gemeinde}`]

  for (const tag of abfuhrtage(fakten.termine)) {
    const [einziger] = tag.termine
    if (tag.termine.length === 1 && einziger !== undefined) {
      zeilen.push('', `Termin: ${einziger.kategorie}`)
      if (einziger.zone !== null) zeilen.push(`Zone: ${einziger.zone}`)
      zeilen.push(`Datum: ${einziger.datumText}`)
      if (einziger.anmeldeschlussText !== null) {
        zeilen.push(`Anmeldeschluss: ${einziger.anmeldeschlussText}`)
      }
      if (einziger.anmeldung !== null) {
        zeilen.push(`Anmeldung: ${einziger.anmeldung}`)
      }
      if (einziger.bereitstellung !== null) {
        zeilen.push(`Bereitstellung: ${einziger.bereitstellung}`)
      }
      if (einziger.zusatz !== null) {
        zeilen.push(`Hinweis zur Zone: ${einziger.zusatz}`)
      }
      if (einziger.andereZone !== null) {
        zeilen.push(
          `Naechster Termin derselben Abfuhr in ${einziger.andereZone.zone}: ${einziger.andereZone.datumText}`
        )
      }
      continue
    }

    zeilen.push(
      '',
      `Abfuhrtag: ${tag.datumText} — ${tag.termine.length} Abfuhren an EINEM Tag, eine Erinnerung`
    )
    const bereitstellungen = new Set(tag.termine.map((t) => t.bereitstellung))
    const gemeinsam =
      bereitstellungen.size === 1 ? (einziger?.bereitstellung ?? null) : null
    for (const termin of tag.termine) {
      zeilen.push(
        `- ${termin.kategorie}${termin.zone === null ? '' : ` (${termin.zone})`}`
      )
      zeilen.push(...terminDetails(termin, '  '))
      if (gemeinsam === null && termin.bereitstellung !== null) {
        zeilen.push(`  Bereitstellung: ${termin.bereitstellung}`)
      }
    }
    if (gemeinsam !== null) zeilen.push(`Bereitstellung: ${gemeinsam}`)
  }

  if (fakten.quellen.length > 0) {
    zeilen.push(
      '',
      `Abfuhrkalender der Gemeinde: ${fakten.quellen.join(' und ')}`
    )
  }

  return zeilen
}

export function buildErinnerungPrompt(
  fakten: ErinnerungsFakten,
  regeln: readonly string[] = []
): string {
  return [
    ...faktenZeilen(fakten),
    ...vorgabenZeilen(regeln),
    '',
    'Schreibe die Erinnerung. Verwende ausschliesslich diese Angaben.'
  ].join('\n')
}

/**
 * A revision: the same facts, the previous text, and what the editor wants
 * different.
 *
 * The system prompt stays byte-identical to the first write — the rules do not
 * change because the editor asked for a revision. The facts are repeated in
 * full so the model rewrites from the source, not from its own prose.
 */
export function buildErinnerungRevision(
  fakten: ErinnerungsFakten,
  bisher: { titel: string | null; lead: string | null; text: string | null },
  anweisung: string,
  regeln: readonly string[] = []
): string {
  return [
    ...faktenZeilen(fakten),
    ...vorgabenZeilen(regeln),
    '',
    'Bisherige Erinnerung:',
    `Titel: ${bisher.titel ?? ''}`,
    `Lead: ${bisher.lead ?? ''}`,
    bisher.text ?? '',
    '',
    'Anweisung der Redaktion:',
    anweisung,
    '',
    'Schreibe die Erinnerung neu. Setze die Anweisung um, aber verwende weiterhin ausschliesslich die Angaben oben.'
  ].join('\n')
}

export interface Erinnerung {
  titel: string
  lead: string
  text: string
}

/** The model's answer is a promise, not a proof — never trust its shape. */
export function parseErinnerung(antwort: unknown): Erinnerung {
  if (typeof antwort !== 'object' || antwort === null) {
    throw new Error('Antwort ist kein Objekt.')
  }
  const roh = antwort as Record<string, unknown>
  const feld = (name: string): string => {
    const wert = roh[name]
    if (typeof wert !== 'string' || wert.trim() === '') {
      throw new Error(`Feld "${name}" fehlt oder ist leer.`)
    }
    return wert.trim()
  }
  return { titel: feld('titel'), lead: feld('lead'), text: feld('text') }
}

/**
 * Relative time references — with the opposite verdict from a match report.
 *
 * `spielbericht.ts` flags "am Freitag" because a match report that says it rots
 * within days. Here that exact phrasing is the required form: the reminder
 * always carries the full date beside it, and the newsletter turns it into
 * "morgen" downstream. What must not appear is the deictic vocabulary —
 * "morgen", "heute", "uebermorgen" — which is precisely the hard list in
 * `zeitbezug.ts`. So that list is reused and the soft one is ignored: "bisher"
 * or "neu" in a two-sentence service text is not a time reference worth a
 * warning.
 */
export function zeitPruefungErinnerung(
  text: string,
  jahr: number
): { bestanden: boolean; hart: string[]; jahrFehlt: boolean } {
  const befund = findeRelativeZeitangaben(text)
  const jahrFehlt = !nenntJahr(text, String(jahr))

  return {
    bestanden: befund.hart.length === 0 && !jahrFehlt,
    hart: befund.hart,
    jahrFehlt
  }
}

export function erinnerungKorrekturHinweis(
  befund: { hart: string[]; jahrFehlt: boolean },
  jahr: number
): string {
  return korrekturHinweis(befund, String(jahr))
}

/**
 * Every number in the reminder must be one we handed over.
 *
 * Dates, times of day and phone numbers are all legitimate — they come out of
 * the calendar. Anything else is the model filling a gap: a container volume it
 * remembers from somewhere, a fee, a house number. Those are the figures a
 * reader would act on and be wrong.
 */
export function zahlWarnungenErinnerung(
  text: string,
  fakten: ErinnerungsFakten
): string[] {
  const erlaubt = new Set<string>([String(fakten.jahr)])

  const sammle = (wert: string | null): void => {
    if (wert === null) return
    for (const treffer of wert.matchAll(/\d+/g)) erlaubt.add(treffer[0])
  }

  /**
   * A date we handed over, in every form it may legitimately be written.
   *
   * The facts spell the month ("14. Dezember 2026"); a text that writes
   * "14.12.2026" says exactly the same thing, and flagging its "12" would train
   * the editor to ignore this check. Both the padded and the bare form count,
   * since either may appear in prose.
   */
  const sammleDatum = (iso: string | null): void => {
    if (iso === null) return
    const [jahr, monat, tag] = iso.split('-')
    for (const teil of [jahr, monat, tag]) {
      if (teil === undefined) continue
      erlaubt.add(teil)
      erlaubt.add(String(Number(teil)))
    }
  }

  for (const termin of fakten.termine) {
    sammle(termin.datumText)
    sammleDatum(termin.datumIso)
    sammle(termin.anmeldeschlussText)
    sammleDatum(termin.anmeldeschlussIso)
    sammle(termin.bereitstellung)
    sammle(termin.anmeldung)
    sammle(termin.kategorie)
    sammle(termin.zone)
    sammle(termin.zusatz)
    if (termin.andereZone !== null) {
      sammle(termin.andereZone.datumText)
      sammleDatum(termin.andereZone.datumIso)
      sammle(termin.andereZone.zone)
    }
  }
  for (const quelle of fakten.quellen) sammle(quelle)

  const gefunden = [...text.matchAll(/\d+/g)].map((treffer) => treffer[0])
  return [...new Set(gefunden.filter((zahl) => !erlaubt.has(zahl)))].map(
    (zahl) => `Zahl "${zahl}" steht nicht in den Angaben.`
  )
}

/** The provenance stored with the Meldung — one pure mapping, as everywhere. */
export function datengrundlageErinnerung(
  fakten: ErinnerungsFakten
): Record<string, unknown> {
  return {
    quelle: 'abfuhrkalender',
    gemeinde: fakten.gemeinde,
    jahr: fakten.jahr,
    erscheint_am: fakten.erscheintAm,
    quellen: fakten.quellen,
    termine: fakten.termine.map((termin) => ({
      kategorie: termin.kategorie,
      zone: termin.zone,
      datum: termin.datumText,
      anmeldeschluss: termin.anmeldeschlussText,
      bereitstellung: termin.bereitstellung,
      andere_zone: termin.andereZone
    }))
  }
}

/** Only for the log line: how far ahead of the event the edition appears. */
export function vorlaufTage(erscheintAm: string, datum: string): number {
  return (
    (Date.parse(`${datum}T00:00:00Z`) -
      Date.parse(`${erscheintAm}T00:00:00Z`)) /
    86_400_000
  )
}

/** Re-exported so callers need one import for the planning vocabulary. */
export { erscheinungstag, wochentag }
