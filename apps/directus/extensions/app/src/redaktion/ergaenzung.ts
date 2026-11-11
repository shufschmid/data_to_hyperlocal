// Was die Redaktion selbst beisteuert, wenn die Quelle nicht reicht — und
// die Meldung, die sie ganz selbst schreibt.
//
// Der Anlass war die „Turnerobe" in Reinach (4. November 2026): der Kalender
// nannte Tag, Zeit und Ort, aber keinen Beschrieb, der Titel sagte nicht, was
// stattfindet, und der Schreiber verweigerte — zu Recht, aus Titel und
// Eckdaten erfindet er nichts. Die Redaktion weiss aber, was eine Turnerobe
// ist. Ihre Worte vom selben Tag: ueberall braucht es die Option, eine eigene
// Meldung zu schreiben oder zusaetzliche Angaben zu machen, damit die KI die
// Meldung schreibt.
//
// Zwei Wege, auf jedem Tisch, der eine Meldung aus einer Zeile schreibt:
//
// 1. ERGAENZUNG — Angaben der Redaktion, die der Quelle fehlen. Sie reisen als
//    eigener Block in den Prompt (gekennzeichnet, nie der Quelle
//    zugeschrieben), ihre Ziffern gelten als uebergeben, ihre Tage als
//    moegliche Termine. Alles andere bleibt: Attribution an die Quelle, eigene
//    Worte, Ueberlappungs-Check gegen den Quelltext. Sie bleiben in
//    `datengrundlage.ergaenzung`, damit eine Ueberarbeitung im Chat sie wieder
//    vorfindet, und ein Hinweis auf der Meldung sagt, dass sie eingeflossen
//    sind — das Pruefsiegel sortiert ihn unter `weitere`, wie den
//    Eckdaten-Hinweis des Veranstaltungstischs.
//
// 2. EIGENE MELDUNG — Titel, Lead und Text von Hand, kein Modellaufruf. Die
//    Quellenzeile baut weiterhin der Code, die Zeitbezug- und Link-Pruefung
//    laufen auch ueber einen Text von Hand (ein „morgen" ist in fuenf Jahren
//    so oder so falsch), und ein Hinweis sagt, dass Zahlen und Wortlaut nicht
//    gegen die Quelle geprueft sind. Der eigene Text wird als Ergaenzung
//    gemerkt: ueberarbeitet die Redaktion ihn spaeter im Chat, sind seine
//    Fakten uebergebenes Material und keine Erfindung des Modells — sonst
//    muesste der Schreiber sie weglassen, und der Artikel waere nach der
//    ersten Anweisung leer.
//
// Beides lehrt nichts: Fakten sind keine Regel, und ein Text von Hand ist kein
// Entscheid ueber einen Vorschlag.

import { linkWarnungen, zeitWarnungen } from './spielbericht'

/** Wie lang ergaenzende Angaben sein duerfen — ein Prompt-Block, kein Dossier. */
export const ERGAENZUNG_MAX_ZEICHEN = 6000

/** Die Spalte `meldungen.titel` ist 255 Zeichen breit. */
export const TITEL_MAX_ZEICHEN = 255

// Both faces WITHOUT a comma: `zeit_warnungen` is a CSV column, and a comma
// cuts a warning into pieces (measured on the Bund's interim warning).
export const ERGAENZUNG_HINWEIS =
  'Mit ergänzenden Angaben der Redaktion geschrieben — diese stammen nicht aus der Quelle.'
export const EIGENE_HINWEIS =
  'Von der Redaktion selbst geschrieben — Zahlen und Wortlaut nicht gegen die Quelle geprüft.'

export interface EigeneMeldung {
  titel: string
  lead: string
  text: string
}

/** What a Meldung route may carry beyond the row's id: one of the two, or neither. */
export interface RedaktionsBeitrag {
  ergaenzung: string | null
  eigene: EigeneMeldung | null
}

export const OHNE_BEITRAG: RedaktionsBeitrag = {
  ergaenzung: null,
  eigene: null
}

/**
 * The editor's additions as the prompt shows them — a block of their own,
 * after the source's material and before the rules, so the model can tell
 * whose words they are.
 */
export function ergaenzungsZeilen(
  ergaenzung: string | null | undefined
): string[] {
  const text = (ergaenzung ?? '').trim()
  if (text === '') return []
  return [
    '',
    'Ergaenzende Angaben der Redaktion (von der Redaktion recherchiert — verwende sie wie Fakten, aber schreibe sie NICHT der Quelle zu):',
    text
  ]
}

/** The hint that rides on every article written with additions — on the first write and on every revision. */
export function ergaenzungsHinweis(fakten: {
  ergaenzung?: string | null
}): string[] {
  return (fakten.ergaenzung ?? '').trim() === '' ? [] : [ERGAENZUNG_HINWEIS]
}

/** The editor's additions as stored with the article, or null. */
export function ergaenzungAus(datengrundlage: unknown): string | null {
  if (typeof datengrundlage !== 'object' || datengrundlage === null) return null
  const wert = (datengrundlage as { ergaenzung?: unknown }).ergaenzung
  return typeof wert === 'string' && wert.trim() !== '' ? wert : null
}

/** A hand-written article, as the revision hands it back to the model: its own facts, verbatim. */
export function eigeneAlsErgaenzung(eigene: EigeneMeldung): string {
  return [eigene.titel, eigene.lead, eigene.text]
    .map((t) => t.trim())
    .filter((t) => t !== '')
    .join('\n\n')
}

/**
 * What `datengrundlage` records about the editor's part — spread into the
 * desk's own provenance. `eigene: true` marks the origin for ever; the text
 * itself is kept as `ergaenzung` so a later revision treats it as material.
 */
export function herkunftFelder(
  beitrag: RedaktionsBeitrag
): Record<string, unknown> {
  if (beitrag.eigene !== null)
    return { eigene: true, ergaenzung: eigeneAlsErgaenzung(beitrag.eigene) }
  if (beitrag.ergaenzung !== null) return { ergaenzung: beitrag.ergaenzung }
  return {}
}

/** The checks a text of the editor's own still has to pass, plus the hint that says it is hers. */
export function eigeneWarnungen(eigene: EigeneMeldung): string[] {
  const alles = `${eigene.titel} ${eigene.lead} ${eigene.text}`
  return [...zeitWarnungen(alles), ...linkWarnungen(alles), EIGENE_HINWEIS]
}

/**
 * The row fields of a hand-written article. The source line is still the
 * code's (`mitQuelle` is the desk's own), so a hand-written article names its
 * source exactly like a written one.
 */
export function eigeneFelder(
  eigene: EigeneMeldung,
  mitQuelle: (text: string) => string
): Record<string, unknown> {
  const warnungen = eigeneWarnungen(eigene)
  return {
    titel: eigene.titel.trim(),
    lead: eigene.lead.trim(),
    text: mitQuelle(eigene.text.trim()),
    status: 'entwurf',
    verarbeitung: 'idle',
    anweisung: null,
    fehler: null,
    zeit_warnungen: warnungen.length > 0 ? warnungen : null
  }
}

/**
 * Reads the editor's part out of a route body. Pure, so the shape is tested
 * once rather than in eleven routes; the route turns a `grund` into its 400.
 */
export function leseBeitrag(
  body: unknown
):
  | { beitrag: RedaktionsBeitrag; grund: null }
  | { beitrag: null; grund: string } {
  if (body === undefined || body === null)
    return { beitrag: OHNE_BEITRAG, grund: null }
  if (typeof body !== 'object')
    return { beitrag: null, grund: 'Der Körper der Anfrage ist kein Objekt.' }
  const roh = body as { ergaenzung?: unknown; eigene?: unknown }

  let ergaenzung: string | null = null
  if (roh.ergaenzung !== undefined && roh.ergaenzung !== null) {
    if (typeof roh.ergaenzung !== 'string')
      return {
        beitrag: null,
        grund: 'Die ergänzenden Angaben müssen Text sein.'
      }
    const text = roh.ergaenzung.trim()
    if (text.length > ERGAENZUNG_MAX_ZEICHEN)
      return {
        beitrag: null,
        grund: `Die ergänzenden Angaben sind zu lang — höchstens ${ERGAENZUNG_MAX_ZEICHEN} Zeichen.`
      }
    ergaenzung = text === '' ? null : text
  }

  let eigene: EigeneMeldung | null = null
  if (roh.eigene !== undefined && roh.eigene !== null) {
    if (typeof roh.eigene !== 'object')
      return {
        beitrag: null,
        grund: 'Die eigene Meldung muss Titel, Lead und Text tragen.'
      }
    const felder = roh.eigene as Record<string, unknown>
    const feld = (name: string): string =>
      typeof felder[name] === 'string' ? (felder[name] as string).trim() : ''
    const titel = feld('titel')
    const lead = feld('lead')
    const text = feld('text')
    if (titel === '' || lead === '' || text === '')
      return {
        beitrag: null,
        grund: 'Eine eigene Meldung braucht Titel, Lead und Text.'
      }
    if (titel.length > TITEL_MAX_ZEICHEN)
      return {
        beitrag: null,
        grund: `Der Titel ist zu lang — höchstens ${TITEL_MAX_ZEICHEN} Zeichen.`
      }
    eigene = { titel, lead, text }
  }

  if (eigene !== null && ergaenzung !== null)
    return {
      beitrag: null,
      grund:
        'Entweder ergänzende Angaben oder eine eigene Meldung — nicht beides.'
    }
  return { beitrag: { ergaenzung, eigene }, grund: null }
}
