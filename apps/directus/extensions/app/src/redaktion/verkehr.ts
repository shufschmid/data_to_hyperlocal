// The Verkehr desk's two writers — the prompt AND the checks next to it, the
// division of labour of every desk in this house. Nothing in here fetches,
// nothing stores; the facts arrive computed by code over the whole sheet,
// and every figure in the article is measured against them afterwards.
//
// Two sources, two kinds of article:
//
// 1. A new speed-camera location of the Polizei Basel-Landschaft in a covered
//    municipality (`radarstandorte`). The newsroom's rule of 11 October 2026:
//    the Meldung matters when an installation is recognised at a NEW location
//    in the municipality. It goes out as a `kanton` article — the police
//    speaking about a place in the municipality — with the public page as its
//    source, never the PDF behind the data door.
//
// 2. A month of the Gemeindepolizei Reinach's speed controls
//    (`geschwindigkeitskontrollen`): how many controls and vehicles, how many
//    violations, where most, and the fastest vehicle with where and when. A
//    `gemeinde` article — the municipality publishes it on its own site —
//    with the month's PDF as its source.

import {
  monatDeutsch,
  type AnlageArt,
  type Messung,
  type Zusammenfassung
} from '../shared/verkehr'
import { datumDeutsch } from './amtsblatt'
import { vorgabenZeilen } from './lernen'
import { zahlWarnung } from './warnungen'

export {
  linkWarnungen,
  zeitWarnungen,
  parseMeldungstext as parseVerkehrsmeldung
} from './spielbericht'

// ---------------------------------------------------------------------------
// 1. A new radar location
// ---------------------------------------------------------------------------

export interface RadarFakten {
  gemeinde: string
  art: AnlageArt
  kennung: string | null
  abWann: string | null
  standort: string
  plz: string | null
  ort: string | null
  strasse: string | null
  geschwindigkeit: number | null
  oertlichkeit: string | null
  publiziertAm: string | null
  /** The other installations the sheet lists in the same municipality — handed, never counted by the model. */
  weitereInGemeinde: ReadonlyArray<{
    standort: string
    art: AnlageArt
    abWann: string | null
  }>
  /** The public page on baselland.ch — what the article links. */
  seiteUrl: string
}

export const POLIZEI_BL = 'Polizei Basel-Landschaft'

/**
 * The answer's shape for both writers, enforced by the API — the sport desk
 * lost three of four reports to a missing closing brace on 11 October 2026,
 * and `extractJson` is a heuristic this house was told not to rely on.
 */
export const MELDUNG_SCHEMA = {
  type: 'object',
  properties: {
    titel: { type: 'string' },
    lead: { type: 'string' },
    text: { type: 'string' }
  },
  required: ['titel', 'lead', 'text'],
  additionalProperties: false
} as const

export const RADAR_SYSTEM_PROMPT = `Du schreibst fuer eine lokale Redaktion in der Region Basel kurze Meldungen ueber neue Standorte von Geschwindigkeitskontrollanlagen.

Worum es geht: Die Polizei Basel-Landschaft veroeffentlicht die Standorte
ihrer automatischen Messanlagen. Eine SEMISTATIONAERE Anlage ist ein
verschiebbarer Blitzer, den die Polizei fuer eine Weile an einen Ort stellt;
eine STATIONAERE Anlage ist fest installiert. Die Meldung sagt den Menschen
in der Gemeinde, wo ab wann gemessen wird.

Regeln, ohne Ausnahme:
- Schreibe NUR, was in den Angaben steht. Erfinde keine Bussen, keine
  Begruendungen, keine Unfallzahlen und keine Aussagen von Behoerden.
- Der Text muss sagen, dass die Angabe von der Polizei Basel-Landschaft
  stammt ("wie die Polizei Basel-Landschaft mitteilt").
- Nenne Strasse, signalisierte Höchstgeschwindigkeit und, wo angegeben, die
  Örtlichkeit und den Tag, ab dem gemessen wird.
- Nenne jedes Datum absolut und mit Jahr ("ab dem 18. September 2026").
  Schreibe NIEMALS "seit kurzem", "diese Woche", "neu seit letzter Woche" —
  der Text muss auch in fuenf Jahren noch stimmen.
- Die Polizei garantiert die Aktualitaet ihrer Liste nicht und versetzt
  Anlagen zwischen den Publikationen; sag das in einem Satz.
- Schreibe keine Adresse und keinen Link. Die Quellenzeile setzt die
  Redaktion selbst darunter.
- Sachlich, ohne Ausrufezeichen, ohne Mahnung an die Fahrenden.
- Schweizer Rechtschreibung: "ss" statt "ß". Umlaute als ä, ö, ü — nie als
  ae, oe, ue ("Höchstgeschwindigkeit", "semistationäre Anlage").

Umfang: Titel (maximal 70 Zeichen), Lead (ein Satz), Text (ein bis zwei
kurze Absaetze, durch eine Leerzeile getrennt).

Antworte ausschliesslich mit JSON:
{"titel": "...", "lead": "...", "text": "..."}`

function artText(art: AnlageArt): string {
  // Real umlauts here, deliberately: these words are copied into the article,
  // and the first live draft (11 October 2026) carried «semistationaere» and
  // «Hoechstgeschwindigkeit» straight out of the facts.
  return art === 'semistationaer'
    ? 'semistationäre Anlage (verschiebbar)'
    : 'stationäre Anlage (fest installiert)'
}

function radarZeilen(fakten: RadarFakten): string[] {
  const zeilen: string[] = [
    `Gemeinde: ${fakten.gemeinde}`,
    `Art: ${artText(fakten.art)}${fakten.kennung === null ? '' : `, Kennung ${fakten.kennung}`}`,
    `Standort laut Polizei: ${fakten.standort}`,
    fakten.strasse === null ? null : `Strasse: ${fakten.strasse}`,
    fakten.geschwindigkeit === null
      ? 'Signalisierte Höchstgeschwindigkeit: nicht angegeben'
      : `Signalisierte Höchstgeschwindigkeit: ${fakten.geschwindigkeit} km/h`,
    fakten.oertlichkeit === null ? null : `Örtlichkeit: ${fakten.oertlichkeit}`,
    fakten.abWann === null
      ? 'Ab wann: nicht angegeben (stationäre Anlagen tragen kein Datum)'
      : `In Betrieb ab: ${datumDeutsch(fakten.abWann)}`,
    fakten.publiziertAm === null
      ? null
      : `Stand der Standortliste der Polizei: ${datumDeutsch(fakten.publiziertAm)}`
  ].filter((z): z is string => z !== null)

  if (fakten.weitereInGemeinde.length > 0) {
    zeilen.push(
      '',
      `Weitere Anlagen der Polizei Basel-Landschaft in ${fakten.gemeinde} laut derselben Liste (${fakten.weitereInGemeinde.length}):`
    )
    for (const w of fakten.weitereInGemeinde) {
      zeilen.push(
        `- ${w.standort} (${artText(w.art)}${w.abWann === null ? '' : `, ab ${datumDeutsch(w.abWann)}`})`
      )
    }
  } else {
    zeilen.push(
      '',
      `Die Liste nennt in ${fakten.gemeinde} keine weitere Anlage der Polizei Basel-Landschaft. Kontrollen auf Gemeindestrassen durch die Gemeinde selbst stehen nicht auf dieser Liste.`
    )
  }
  return zeilen
}

export function buildRadarPrompt(
  fakten: RadarFakten,
  regeln: readonly string[] = []
): string {
  return [
    ...radarZeilen(fakten),
    ...vorgabenZeilen(regeln),
    '',
    'Schreibe die Meldung. Verwende ausschliesslich diese Angaben.'
  ].join('\n')
}

export function buildRadarRevision(
  fakten: RadarFakten,
  bisher: { titel: string | null; lead: string | null; text: string | null },
  anweisung: string,
  regeln: readonly string[] = []
): string {
  return [
    ...radarZeilen(fakten),
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

const POLIZEI = /polizei\s+basel-?landschaft|kantonspolizei|polizei\s+bl\b/i

/** The article has to say whose list it quotes; without that it reads as our own observation. */
export function polizeiAttributionsWarnung(text: string): string | null {
  if (POLIZEI.test(text.normalize('NFC'))) return null
  return 'Die Meldung nennt die Polizei Basel-Landschaft nicht als Quelle der Angabe.'
}

/** Source line for a radar article: the public page, never the PDF behind the data door. */
export function radarQuelleZeile(fakten: RadarFakten): string {
  const stand =
    fakten.publiziertAm === null
      ? ''
      : ` (Stand ${datumDeutsch(fakten.publiziertAm)})`
  return `Quelle: ${POLIZEI_BL}, Standorte von automatischen Kontrollanlagen${stand}, ${fakten.seiteUrl}`
}

export function datengrundlageRadar(
  fakten: RadarFakten
): Record<string, unknown> {
  return {
    quelle: 'radar_bl',
    quelle_name: POLIZEI_BL,
    url: fakten.seiteUrl,
    gemeinde: fakten.gemeinde,
    art: fakten.art,
    kennung: fakten.kennung,
    ab_wann: fakten.abWann,
    standort: fakten.standort,
    geschwindigkeit: fakten.geschwindigkeit,
    oertlichkeit: fakten.oertlichkeit,
    publikation_am: fakten.publiziertAm,
    weitere_in_gemeinde: fakten.weitereInGemeinde
  }
}

// ---------------------------------------------------------------------------
// 2. A month of speed controls
// ---------------------------------------------------------------------------

export interface MonatsBilanz {
  jahr: number
  monat: number
  bilanz: Zusammenfassung
}

export interface KontrollenFakten {
  gemeinde: string
  /** Who did the measuring and published the sheet — «Gemeindepolizei Reinach». */
  polizei: string
  jahr: number
  monat: number
  /** The sheet's own issue date, ISO, where printed. */
  stand: string | null
  bilanz: Zusammenfassung
  messungen: readonly Messung[]
  /** The previous month we hold, for a comparison from handed numbers only. */
  vormonat: MonatsBilanz | null
  /** What the sheet said about itself (a header naming another month, a line not read). */
  hinweise: readonly string[]
  quelleUrl: string
}

export const KONTROLLEN_SYSTEM_PROMPT = `Du schreibst fuer eine lokale Redaktion in der Region Basel kurze Meldungen ueber die monatlichen Geschwindigkeitskontrollen einer Gemeindepolizei.

Worum es geht: Die Gemeindepolizei misst an verschiedenen Tagen und Orten
der Gemeinde die Geschwindigkeit und veroeffentlicht je Monat eine Tabelle:
Datum, Zeitfenster, Messort, signalisierte Hoechstgeschwindigkeit, gemessene
Fahrzeuge, Anzahl Uebertretungen, hoechste gemessene Geschwindigkeit. Die
Redaktion hat die Tabelle vollstaendig ausgewertet; die Angaben unten sind
diese Auswertung.

Regeln, ohne Ausnahme:
- Schreibe NUR, was in den Angaben steht. Rechne nichts selbst aus — keine
  eigenen Prozentzahlen, keine Summen, keine Vergleiche, die nicht dastehen.
  Erfinde keine Bussen, keine Namen, keine Gruende und keine Aussagen.
- Der Text muss sagen, dass die Zahlen von der genannten Gemeindepolizei
  stammen ("laut Gemeindepolizei Reinach").
- Sag, wie viele Kontrollen es waren, wie viele Fahrzeuge gemessen wurden,
  wie viele davon zu schnell waren, und wo die meisten Uebertretungen
  gezaehlt wurden. Nenne das schnellste Fahrzeug mit Messort, Tag,
  Zeitfenster, gemessener und signalisierter Geschwindigkeit.
- Eine Uebertretung ist eine gemessene Ueberschreitung der signalisierten
  Geschwindigkeit; was daraus folgt (Busse, Anzeige), steht nicht in den
  Angaben und gehoert nicht in den Text.
- Nenne jedes Datum absolut und mit Jahr ("am 8. September 2026", "im
  September 2026"). Schreibe NIEMALS "letzten Monat", "diesen Monat",
  "kuerzlich" — der Text muss auch in fuenf Jahren noch stimmen.
- Steht ein Vormonat bei den Angaben, darfst du ihn nennen; vergleiche nur
  mit den Zahlen, die dort stehen.
- Steht eine Messung des Verkehrsstatistikgeraets bei den Angaben, erklaere
  V85 so, wie es dort steht: 85 Prozent der gemessenen Fahrzeuge fuhren
  hoechstens so schnell.
- Schreibe keine Adresse und keinen Link. Die Quellenzeile setzt die
  Redaktion selbst darunter.
- Sachlich, ohne Ausrufezeichen, ohne Mahnung an die Fahrenden.
- Schweizer Rechtschreibung: "ss" statt "ß". Umlaute als ä, ö, ü — nie als
  ae, oe, ue ("Übertretungen", "Höchstgeschwindigkeit").

Umfang: Titel (maximal 70 Zeichen), Lead (ein Satz), Text (zwei bis drei
kurze Absaetze, durch Leerzeilen getrennt).

Antworte ausschliesslich mit JSON:
{"titel": "...", "lead": "...", "text": "..."}`

function alsDeutsch(zahl: number): string {
  return String(zahl).replace('.', ',')
}

function uhrzeit(von: string, bis: string): string {
  return `${von.replace(':', '.')} bis ${bis.replace(':', '.')} Uhr`
}

function bilanzZeilen(b: Zusammenfassung): string[] {
  const zeilen = [
    `Kontrollen im Monat: ${b.kontrollen}`,
    `Gemessene Fahrzeuge insgesamt: ${b.gemessen}`,
    `Uebertretungen insgesamt: ${b.uebertretungen}${
      b.quote === null
        ? ''
        : ` (${alsDeutsch(b.quote)} Prozent der gemessenen Fahrzeuge)`
    }`
  ]
  if (b.meiste !== null) {
    zeilen.push(
      `Messort mit den meisten Uebertretungen: ${b.meiste.messort} — ${b.meiste.uebertretungen} von ${b.meiste.gemessen} gemessenen Fahrzeugen${
        b.meiste.quote === null
          ? ''
          : ` (${alsDeutsch(b.meiste.quote)} Prozent)`
      }, ${b.meiste.kontrollen} ${b.meiste.kontrollen === 1 ? 'Kontrolle' : 'Kontrollen'}`
    )
  }
  if (
    b.hoechsteQuote !== null &&
    b.hoechsteQuote.messort !== b.meiste?.messort
  ) {
    zeilen.push(
      `Hoechster Anteil Uebertretungen (nur Messorte mit mindestens 50 gemessenen Fahrzeugen): ${b.hoechsteQuote.messort} — ${alsDeutsch(b.hoechsteQuote.quote ?? 0)} Prozent (${b.hoechsteQuote.uebertretungen} von ${b.hoechsteQuote.gemessen})`
    )
  }
  if (b.schnellster !== null) {
    zeilen.push(
      `Schnellstes gemessenes Fahrzeug: ${b.schnellster.vmax} km/h bei signalisierten ${b.schnellster.signalisiert} km/h, ${b.schnellster.messort}, am ${datumDeutsch(b.schnellster.datum)}, Zeitfenster ${uhrzeit(b.schnellster.von, b.schnellster.bis)}`
    )
  }
  return zeilen
}

function kontrollenZeilen(fakten: KontrollenFakten): string[] {
  const zeilen: string[] = [
    `Gemeinde: ${fakten.gemeinde}`,
    `Wer gemessen und veroeffentlicht hat: ${fakten.polizei}`,
    `Monat: ${monatDeutsch(fakten.jahr, fakten.monat)}`,
    fakten.stand === null
      ? null
      : `Datum des Blatts: ${datumDeutsch(fakten.stand)}`,
    '',
    ...bilanzZeilen(fakten.bilanz)
  ].filter((z): z is string => z !== null)

  if (fakten.bilanz.strassen.length > 0) {
    zeilen.push(
      '',
      'Alle Messorte des Monats (Uebertretungen von gemessenen Fahrzeugen):'
    )
    for (const s of fakten.bilanz.strassen) {
      zeilen.push(
        `- ${s.messort}: ${s.uebertretungen} von ${s.gemessen}${s.quote === null ? '' : ` (${alsDeutsch(s.quote)} Prozent)`}, ${s.kontrollen} ${s.kontrollen === 1 ? 'Kontrolle' : 'Kontrollen'}`
      )
    }
  }

  if (fakten.messungen.length > 0) {
    zeilen.push(
      '',
      'Messungen des Verkehrsstatistikgeraets SR7 (V85 = 85 Prozent der gemessenen Fahrzeuge fuhren hoechstens so schnell):'
    )
    for (const m of fakten.messungen) {
      zeilen.push(
        `- ${m.messort}, ${datumDeutsch(m.von)} bis ${datumDeutsch(m.bis)}: ${m.gemessen} Fahrzeuge gemessen, signalisiert ${m.signalisiert} km/h, V85 ${alsDeutsch(m.v85)} km/h`
      )
    }
  }

  if (fakten.vormonat !== null) {
    zeilen.push(
      '',
      `Vormonat ${monatDeutsch(fakten.vormonat.jahr, fakten.vormonat.monat)} (nur zum Vergleich):`
    )
    zeilen.push(...bilanzZeilen(fakten.vormonat.bilanz).slice(0, 3))
  }

  if (fakten.hinweise.length > 0) {
    zeilen.push(
      '',
      'Befunde der Redaktion zum Blatt (nicht in den Text uebernehmen, nur zur Kenntnis):'
    )
    for (const h of fakten.hinweise) zeilen.push(`- ${h}`)
  }
  return zeilen
}

export function buildKontrollenPrompt(
  fakten: KontrollenFakten,
  regeln: readonly string[] = []
): string {
  return [
    ...kontrollenZeilen(fakten),
    ...vorgabenZeilen(regeln),
    '',
    'Schreibe die Meldung. Verwende ausschliesslich diese Angaben.'
  ].join('\n')
}

export function buildKontrollenRevision(
  fakten: KontrollenFakten,
  bisher: { titel: string | null; lead: string | null; text: string | null },
  anweisung: string,
  regeln: readonly string[] = []
): string {
  return [
    ...kontrollenZeilen(fakten),
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

/** The article has to name the police that measured; the words come from the row (`polizei`). */
export function kontrollenAttributionsWarnung(
  text: string,
  fakten: Pick<KontrollenFakten, 'polizei' | 'gemeinde'>
): string | null {
  const norm = text.normalize('NFC')
  const namen = [
    fakten.polizei,
    `Polizei ${fakten.gemeinde}`,
    `Gemeinde ${fakten.gemeinde}`
  ]
  if (namen.some((n) => norm.toLowerCase().includes(n.toLowerCase())))
    return null
  return `Die Meldung nennt die ${fakten.polizei} nicht als Quelle der Zahlen.`
}

export function kontrollenQuelleZeile(fakten: KontrollenFakten): string {
  return `Quelle: ${fakten.polizei}, Geschwindigkeitskontrollen ${monatDeutsch(fakten.jahr, fakten.monat)} (PDF), ${fakten.quelleUrl}`
}

export function datengrundlageKontrollen(
  fakten: KontrollenFakten
): Record<string, unknown> {
  return {
    quelle: 'geschwindigkeitskontrollen',
    quelle_name: `Gemeinde ${fakten.gemeinde}`,
    url: fakten.quelleUrl,
    gemeinde: fakten.gemeinde,
    polizei: fakten.polizei,
    jahr: fakten.jahr,
    monat: fakten.monat,
    stand: fakten.stand,
    bilanz: fakten.bilanz,
    messungen: fakten.messungen,
    vormonat: fakten.vormonat,
    hinweise: fakten.hinweise
  }
}

// ---------------------------------------------------------------------------
// Shared: source line on and off, the digit check
// ---------------------------------------------------------------------------

const QUELLENZEILE = /\n{2,}Quelle: [^\n]*$/

export function mitQuelle(text: string, quelleZeile: string): string {
  return `${text.trim()}\n\n${quelleZeile}`
}

export function ohneQuelle(text: string | null): string | null {
  if (text === null) return null
  return text.replace(QUELLENZEILE, '').trimEnd()
}

/** Every digit run inside a handed value — «2026-09-08» also as 8 and 9, «21.3» as 21 and 3. */
function sammleZiffern(wert: unknown, erlaubt: Set<string>, tiefe = 0): void {
  if (wert === null || wert === undefined || tiefe > 6) return
  if (typeof wert === 'number' || typeof wert === 'string') {
    for (const treffer of String(wert).matchAll(/\d+/g)) {
      erlaubt.add(treffer[0])
      erlaubt.add(String(Number(treffer[0])))
    }
    return
  }
  if (Array.isArray(wert)) {
    for (const w of wert) sammleZiffern(w, erlaubt, tiefe + 1)
    return
  }
  if (typeof wert === 'object') {
    for (const w of Object.values(wert as Record<string, unknown>))
      sammleZiffern(w, erlaubt, tiefe + 1)
  }
}

/**
 * Every number in the article must be one we handed over — the same rule as
 * on every other desk. The facts object is walked whole: the sheet's figures,
 * the dates in all their forms, the previous month, the limits.
 */
export function zahlWarnungenVerkehr(
  text: string,
  fakten: RadarFakten | KontrollenFakten
): string[] {
  const erlaubt = new Set<string>()
  sammleZiffern(fakten, erlaubt)
  // The floor the «highest share» line names.
  erlaubt.add('50')
  erlaubt.add('85')
  const gefunden = [...text.matchAll(/\d+/g)].map((t) => t[0])
  return [...new Set(gefunden.filter((zahl) => !erlaubt.has(zahl)))].map(
    (zahl) => zahlWarnung(zahl)
  )
}
