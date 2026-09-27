import { datumDeutsch } from './amtsblatt'
import { vorgabenZeilen } from './lernen'
import { bundZwischenstandWarnung, zahlWarnung } from './warnungen'
import type { AbstimmungsFakten, Zahlenblock } from './abstimmung'

// ONE article per municipality and vote Sunday — the newsroom's decision of
// 27 September 2026, replacing one per Vorlage.
//
// Four things the newsroom said, and where each one lives:
//
// 1. **One summary per Sunday and municipality.** The day's Vorlagen are
//    handed over together (`tagesFakten`), each with the municipality's own
//    result and turnout.
// 2. **Where the municipality voted differently from the canton or the Bund,
//    that is the story.** Whether it did is CODE (`weichtAb`), never the
//    model's reading of two numbers, and it is handed over as a fact.
// 3. **How the canton or the Bund voted does not belong in the article** —
//    the newsletter covers it elsewhere. So their FIGURES are never handed
//    over at all; only their outcome, and only as the yardstick of a
//    deviation. The digit check (`zahlWarnungenTag`) allows the
//    municipality's own figures and nothing else, which is what catches a
//    canton figure the model brought from memory.
// 4. **The editor names the most interesting Vorlagen in the revision.** That
//    is the ordinary chat revision on this article; a standing preference goes
//    into „Gelerntes" like every other rule.

export interface TagesTeil {
  artText: string
  titel: string
  gemeinde: Zahlenblock | null
  /** `angenommen`/`abgelehnt` of the canton — the yardstick, never a figure. */
  kantonAntwort: string | null
  /** Null when either side is unknown; code, not the model. */
  andersAlsKanton: boolean | null
}

export interface TagesVorlage {
  voteId: string
  titel: string
  ebeneText: string | null
  teile: TagesTeil[]
  /** The national outcome of a federal Vorlage — final, or the interim tendency. */
  bundAntwort: 'angenommen' | 'abgelehnt' | null
  /** The warning line when `bundAntwort` is only an interim count, else null. */
  bundZwischenstand: string | null
  andersAlsBund: boolean | null
  /** The Stichfrage is only named when it decides something (`abstimmung.ts`). */
  stichfrageGrund: string | null
}

export interface TagesFakten {
  gemeinde: string
  datum: string
  datumText: string
  vorlagen: TagesVorlage[]
  beteiligung: number | null
  vergleich: { datum: string; datumText: string; beteiligung: number } | null
  /** The canton's page of the whole day — the one address the article carries. */
  quelleUrl: string
}

/** The Bund's outcome of a federal Vorlage, as the run stored it. */
export interface BundErgebnis {
  angenommen: boolean | null
  beendet: boolean
  jaProzent?: number | null
  staendeJa?: number | null
  staendeNein?: number | null
  stand?: string | null
}

/**
 * Whether the municipality decided otherwise than the yardstick. Only for a
 * yes/no question — a Stichfrage names a side, and its deviation is not what
 * the newsroom asked for.
 */
export function weichtAb(
  gemeinde: string | null,
  massstab: string | null
): boolean | null {
  const jaNein = (w: string | null) => w === 'angenommen' || w === 'abgelehnt'
  if (!jaNein(gemeinde) || !jaNein(massstab)) return null
  return gemeinde !== massstab
}

/** The canton's page of the day: the Vorlage's own address without its `/issues/…`. */
export function tagesQuelleUrl(vorlagenUrl: string): string {
  return vorlagenUrl.replace(/\/issues\/[^/]+\/?$/, '')
}

/**
 * The whole day for one municipality, out of the per-Vorlage facts the old
 * article was written from — every rule of those (counted, Stichfrage,
 * complete canton figure) has already been applied there.
 */
export function tagesFakten(
  vorlagen: ReadonlyArray<{
    fakten: AbstimmungsFakten
    bund: BundErgebnis | null
  }>
): TagesFakten {
  const erste = vorlagen[0]?.fakten
  if (erste === undefined) throw new Error('Ein Abstimmungstag ohne Vorlage.')

  const liste: TagesVorlage[] = vorlagen.map(({ fakten, bund }) => {
    const teile: TagesTeil[] = fakten.teile.map((teil) => ({
      artText: teil.artText,
      titel: teil.titel,
      gemeinde: teil.gemeinde,
      kantonAntwort: teil.kanton?.antwort ?? null,
      andersAlsKanton:
        teil.art === 'stichfrage'
          ? null
          : weichtAb(
              teil.gemeinde?.antwort ?? null,
              teil.kanton?.antwort ?? null
            )
    }))
    const bundAntwort =
      fakten.ebene === 'bund' && bund !== null && bund.angenommen !== null
        ? bund.angenommen
          ? ('angenommen' as const)
          : ('abgelehnt' as const)
        : null
    const hauptteil = teile[0]
    return {
      voteId: fakten.voteId,
      titel: fakten.titel,
      ebeneText: fakten.ebeneText,
      teile,
      bundAntwort,
      bundZwischenstand:
        bundAntwort !== null && bund !== null && !bund.beendet
          ? bundZwischenstandWarnung({
              titel: fakten.titel,
              antwort: bundAntwort,
              jaProzent: bund.jaProzent ?? null,
              staendeJa: bund.staendeJa ?? null,
              staendeNein: bund.staendeNein ?? null,
              stand: bund.stand ?? null
            })
          : null,
      andersAlsBund:
        bundAntwort === null
          ? null
          : weichtAb(hauptteil?.gemeinde?.antwort ?? null, bundAntwort),
      // Only where there IS a counter-proposal: a note about a Stichfrage
      // that does not exist is noise in the prompt.
      stichfrageGrund:
        fakten.stichfrage.gilt || fakten.teile.length < 2
          ? null
          : fakten.stichfrage.grund || null
    }
  })

  const beteiligung =
    vorlagen
      .map((v) => v.fakten.teile[0]?.gemeinde?.beteiligung ?? null)
      .find((b) => b !== null) ?? null

  return {
    gemeinde: erste.gemeinde,
    datum: erste.datum,
    datumText: erste.datumText,
    vorlagen: liste,
    beteiligung,
    vergleich:
      vorlagen.map((v) => v.fakten.vergleich).find((v) => v !== null) ?? null,
    quelleUrl: tagesQuelleUrl(erste.quelleUrl)
  }
}

export const TAGES_SYSTEM_PROMPT = `Du schreibst fuer eine lokale Redaktion in der Region Basel EINE zusammenfassende Meldung darueber, wie eine einzelne Gemeinde an einem Abstimmungssonntag abgestimmt hat — ueber alle Vorlagen des Tages.

Worum es geht: der Kanton veroeffentlicht je Vorlage und Gemeinde das amtliche
Ergebnis. Die Meldung sagt, wie DIESE Gemeinde gestimmt hat.

Was die Nachricht ist:
- Wo die Gemeinde ANDERS entschieden hat als der Kanton oder die ganze Schweiz,
  steht das vorne — im Titel oder im Lead. Ob sie anders entschieden hat, steht
  in den Angaben ("anders als der Kanton"); lies es nie selbst aus Zahlen heraus.
- Sonst die Vorlagen in der Reihenfolge ihres Gewichts fuer die Gemeinde, jede
  mit dem Ja-Anteil der Gemeinde, dazu einmal die Stimmbeteiligung.

Regeln, ohne Ausnahme:
- Wie der Kanton oder die Schweiz abgestimmt haben, gehoert NICHT in die
  Meldung — das steht an anderer Stelle im Newsletter. Du nennst es nur als
  Vergleich einer Abweichung ("anders als der Kanton hat Binningen ...
  angenommen"), nie mit einer Zahl und nie als eigenen Satz.
- Schreibe NUR, was in den Angaben steht. Rechne nichts aus.
- Nenne den Kanton Basel-Landschaft als Quelle des Ergebnisses ("nach dem
  amtlichen Ergebnis des Kantons").
- Die Stichfrage erwaehnst du nur, wo die Angaben sagen, dass sie etwas
  entscheidet.
- Nenne das Datum absolut und mit Jahr ("am 27. September 2026"). Schreibe
  NIEMALS "heute", "gestern", "am Sonntag" oder "morgen".
- Keine Adresse, kein Link — die Quellenzeile setzt die Redaktion darunter.
- Keine Parteien, keine Parolen, keine Deutung des Abstimmungskampfs.
- Sachlich, ohne Ausrufezeichen. Schweizer Rechtschreibung: "ss" statt "ß".

Umfang: Titel (maximal 70 Zeichen), Lead (ein Satz), Text (zwei bis drei kurze
Absaetze, durch Leerzeilen getrennt).

Antworte ausschliesslich mit JSON:
{"titel": "...", "lead": "...", "text": "..."}`

function alsDeutsch(zahl: number): string {
  return String(zahl).replace('.', ',')
}

function gemeindeZeile(name: string, z: Zahlenblock | null): string {
  if (z === null) return `  ${name}: keine Zahlen`
  const teile: string[] = []
  if (z.antwort !== null) teile.push(z.antwort)
  if (z.prozentJa !== null) teile.push(`${alsDeutsch(z.prozentJa)} Prozent Ja`)
  if (z.ja !== null) teile.push(`${z.ja} Ja`)
  if (z.nein !== null) teile.push(`${z.nein} Nein`)
  return `  ${name}: ${teile.join(', ')}`
}

function vergleichsText(anders: boolean | null, wer: string): string | null {
  if (anders === true) return `  ANDERS als ${wer}`
  if (anders === false) return `  wie ${wer}`
  return null
}

function faktenZeilen(f: TagesFakten): string[] {
  const zeilen = [`Gemeinde: ${f.gemeinde}`, `Abstimmungstag: ${f.datumText}`]
  for (const v of f.vorlagen) {
    zeilen.push(
      '',
      `Vorlage: ${v.titel}${v.ebeneText === null ? '' : ` (${v.ebeneText})`}`
    )
    for (const teil of v.teile) {
      if (v.teile.length > 1) zeilen.push(`  ${teil.artText}: ${teil.titel}`)
      zeilen.push(gemeindeZeile(f.gemeinde, teil.gemeinde))
      const kanton = vergleichsText(teil.andersAlsKanton, 'der Kanton')
      if (kanton !== null) zeilen.push(kanton)
    }
    const bund = vergleichsText(v.andersAlsBund, 'die Schweiz')
    if (bund !== null) zeilen.push(bund)
    if (v.stichfrageGrund !== null)
      zeilen.push(
        `  Zur Stichfrage: ${v.stichfrageGrund} Die Stichfrage gehoert NICHT in den Text.`
      )
  }
  if (f.beteiligung !== null)
    zeilen.push(
      '',
      `Stimmbeteiligung in ${f.gemeinde}: ${alsDeutsch(f.beteiligung)} Prozent`
    )
  if (f.vergleich !== null)
    zeilen.push(
      `Letzte Abstimmung davor (${f.vergleich.datumText}): Stimmbeteiligung ${alsDeutsch(f.vergleich.beteiligung)} Prozent`
    )
  return zeilen
}

export function buildTagesPrompt(
  f: TagesFakten,
  regeln: readonly string[] = []
): string {
  return [
    ...faktenZeilen(f),
    ...vorgabenZeilen(regeln),
    '',
    'Schreibe die eine Meldung ueber diesen Abstimmungstag. Verwende ausschliesslich diese Angaben.'
  ].join('\n')
}

export function buildTagesRevision(
  f: TagesFakten,
  bisher: { titel: string | null; lead: string | null; text: string | null },
  anweisung: string,
  regeln: readonly string[] = []
): string {
  return [
    ...faktenZeilen(f),
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

export function tagesQuelleZeile(f: TagesFakten): string {
  return `Quelle: Kanton Basel-Landschaft, amtliche Ergebnisse der Abstimmung vom ${f.datumText}, ${f.quelleUrl}`
}

export function mitTagesQuelle(text: string, f: TagesFakten): string {
  return `${text.trim()}\n\n${tagesQuelleZeile(f)}`
}

/**
 * Every digit must be the MUNICIPALITY's — its counts, shares and turnout, the
 * day, the titles and the previous ballot. A canton or national figure is not
 * handed over, so where one appears the model brought it, and it is exactly
 * what the newsroom does not want in this article.
 */
export function zahlWarnungenTag(text: string, f: TagesFakten): string[] {
  const erlaubt = new Set<string>()
  const sammle = (wert: string | number | null): void => {
    if (wert === null) return
    for (const treffer of String(wert).matchAll(/\d+/g)) {
      erlaubt.add(treffer[0])
      erlaubt.add(String(Number(treffer[0])))
    }
  }
  sammle(f.datum)
  sammle(f.datumText)
  sammle(f.beteiligung)
  for (const v of f.vorlagen) {
    sammle(v.titel)
    for (const teil of v.teile) {
      sammle(teil.titel)
      const z = teil.gemeinde
      if (z === null) continue
      sammle(z.ja)
      sammle(z.nein)
      sammle(z.prozentJa)
      sammle(z.beteiligung)
      sammle(z.stimmberechtigte)
    }
  }
  if (f.vergleich !== null) {
    sammle(f.vergleich.datum)
    sammle(f.vergleich.datumText)
    sammle(f.vergleich.beteiligung)
  }
  const gefunden = [...text.matchAll(/\d+/g)].map((t) => t[0])
  return [...new Set(gefunden.filter((z) => !erlaubt.has(z)))].map((z) =>
    zahlWarnung(z)
  )
}

/**
 * One warning per federal Vorlage whose comparison rests on the Bund's
 * interim count — whatever the text says, because the journalist decides
 * whether the tendency is clear and the article never says «Zwischenresultat»
 * itself (it would rot by the evening).
 */
export function bundWarnungenTag(f: TagesFakten): string[] {
  return f.vorlagen
    .map((v) => v.bundZwischenstand)
    .filter((w): w is string => w !== null)
}

/** The Stichfrage appears although no Vorlage of the day has one that decides. */
export function stichfragenWarnungenTag(
  text: string,
  f: TagesFakten
): string[] {
  if (!/stichfrage/i.test(text.normalize('NFC'))) return []
  const entscheidet = f.vorlagen.some(
    (v) =>
      v.stichfrageGrund === null &&
      v.teile.some((t) => t.artText === 'Stichfrage')
  )
  return entscheidet
    ? []
    : [
        'Die Meldung spricht von einer Stichfrage, obwohl keine etwas entscheidet.'
      ]
}

export function datengrundlageTag(f: TagesFakten): Record<string, unknown> {
  return {
    quelle: 'abstimmungstag',
    quelle_name: 'Kanton Basel-Landschaft',
    url: f.quelleUrl,
    datum: f.datum,
    gemeinde: f.gemeinde,
    vote_ids: f.vorlagen.map((v) => v.voteId),
    vorlagen: f.vorlagen,
    beteiligung: f.beteiligung,
    vergleich: f.vergleich
  }
}

export { datumDeutsch }
