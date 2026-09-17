import { tagDeutsch, type Monatsblatt, type Tag } from '../shared/euroairport'
import { monatDeutsch, type GespeicherterMonat } from './suedanfluglauf'
import { vorgabenZeilen } from './lernen'
import { zahlWarnung } from './warnungen'

export {
  linkWarnungen,
  zeitWarnungen,
  parseMeldungstext as parseSuedanflugmeldung
} from './spielbericht'

// The south-approach quota as the newsroom judges it — and it judges only.
//
// Nothing in this module writes an article, and nothing in it calls a model.
// An exceeded threshold produces a PROPOSAL on the month's row; whether that
// becomes a Meldung is a person's decision, exactly as on the four desks that
// came before. That is the rule of the house and it holds for a figure that
// speaks for itself too.
//
// **The quota belongs to the airport, not to a municipality.** The source has
// no breakdown by place and there is none to be had: runway 33 is approached
// over the south, and who lies under that approach is editorial knowledge
// (`gemeinden.suedanflug`), not a column. Every sentence written from these
// figures has to keep that straight, which is why there is a check for it
// further down and not only a line in the prompt.

/** The thresholds, as the source row carries them. */
export interface Schwellen {
  /** The newsroom's own, in percent of a month. Jolanda's word: 40. */
  monatsschwelle: number
  /**
   * The runway-use agreement of 10 February 2006, over the year: above 8
   * percent the federal office looks into the causes, above 10 measures have
   * to be examined. These are the AUTHORITY's numbers, and an article that
   * uses them says whose they are.
   */
  jahresschwellen: number[]
}

export const STANDARD_SCHWELLEN: Schwellen = {
  monatsschwelle: 40,
  jahresschwellen: [8, 10]
}

/**
 * The two marks the DAY counts are taken at, in percent.
 *
 * Not configurable and deliberately not: they are a description of the month's
 * shape («an 21 der 31 Tage lag der Anteil ueber 30 Prozent»), not a trigger,
 * and a sentence written from them names them. They are constants here so the
 * number check knows they are handed material rather than the model's
 * arithmetic.
 */
export const TAGESSCHWELLEN = [30, 50] as const

function istZahl(wert: unknown): wert is number {
  return typeof wert === 'number' && Number.isFinite(wert)
}

/**
 * The thresholds out of `quellen.konfiguration`.
 *
 * They live in the row rather than in the code or the prompt, so the newsroom
 * can move its own threshold without a deploy. Anything unreadable falls back
 * to the default per FIELD rather than wholesale: a typo in one number must
 * not quietly restore the other.
 */
export function leseSchwellen(konfiguration: unknown): Schwellen {
  if (typeof konfiguration !== 'object' || konfiguration === null) {
    return STANDARD_SCHWELLEN
  }
  const roh = konfiguration as Record<string, unknown>

  const monatsschwelle = istZahl(roh['monatsschwelle'])
    ? roh['monatsschwelle']
    : STANDARD_SCHWELLEN.monatsschwelle

  const jahresRoh = roh['jahresschwellen']
  const jahresschwellen = Array.isArray(jahresRoh)
    ? jahresRoh.filter(istZahl)
    : STANDARD_SCHWELLEN.jahresschwellen

  return {
    monatsschwelle,
    jahresschwellen:
      jahresschwellen.length === 0
        ? STANDARD_SCHWELLEN.jahresschwellen
        : jahresschwellen
  }
}

/** A month the newsroom already holds, for comparison. */
export interface Nachbarmonat {
  jahr: number
  monat: number
  quote: number | null
}

/** The day with the highest share, as the facts hand it over. */
export interface Spitzentag {
  datum: string
  anfluege: number
  suedlandungen: number
  quote: number
}

export interface Bewertung {
  /** True when this month is worth a look. A proposal, never an article. */
  vorschlag: boolean
  /** German, for the row — null when there is nothing to propose. */
  begruendung: string | null
  /** Every threshold this month's figures stand above — the STATE. */
  ueberschritten: string[]
  /**
   * The thresholds this month actually CROSSED — the news.
   *
   * The distinction is measured, not tidy. The canton's south-approach year
   * has run above 10 percent every year the Schutzverband published (2022:
   * 11,48; 2023: 13,79; 2024: 13,42), so "the year is above 8 percent" is true
   * from about February onwards and a proposal built on it would fire every
   * month for ever — which is the same as never firing. What is news is the
   * month the year's figure passes the mark. The newsroom's own monthly
   * threshold is different: 43,7 percent in July is news whether or not June
   * was 41, so exceeding that one always proposes.
   */
  neuUeberschritten: string[]
  jahresAnfluege: number
  jahresSuedlandungen: number
  jahresquote: number | null
  /**
   * How many months of that year the figure above covers.
   *
   * Complete or declared: a year quota from three of twelve months is a
   * partial year, and whoever writes from it has to be able to say so.
   */
  jahresmonate: number
  vormonat: Nachbarmonat | null
  vorjahresmonat: Nachbarmonat | null
  tageUeber30: number
  tageUeber50: number
  hoechsterTag: Spitzentag | null
}

function quoteAus(teil: number, ganzes: number): number | null {
  if (ganzes === 0) return null
  return Math.round((teil / ganzes) * 1000) / 10
}

function alsDeutsch(zahl: number): string {
  return String(zahl).replace('.', ',')
}

/** A day's share as the sheet printed it, or as the two counts give it. */
function tagesquote(tag: Tag): number {
  return tag.quote ?? quoteAus(tag.suedlandungen, tag.anfluege) ?? 0
}

function nachbar(monat: GespeicherterMonat): Nachbarmonat {
  return { jahr: monat.jahr, monat: monat.monat, quote: monat.quote }
}

/**
 * What this month says, measured against the thresholds and its neighbours.
 *
 * `bestand` is every month already stored — that is what supplies the
 * year-to-date figure, the previous month and the same month a year ago. The
 * sheet being judged replaces its own stored row in that sum, so re-reading a
 * revised month does not count it twice.
 *
 * It judges; it does not write. There is no model call anywhere near it.
 */
export function bewerteMonat(
  blatt: Monatsblatt,
  bestand: readonly GespeicherterMonat[],
  schwellen: Schwellen
): Bewertung {
  const eigenesJahr = bestand.filter(
    (monat) => monat.jahr === blatt.jahr && monat.monat !== blatt.monat
  )

  const jahresAnfluege =
    blatt.anfluege +
    eigenesJahr.reduce((summe, monat) => summe + (monat.anfluege ?? 0), 0)
  const jahresSuedlandungen =
    blatt.suedlandungen +
    eigenesJahr.reduce((summe, monat) => summe + (monat.suedlandungen ?? 0), 0)
  const jahresquote = quoteAus(jahresSuedlandungen, jahresAnfluege)

  const vorherigerMonat = blatt.monat === 1 ? 12 : blatt.monat - 1
  const vorherigesJahr = blatt.monat === 1 ? blatt.jahr - 1 : blatt.jahr

  const vormonat =
    bestand.find(
      (monat) =>
        monat.jahr === vorherigesJahr && monat.monat === vorherigerMonat
    ) ?? null
  const vorjahresmonat =
    bestand.find(
      (monat) => monat.jahr === blatt.jahr - 1 && monat.monat === blatt.monat
    ) ?? null

  const [niedrig, hoch] = TAGESSCHWELLEN
  const tageUeber30 = blatt.tage.filter(
    (tag) => tagesquote(tag) > niedrig
  ).length
  const tageUeber50 = blatt.tage.filter((tag) => tagesquote(tag) > hoch).length

  let hoechsterTag: Spitzentag | null = null
  for (const tag of blatt.tage) {
    const quote = tagesquote(tag)
    if (hoechsterTag !== null && quote <= hoechsterTag.quote) continue
    hoechsterTag = {
      datum: tag.datum,
      anfluege: tag.anfluege,
      suedlandungen: tag.suedlandungen,
      quote
    }
  }

  // The year as it stood BEFORE this month — what says whether a year
  // threshold was crossed now or was standing above it all along.
  const vorherAnfluege = jahresAnfluege - blatt.anfluege
  const vorherSued = jahresSuedlandungen - blatt.suedlandungen
  const jahresquoteVorher = quoteAus(vorherSued, vorherAnfluege)

  const ueberschritten: string[] = []
  const neuUeberschritten: string[] = []

  const monatText = `Monatsschwelle der Redaktion: ${alsDeutsch(schwellen.monatsschwelle)} Prozent`
  if (blatt.quote !== null && blatt.quote >= schwellen.monatsschwelle) {
    ueberschritten.push(monatText)
    neuUeberschritten.push(monatText)
  }

  for (const schwelle of [...schwellen.jahresschwellen].sort((a, b) => a - b)) {
    if (jahresquote === null || jahresquote < schwelle) continue
    const text = `Jahresschwelle der Pistenbenutzungsvereinbarung: ${alsDeutsch(schwelle)} Prozent`
    ueberschritten.push(text)
    // A year with no earlier month held has crossed everything it stands
    // above — there was no state to be above it before.
    if (jahresquoteVorher === null || jahresquoteVorher < schwelle) {
      neuUeberschritten.push(text)
    }
  }

  return {
    vorschlag: neuUeberschritten.length > 0,
    begruendung:
      neuUeberschritten.length === 0
        ? null
        : begruendungFuer(blatt, jahresquote, neuUeberschritten),
    ueberschritten,
    neuUeberschritten,
    jahresAnfluege,
    jahresSuedlandungen,
    jahresquote,
    jahresmonate: eigenesJahr.length + 1,
    vormonat: vormonat === null ? null : nachbar(vormonat),
    vorjahresmonat: vorjahresmonat === null ? null : nachbar(vorjahresmonat),
    tageUeber30,
    tageUeber50,
    hoechsterTag
  }
}

/** The sentence on the row — what the editor reads before deciding. */
function begruendungFuer(
  blatt: Monatsblatt,
  jahresquote: number | null,
  ueberschritten: readonly string[]
): string {
  const monatText =
    blatt.quote === null
      ? 'ohne gedruckte Quote'
      : `${alsDeutsch(blatt.quote)} Prozent`
  const jahrText =
    jahresquote === null
      ? ''
      : ` Im Jahr bisher ${alsDeutsch(jahresquote)} Prozent.`

  return (
    `${monatDeutsch(blatt.jahr, blatt.monat)}: ${monatText} der Landungen ` +
    `erfolgten ueber den Sueden.${jahrText} ` +
    `Ueberschritten: ${ueberschritten.join('; ')}.`
  )
}

// ---------------------------------------------------------------------------
// The Meldung — one model call per municipality, and the checks beside it
// ---------------------------------------------------------------------------

/** Everything one article may talk about, with nothing left to derive. */
export interface SuedanflugFakten {
  gemeinde: string
  jahr: number
  monat: number
  /** "Juli 2026" — rendered here so the model never formats a date. */
  monatText: string
  anfluege: number
  suedlandungen: number
  quote: number | null
  /** "4. August 2026", or null when the sheet does not say. */
  aktualisiertAmText: string | null
  /** The same date as `YYYY-MM-DD` — never shown, only allowed. */
  aktualisiertAmIso: string | null
  provisorisch: boolean
  /** The address of THIS month's PDF. The one link the article carries. */
  quelleUrl: string
  schwellen: Schwellen
  bewertung: Bewertung
  /** Where the sheet contradicts itself — stated, never quietly dropped. */
  befunde: string[]
}

export function suedanflugFakten(eingabe: {
  blatt: Monatsblatt
  gemeinde: string
  quelleUrl: string
  bewertung: Bewertung
  schwellen: Schwellen
}): SuedanflugFakten {
  const { blatt } = eingabe
  return {
    gemeinde: eingabe.gemeinde,
    jahr: blatt.jahr,
    monat: blatt.monat,
    monatText: monatDeutsch(blatt.jahr, blatt.monat),
    anfluege: blatt.anfluege,
    suedlandungen: blatt.suedlandungen,
    quote: blatt.quote,
    aktualisiertAmText:
      blatt.aktualisiert_am === null ? null : tagDeutsch(blatt.aktualisiert_am),
    aktualisiertAmIso: blatt.aktualisiert_am,
    provisorisch: blatt.provisorisch,
    quelleUrl: eingabe.quelleUrl,
    schwellen: eingabe.schwellen,
    bewertung: eingabe.bewertung,
    befunde: blatt.befunde
  }
}

export const SUEDANFLUG_SYSTEM_PROMPT = `Du schreibst fuer eine lokale Redaktion in der Region Basel kurze Meldungen ueber die Suedanflug-Quote des EuroAirport.

Worum es geht: der Flughafen veroeffentlicht je Monat, wie viele der Anfluege
ueber den Sueden gefuehrt wurden, also ueber die Piste 33. Das ist in den
Gemeinden unter der Anflugschneise ein Dauerthema.

DIE WICHTIGSTE REGEL, ohne Ausnahme:
Die Quote gilt fuer den FLUGHAFEN, nicht fuer die Gemeinde. Der Flughafen
erhebt sie nicht je Gemeinde, und es gibt keine Zahl fuer eine einzelne
Gemeinde. Falsch ist darum jeder Satz der Form "in <Gemeinde> lag die Quote
bei X Prozent", "<Gemeinde>s Suedanflugquote" oder "die Quote fuer
<Gemeinde>". Richtig ist: "X Prozent aller Landungen erfolgten ueber den
Sueden, also ueber <Gemeinde>."

Weitere Regeln:
- Schreibe NUR, was in den Angaben steht. Rechne nichts aus, was nicht
  dasteht, und erfinde keine Laermwerte, keine Beschwerdezahlen und keine
  Aussagen von Behoerden oder Anwohnerinnen.
- Der Text muss sagen, dass die Zahl vom EuroAirport stammt.
- Der Text muss sagen, dass die Zahl PROVISORISCH ist und dass der
  EuroAirport einzelne Monate nachtraeglich korrigiert. Das ist keine
  Floskel: eine heute richtige Meldung kann dadurch spaeter falsch werden.
- Nenne jedes Datum absolut und mit Jahr ("im Juli 2026", "am 20. Juli
  2026"). Schreibe NIEMALS "letzten Monat", "dieses Jahr", "kuerzlich" oder
  "morgen" — der Text muss auch in fuenf Jahren noch stimmen.
- Schreibe keine Adresse und keinen Link. Die Quellenzeile setzt die
  Redaktion selbst darunter.
- Nenne bei einer Jahresquote, ueber wie viele Monate sie geht.
- Steht bei den Angaben ein Befund, dass das Blatt sich selbst widerspricht,
  verschweige ihn nicht.
- Unterscheide die Schwellen: 40 Prozent im Monat ist die Schwelle der
  Redaktion, 8 und 10 Prozent im Jahr sind die der
  Pistenbenutzungsvereinbarung von 2006. Sage jeweils, wessen Schwelle es ist.
- Sachlich, ohne Ausrufezeichen, ohne Dramatisierung.
- Schweizer Rechtschreibung: "ss" statt "ß".

Umfang: Titel (maximal 70 Zeichen), Lead (ein Satz), Text (zwei bis drei
kurze Absaetze, durch Leerzeilen getrennt).

Antworte ausschliesslich mit JSON:
{"titel": "...", "lead": "...", "text": "..."}`

function faktenZeilen(fakten: SuedanflugFakten): string[] {
  const b = fakten.bewertung
  const zeilen: string[] = [
    `Gemeinde: ${fakten.gemeinde} (liegt unter der Anflugschneise der Piste 33)`,
    `Monat: ${fakten.monatText}`,
    `Anfluege im Monat: ${fakten.anfluege}`,
    `Davon ueber den Sueden: ${fakten.suedlandungen}`,
    `Quote des Monats: ${fakten.quote === null ? 'nicht gedruckt' : `${alsDeutsch(fakten.quote)} Prozent`}`
  ]

  if (fakten.aktualisiertAmText !== null) {
    zeilen.push(`Stand des Blatts: ${fakten.aktualisiertAmText}`)
  }
  if (fakten.provisorisch) {
    zeilen.push(
      'Das Blatt bezeichnet seine Zahlen selbst als provisorisch; der EuroAirport korrigiert einzelne Monate nachtraeglich.'
    )
  }

  if (b.jahresquote !== null) {
    // The month count is not decoration: a year figure over three of twelve
    // months is a partial year, and the text has to be able to say so.
    zeilen.push(
      `Jahresquote ${fakten.jahr} ueber ${b.jahresmonate} ${b.jahresmonate === 1 ? 'Monat' : 'Monate'}: ` +
        `${alsDeutsch(b.jahresquote)} Prozent (${b.jahresSuedlandungen} von ${b.jahresAnfluege} Landungen)`
    )
  }
  if (b.vormonat !== null && b.vormonat.quote !== null) {
    zeilen.push(
      `Vormonat (${monatDeutsch(b.vormonat.jahr, b.vormonat.monat)}): ${alsDeutsch(b.vormonat.quote)} Prozent`
    )
  }
  if (b.vorjahresmonat !== null && b.vorjahresmonat.quote !== null) {
    zeilen.push(
      `Gleicher Monat im Vorjahr (${monatDeutsch(b.vorjahresmonat.jahr, b.vorjahresmonat.monat)}): ` +
        `${alsDeutsch(b.vorjahresmonat.quote)} Prozent`
    )
  }

  zeilen.push(
    `Tage mit mehr als ${TAGESSCHWELLEN[0]} Prozent: ${b.tageUeber30}`,
    `Tage mit mehr als ${TAGESSCHWELLEN[1]} Prozent: ${b.tageUeber50}`
  )
  if (b.hoechsterTag !== null) {
    zeilen.push(
      `Hoechster Tag: ${tagDeutsch(b.hoechsterTag.datum)}, ` +
        `${b.hoechsterTag.suedlandungen} von ${b.hoechsterTag.anfluege} Landungen ` +
        `(${alsDeutsch(b.hoechsterTag.quote)} Prozent)`
    )
  }

  if (b.ueberschritten.length > 0) {
    zeilen.push('', 'Ueberschrittene Schwellen:')
    for (const schwelle of b.ueberschritten) zeilen.push(`- ${schwelle}`)
  }

  if (fakten.befunde.length > 0) {
    zeilen.push('', 'Befunde zum Blatt (die Quelle widerspricht sich):')
    for (const befund of fakten.befunde) zeilen.push(`- ${befund}`)
  }

  return zeilen
}

export function buildSuedanflugPrompt(
  fakten: SuedanflugFakten,
  regeln: readonly string[] = []
): string {
  return [
    ...faktenZeilen(fakten),
    ...vorgabenZeilen(regeln),
    '',
    'Schreibe die Meldung. Verwende ausschliesslich diese Angaben.'
  ].join('\n')
}

export function buildSuedanflugRevision(
  fakten: SuedanflugFakten,
  bisher: { titel: string | null; lead: string | null; text: string | null },
  anweisung: string,
  regeln: readonly string[] = []
): string {
  return [
    ...faktenZeilen(fakten),
    ...vorgabenZeilen(regeln),
    '',
    'Bisherige Meldung:',
    `Titel: ${bisher.titel ?? ''}`,
    `Lead: ${bisher.lead ?? ''}`,
    bisher.text ?? '',
    '',
    'Anweisung der Redaktion:',
    anweisung,
    '',
    'Schreibe die Meldung neu. Setze die Anweisung um, aber verwende weiterhin ausschliesslich die Angaben oben.'
  ].join('\n')
}

/**
 * The source line, appended by code — never left to the model.
 *
 * One address and only one: this month's PDF. That the figure is provisional
 * is part of the line too, so a reader who only skims the bottom still sees
 * it.
 */
export function quelleZeile(fakten: SuedanflugFakten): string {
  const stand = fakten.provisorisch ? ' (provisorisch)' : ''
  return (
    `Quelle: EuroAirport, ILS-33-Nutzungsstatistik ${fakten.monatText}` +
    `${stand}, ${fakten.quelleUrl}`
  )
}

export function mitQuelle(text: string, fakten: SuedanflugFakten): string {
  return `${text.trim()}\n\n${quelleZeile(fakten)}`
}

/** The line `mitQuelle` appended, taken off again before a revision. */
const QUELLENZEILE = /\n{2,}Quelle: [^\n]*$/

export function ohneQuelle(text: string | null): string | null {
  if (text === null) return null
  return text.replace(QUELLENZEILE, '').trimEnd()
}

// ---------------------------------------------------------------------------
// The checks — a prompt is a request, a check is a rule
// ---------------------------------------------------------------------------

/** How a German sentence names the airport. */
const FLUGHAFEN = /euro\s?airport|flughafen\s+basel|\bEAP\b/i

/**
 * Whether the text names the EuroAirport as the source of the figure.
 *
 * Reported and retried once. A figure about aircraft over a village, printed
 * without saying whose count it is, reads as the newsroom's own measurement —
 * which it is not, and which nobody here could make.
 */
export function suedanflugAttributionsWarnung(
  text: string,
  _fakten: Pick<SuedanflugFakten, 'gemeinde'>
): string | null {
  if (FLUGHAFEN.test(text.normalize('NFC'))) return null
  return 'Die Meldung nennt den EuroAirport nicht als Quelle der Zahl.'
}

/** A figure word — what makes a sentence a claim about the quota. */
const ZAHLWORT = /\d+([.,]\d+)?\s*prozent|\bquote\b|\banteil\b|\bprozent\b/i

/**
 * The constructions that bind the figure to the PLACE.
 *
 * This is the check the newsroom cares about most, and the reason it is a
 * check and not only a line in the prompt: the sentence «in Binningen lag die
 * Quote bei 43,7 Prozent» is fluent, plausible and false, and no reader can
 * tell. The airport measures its own approaches; it does not measure
 * Binningen. Three shapes are caught — the locative («in X»), the dative of
 * purpose («fuer X», «von X») and the genitive («Xs Quote») — and only inside
 * a sentence that also carries a figure, so «In Binningen ist der Fluglaerm
 * ein Thema» stays what it is.
 *
 * The correct form, «… erfolgten ueber den Sueden, also ueber Binningen»,
 * uses none of them. The check catches what the prompt forbids, not every
 * possible phrasing — an editor still reads the text.
 */
function ortsbindung(gemeinde: string): RegExp {
  const g = gemeinde.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(
    [
      `\\bin\\s+${g}\\b`,
      `\\b(?:f(?:ü|ue)r|von)\\s+${g}\\b`,
      `\\b${g}s\\b`
    ].join('|'),
    'i'
  )
}

/** Sentences, roughly — enough to judge one claim at a time. */
function saetze(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((satz) => satz.trim())
    .filter((satz) => satz !== '')
}

export function ortsWarnungen(
  text: string,
  fakten: Pick<SuedanflugFakten, 'gemeinde'>
): string[] {
  const muster = ortsbindung(fakten.gemeinde)
  const warnungen: string[] = []

  for (const satz of saetze(text.normalize('NFC'))) {
    if (!ZAHLWORT.test(satz)) continue
    if (!muster.test(satz)) continue
    warnungen.push(
      `Die Quote gilt fuer den Flughafen, nicht fuer ${fakten.gemeinde}. ` +
        `Dieser Satz schreibt sie der Gemeinde zu: «${satz}»`
    )
  }

  return warnungen
}

/** The word families the provisional statement is made of. */
const PROVISORISCH = /provisorisch|vorl(?:ä|ae)ufig/i
const NACHTRAEGLICH =
  /nachtr(?:ä|ae)glich|korrigier|revidier|angepasst|nachgef(?:ü|ue)hrt|sp(?:ä|ae)ter\s+(?:noch\s+)?(?:ge)?(?:ändern|aendern)/i

/**
 * Whether the text says the figure is provisional AND that the airport
 * corrects months afterwards.
 *
 * Both halves, because either alone misleads. "Provisional" without the
 * correction reads as a formality; "the airport corrects months" without
 * "provisional" leaves the reader thinking this one is final. The sheet for
 * December 2025 still said «Provisorische Zahlen» on 30 January 2026 — that is
 * what this is about.
 *
 * Silent for a sheet that does not call itself provisional. None has yet.
 */
export function provisorikWarnung(
  text: string,
  fakten: Pick<SuedanflugFakten, 'provisorisch'>
): string | null {
  if (!fakten.provisorisch) return null
  const gelesen = text.normalize('NFC')

  const hatProvisorisch = PROVISORISCH.test(gelesen)
  const hatNachtraeglich = NACHTRAEGLICH.test(gelesen)
  if (hatProvisorisch && hatNachtraeglich) return null

  if (!hatProvisorisch) {
    return (
      'Die Meldung sagt nicht, dass die Zahl provisorisch ist und dass der ' +
      'EuroAirport einzelne Monate nachtraeglich korrigiert.'
    )
  }
  return (
    'Die Meldung nennt die Zahl provisorisch, sagt aber nicht, dass der ' +
    'EuroAirport einzelne Monate nachtraeglich korrigiert.'
  )
}

/**
 * Every number in the text must be one we handed over.
 *
 * Run BEFORE `mitQuelle` appends the address, whose digits are nobody's
 * claim. The allowance is exactly the facts block: the two counts, the
 * printed quota, the year figure and its month count, the neighbours, the day
 * counts, the peak day with its full date, the thresholds, and the sheet's own
 * findings — nothing else. A noise level or a number of complaints has no
 * source here at all, and that is the figure a reader would act on.
 */
export function zahlWarnungenSuedanflug(
  text: string,
  fakten: SuedanflugFakten
): string[] {
  const erlaubt = new Set<string>()

  const sammle = (wert: string | number | null): void => {
    if (wert === null) return
    for (const treffer of String(wert).matchAll(/\d+/g)) {
      erlaubt.add(treffer[0])
      // "07" in an ISO date is spoken as "7" in prose.
      erlaubt.add(String(Number(treffer[0])))
    }
  }

  const b = fakten.bewertung
  sammle(fakten.jahr)
  sammle(fakten.monat)
  sammle(fakten.monatText)
  sammle(fakten.anfluege)
  sammle(fakten.suedlandungen)
  sammle(fakten.quote)
  sammle(fakten.aktualisiertAmText)
  sammle(fakten.aktualisiertAmIso)
  sammle(b.jahresAnfluege)
  sammle(b.jahresSuedlandungen)
  sammle(b.jahresquote)
  sammle(b.jahresmonate)
  sammle(b.tageUeber30)
  sammle(b.tageUeber50)
  // The two marks the day counts are taken at: handed over in the facts as
  // words, so the sentence that quotes them back is not inventing anything.
  for (const marke of TAGESSCHWELLEN) sammle(marke)
  sammle(fakten.schwellen.monatsschwelle)
  for (const schwelle of fakten.schwellen.jahresschwellen) sammle(schwelle)
  for (const nachbarmonat of [b.vormonat, b.vorjahresmonat]) {
    if (nachbarmonat === null) continue
    sammle(nachbarmonat.jahr)
    sammle(nachbarmonat.monat)
    sammle(nachbarmonat.quote)
  }
  if (b.hoechsterTag !== null) {
    sammle(b.hoechsterTag.anfluege)
    sammle(b.hoechsterTag.suedlandungen)
    sammle(b.hoechsterTag.quote)
    // The date written out in full is handed material, not arithmetic — the
    // same lesson the match report learned on 15 September 2026.
    sammle(b.hoechsterTag.datum)
  }
  for (const befund of fakten.befunde) sammle(befund)
  for (const schwelle of b.ueberschritten) sammle(schwelle)

  const gefunden = [...text.matchAll(/\d+/g)].map((treffer) => treffer[0])
  return [...new Set(gefunden.filter((zahl) => !erlaubt.has(zahl)))].map(
    (zahl) => zahlWarnung(zahl)
  )
}

/** The provenance stored with the Meldung — one pure mapping, as everywhere. */
export function datengrundlageSuedanflug(
  fakten: SuedanflugFakten
): Record<string, unknown> {
  return {
    quelle: 'euroairport',
    quelle_name: 'EuroAirport',
    url: fakten.quelleUrl,
    gemeinde: fakten.gemeinde,
    jahr: fakten.jahr,
    monat: fakten.monat,
    anfluege: fakten.anfluege,
    suedlandungen: fakten.suedlandungen,
    quote: fakten.quote,
    provisorisch: fakten.provisorisch,
    aktualisiert_am: fakten.aktualisiertAmIso,
    jahresquote: fakten.bewertung.jahresquote,
    jahresmonate: fakten.bewertung.jahresmonate,
    ueberschritten: fakten.bewertung.ueberschritten,
    befunde: fakten.befunde
  }
}
