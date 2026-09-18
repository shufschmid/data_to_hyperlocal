import { datumDeutsch } from './amtsblatt'
import { vorgabenZeilen } from './lernen'
import { zahlWarnung } from './warnungen'
import type { Abstimmungsart, Abstimmungsebene } from '../shared/abstimmung'
import type {
  Gemeindezahlen,
  Kantonszahlen,
  Stichfragenurteil,
  Vergleich,
  Vorlage
} from './abstimmunglauf'

export {
  linkWarnungen,
  zeitWarnungen,
  parseMeldungstext as parseAbstimmungsmeldung
} from './spielbericht'

// What an article about a vote result may say, and the checks that hold it.
//
// Three things shape this module, and all three are decisions the code takes
// rather than requests the prompt makes.
//
// **Everything is handed over as a figure.** «Binningen hat mit 54,2 Prozent Ja
// gestimmt» is half a story; the other half is the canton and the last time
// people went to the ballot box. Both stand in the same dataset, so both are
// fetched and handed over — computed in `abstimmunglauf.ts` over complete rows.
// A model that works out a cantonal average for itself is exactly the mistake
// this house has already paid for once.
//
// **The Stichfrage is only a statement when both Vorlagen were accepted.**
// Where it is not, its figures are not handed over AT ALL — a number that is in
// no prompt cannot end up in a text — and a check catches the word anyway,
// because a model can name a Stichfrage without being given one.
//
// **The source line is built, never written.** One address: the canton's own
// publication of this Vorlage.

const ART_NAME: Readonly<Record<Abstimmungsart, string>> = {
  vorlage: 'Initiative',
  gegenvorschlag: 'Gegenvorschlag',
  stichfrage: 'Stichfrage'
}

const EBENE_NAME: Readonly<Record<Abstimmungsebene, string>> = {
  bund: 'eidgenoessische Vorlage',
  kanton: 'kantonale Vorlage'
}

function rundeAuf(wert: number, stellen: number): number {
  const faktor = 10 ** stellen
  return Math.round(wert * faktor) / faktor
}

function alsDeutsch(zahl: number): string {
  return String(zahl).replace('.', ',')
}

/** The figures of one side, rounded the way a sentence prints them. */
export interface Zahlenblock {
  antwort: string | null
  ja: number | null
  nein: number | null
  prozentJa: number | null
  beteiligung: number | null
  stimmberechtigte: number | null
  leer: number | null
  ungueltig: number | null
}

export interface Faktenteil {
  art: Abstimmungsart
  artText: string
  titel: string
  gemeinde: Zahlenblock | null
  /** Null while the canton is still counting — «keine Vergleichszahlen». */
  kanton: Zahlenblock | null
}

export interface AbstimmungsFakten {
  gemeinde: string
  voteId: string
  datum: string
  /** «27. September 2026» — rendered here so the model never formats a date. */
  datumText: string
  ebene: Abstimmungsebene | null
  ebeneText: string | null
  titel: string
  /** The one address the article carries. */
  quelleUrl: string
  teile: Faktenteil[]
  stichfrage: Stichfragenurteil
  /** How many municipalities the cantonal figure covers. Complete, or absent. */
  kantonsgemeinden: number | null
  vergleich: { datum: string; datumText: string; beteiligung: number } | null
}

function block(zahlen: Zahlenblock | Kantonszahlen | null): Zahlenblock | null {
  if (zahlen === null) return null
  return {
    antwort: zahlen.antwort,
    ja: zahlen.ja,
    nein: zahlen.nein,
    prozentJa: zahlen.prozentJa === null ? null : rundeAuf(zahlen.prozentJa, 1),
    beteiligung:
      zahlen.beteiligung === null ? null : rundeAuf(zahlen.beteiligung, 1),
    stimmberechtigte: zahlen.stimmberechtigte,
    leer: zahlen.leer,
    ungueltig: zahlen.ungueltig
  }
}

/**
 * Everything one article may talk about, with nothing left to derive.
 *
 * The Stichfrage is dropped here when it decides nothing: its figures are real
 * and meaningless, and the cheapest way to keep them out of a text is to keep
 * them out of the prompt.
 */
export function abstimmungsFakten(eingabe: {
  vorlage: Pick<Vorlage, 'voteId' | 'datum' | 'ebene' | 'titel' | 'teile'> & {
    quelleUrl: string
  }
  gemeinde: Gemeindezahlen
  stichfrage: Stichfragenurteil
  vergleich: { datum: string; beteiligung: number } | null
}): AbstimmungsFakten {
  const { vorlage, gemeinde } = eingabe

  const teile: Faktenteil[] = vorlage.teile
    .filter(
      (teil) => teil.art !== 'stichfrage' || eingabe.stichfrage.gilt === true
    )
    .map((teil) => {
      const eigene = gemeinde.ergebnisse.find((e) => e.art === teil.art) ?? null
      return {
        art: teil.art,
        artText: ART_NAME[teil.art] ?? teil.art,
        titel: teil.titel,
        gemeinde: block(eigene),
        kanton: block(teil.kanton)
      }
    })

  const kantonsgemeinden =
    vorlage.teile.find((teil) => teil.kanton !== null)?.kanton?.gemeinden ??
    null

  return {
    gemeinde: gemeinde.gemeinde,
    voteId: vorlage.voteId,
    datum: vorlage.datum,
    datumText: datumDeutsch(vorlage.datum),
    ebene: vorlage.ebene,
    ebeneText:
      vorlage.ebene === null ? null : (EBENE_NAME[vorlage.ebene] ?? null),
    titel: vorlage.titel,
    quelleUrl: vorlage.quelleUrl,
    teile,
    stichfrage: eingabe.stichfrage,
    kantonsgemeinden,
    vergleich:
      eingabe.vergleich === null
        ? null
        : {
            datum: eingabe.vergleich.datum,
            datumText: datumDeutsch(eingabe.vergleich.datum),
            beteiligung: eingabe.vergleich.beteiligung
          }
  }
}

export const ABSTIMMUNGS_SYSTEM_PROMPT = `Du schreibst fuer eine lokale Redaktion in der Region Basel kurze Meldungen ueber Abstimmungsresultate einer einzelnen Gemeinde.

Worum es geht: der Kanton veroeffentlicht je Vorlage und Gemeinde das amtliche
Ergebnis. Die Meldung sagt, wie DIESE Gemeinde gestimmt hat, und stellt es
neben das Ergebnis des Kantons.

Regeln, ohne Ausnahme:
- Schreibe NUR, was in den Angaben steht. Rechne nichts aus, was nicht
  dasteht. Keine Prozentzahl, keine Differenz und keine Rangliste, die nicht
  uebergeben wurde.
- Stehen keine Kantonszahlen in den Angaben, dann gibt es keine: schreibe
  nichts ueber den Kanton und erfinde keinen Vergleich. Ueber das Ergebnis der
  ganzen Schweiz steht hier nie etwas — schweige darueber.
- Nenne den Kanton Basel-Landschaft als Quelle des Ergebnisses.
- Verwechsle die Gemeinde nicht mit dem Kanton: ein Ja der Gemeinde ist ein Ja
  der Gemeinde, auch wenn der Kanton anders entschieden hat. Wo sie
  auseinandergehen, ist genau das die Nachricht.
- Nenne jedes Datum absolut und mit Jahr ("am 27. September 2026"). Schreibe
  NIEMALS "heute", "gestern", "am Sonntag", "kuerzlich" oder "morgen" — der
  Text muss auch in fuenf Jahren noch stimmen.
- Schreibe keine Adresse und keinen Link. Die Quellenzeile setzt die Redaktion
  selbst darunter.
- Keine Parteien, keine Parolen, keine Reaktionen, keine Deutung des
  Abstimmungskampfs: davon steht nichts in den Angaben.
- Sachlich, ohne Ausrufezeichen, ohne Dramatisierung.
- Schweizer Rechtschreibung: "ss" statt "ß".

Umfang: Titel (maximal 70 Zeichen), Lead (ein Satz), Text (zwei bis drei kurze
Absaetze, durch Leerzeilen getrennt).

Antworte ausschliesslich mit JSON:
{"titel": "...", "lead": "...", "text": "..."}`

function zahlenZeilen(name: string, zahlen: Zahlenblock | null): string[] {
  if (zahlen === null) return [`${name}: keine Vergleichszahlen`]

  const teile: string[] = []
  if (zahlen.antwort !== null) teile.push(zahlen.antwort)
  if (zahlen.ja !== null) teile.push(`${zahlen.ja} Ja`)
  if (zahlen.nein !== null) teile.push(`${zahlen.nein} Nein`)
  if (zahlen.prozentJa !== null) {
    teile.push(`${alsDeutsch(zahlen.prozentJa)} Prozent Ja`)
  }
  if (zahlen.beteiligung !== null) {
    teile.push(`Stimmbeteiligung ${alsDeutsch(zahlen.beteiligung)} Prozent`)
  }
  if (zahlen.stimmberechtigte !== null) {
    teile.push(`${zahlen.stimmberechtigte} Stimmberechtigte`)
  }
  if (zahlen.leer !== null) teile.push(`${zahlen.leer} leer`)
  if (zahlen.ungueltig !== null) teile.push(`${zahlen.ungueltig} ungueltig`)

  return [`${name}: ${teile.join(', ')}`]
}

function faktenZeilen(fakten: AbstimmungsFakten): string[] {
  const zeilen: string[] = [
    `Gemeinde: ${fakten.gemeinde}`,
    `Abstimmungstag: ${fakten.datumText}`,
    `Vorlage: ${fakten.titel}`
  ]

  if (fakten.ebeneText !== null) zeilen.push(`Ebene: ${fakten.ebeneText}`)

  for (const teil of fakten.teile) {
    zeilen.push('', `${teil.artText}: ${teil.titel}`)
    zeilen.push(...zahlenZeilen(`  ${fakten.gemeinde}`, teil.gemeinde))
    zeilen.push(
      ...zahlenZeilen(
        `  Kanton Basel-Landschaft${fakten.kantonsgemeinden === null ? '' : ` (alle ${fakten.kantonsgemeinden} Gemeinden)`}`,
        teil.kanton
      )
    )
  }

  zeilen.push('')
  // The rule of the Stichfrage is a FACT in this prompt, not a request: where
  // it decides nothing its figures were never handed over.
  zeilen.push(
    fakten.stichfrage.gilt
      ? `Zur Stichfrage: ${fakten.stichfrage.grund}`
      : `Zur Stichfrage: ${fakten.stichfrage.grund} Die Stichfrage gehoert NICHT in den Text.`
  )

  if (fakten.vergleich !== null) {
    zeilen.push(
      '',
      `Letzte Abstimmung davor (${fakten.vergleich.datumText}): Stimmbeteiligung in ${fakten.gemeinde} ${alsDeutsch(fakten.vergleich.beteiligung)} Prozent`
    )
  }

  return zeilen
}

export function buildAbstimmungsPrompt(
  fakten: AbstimmungsFakten,
  regeln: readonly string[] = []
): string {
  return [
    ...faktenZeilen(fakten),
    ...vorgabenZeilen(regeln),
    '',
    'Schreibe die Meldung. Verwende ausschliesslich diese Angaben.'
  ].join('\n')
}

export function buildAbstimmungsRevision(
  fakten: AbstimmungsFakten,
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
 * One address and only one: the canton's own publication of this Vorlage. Its
 * address changes after the ballot (before the day it points at
 * `vework-public.bl.ch`, afterwards at the archive on `abstimmungen.bl.ch`),
 * and because an article is only ever written from the stored row AFTER
 * counting, the line carries the archive address a reader can open for years.
 */
export function quelleZeile(fakten: AbstimmungsFakten): string {
  return (
    `Quelle: Kanton Basel-Landschaft, amtliches Ergebnis der Abstimmung vom ` +
    `${fakten.datumText}, ${fakten.quelleUrl}`
  )
}

export function mitQuelle(text: string, fakten: AbstimmungsFakten): string {
  return `${text.trim()}\n\n${quelleZeile(fakten)}`
}

const QUELLENZEILE = /\n{2,}Quelle: [^\n]*$/

export function ohneQuelle(text: string | null): string | null {
  if (text === null) return null
  return text.replace(QUELLENZEILE, '').trimEnd()
}

// ---------------------------------------------------------------------------
// The checks — a prompt is a request, a check is a rule
// ---------------------------------------------------------------------------

/** How a German sentence names the office behind the figures. */
const KANTON = /kanton|basel-?landschaft|\bBL\b|landeskanzlei|amtliche/i

/**
 * Whether the text names the canton as the source of the result.
 *
 * A vote result printed without saying whose count it is reads as the
 * newsroom's own tally, and the newsroom counts no ballots.
 */
export function abstimmungsAttributionsWarnung(text: string): string | null {
  if (KANTON.test(text.normalize('NFC'))) return null
  return 'Die Meldung nennt den Kanton Basel-Landschaft nicht als Quelle des Ergebnisses.'
}

const STICHFRAGE = /stichfrage/i

/**
 * The Stichfrage must not appear when it decides nothing.
 *
 * Its figures are never handed over in that case, but a model can name the
 * thing without being given a number — and a sentence about a Stichfrage that
 * decided nothing tells a reader the opposite of what happened. The prompt says
 * it, this catches it.
 */
export function stichfragenWarnungen(
  text: string,
  fakten: Pick<AbstimmungsFakten, 'stichfrage'>
): string[] {
  if (fakten.stichfrage.gilt) return []
  if (!STICHFRAGE.test(text.normalize('NFC'))) return []

  return [
    `Die Meldung spricht von der Stichfrage, obwohl sie nichts entscheidet. ${fakten.stichfrage.grund}`
  ]
}

/**
 * Every number in the text must be one we handed over.
 *
 * Run BEFORE `mitQuelle` appends the address, whose digits are nobody's claim.
 * The allowance is exactly the facts block: both sides' counts, shares,
 * turnouts, electorates, blank and invalid papers, the day itself and the
 * previous ballot — nothing else. A share the model computed against a figure
 * it was not given is the classic silent error here.
 */
export function zahlWarnungenAbstimmung(
  text: string,
  fakten: AbstimmungsFakten
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

  const sammleBlock = (zahlen: Zahlenblock | null): void => {
    if (zahlen === null) return
    sammle(zahlen.ja)
    sammle(zahlen.nein)
    sammle(zahlen.prozentJa)
    sammle(zahlen.beteiligung)
    sammle(zahlen.stimmberechtigte)
    sammle(zahlen.leer)
    sammle(zahlen.ungueltig)
  }

  sammle(fakten.datum)
  sammle(fakten.datumText)
  sammle(fakten.titel)
  sammle(fakten.kantonsgemeinden)
  for (const teil of fakten.teile) {
    sammle(teil.titel)
    sammleBlock(teil.gemeinde)
    sammleBlock(teil.kanton)
  }
  if (fakten.vergleich !== null) {
    sammle(fakten.vergleich.datum)
    sammle(fakten.vergleich.datumText)
    sammle(fakten.vergleich.beteiligung)
  }

  const gefunden = [...text.matchAll(/\d+/g)].map((treffer) => treffer[0])
  return [...new Set(gefunden.filter((zahl) => !erlaubt.has(zahl)))].map(
    (zahl) => zahlWarnung(zahl)
  )
}

/** The provenance stored with the Meldung — one pure mapping, as everywhere. */
export function datengrundlageAbstimmung(
  fakten: AbstimmungsFakten
): Record<string, unknown> {
  return {
    quelle: 'abstimmung',
    quelle_name: 'Kanton Basel-Landschaft',
    url: fakten.quelleUrl,
    vote_id: fakten.voteId,
    datum: fakten.datum,
    gemeinde: fakten.gemeinde,
    titel: fakten.titel,
    ebene: fakten.ebene,
    teile: fakten.teile,
    stichfrage: fakten.stichfrage,
    vergleich: fakten.vergleich
  }
}

export type { Vergleich }
