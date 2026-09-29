// What the newsroom sets on a desk: how much reaches it, and how far ahead.
//
// The Sichtung GRADES (1–4, `sichtung.ts`); whether a grade is a proposal is
// the newsroom's appetite — the threshold — and, on the events desk, how many
// days before its anchor a row of that grade is put forward. Both are rows
// in `tischeinstellungen`, one per desk, editable behind the gear, and read
// by the run and the workspace alike. Decided on 29 September 2026: a yes/no
// answer had no dial, and in a quiet week (holidays) the desk wants more
// without anyone rewriting a prompt.
//
// Everything here is pure except the loader; a missing or broken row is the
// STANDARD, said in the log, never a crashed run.

import {
  DAUERANGEBOTE_JE_WOCHE,
  imVorschlagsfenster,
  VORSCHLAGSFENSTER_TAGE
} from '../shared/veranstaltung/anker'

export type Stufe = 1 | 2 | 3 | 4

/** How a grade reads on the desk and in the log. */
export const STUFEN_TEXT: Record<Stufe, string> = {
  4: 'wichtig',
  3: 'klare Meldung',
  2: 'moeglich',
  1: 'Routine'
}

export type EinstellbarerTisch = 'gemeinde' | 'veranstaltung'
export const EINSTELLBARE_TISCHE: readonly EinstellbarerTisch[] = [
  'gemeinde',
  'veranstaltung'
]

export interface Tischeinstellung {
  /** From this grade up a row is a proposal. */
  schwelle: Stufe
  /** Days before the anchor a row of that grade reaches the desk — events only. */
  vorlauf: Record<2 | 3 | 4, number>
  /** Routines put forward as Dauerangebot per municipality and week. */
  dauerangebote_je_woche: number
}

export const STANDARD_EINSTELLUNG: Tischeinstellung = {
  schwelle: 3,
  vorlauf: { 4: 30, 3: VORSCHLAGSFENSTER_TAGE, 2: 5 },
  dauerangebote_je_woche: DAUERANGEBOTE_JE_WOCHE
}

/** The row as the collection holds it. */
export interface TischeinstellungZeile {
  schwelle: number | null
  vorlauf_stufe4: number | null
  vorlauf_stufe3: number | null
  vorlauf_stufe2: number | null
  dauerangebote_je_woche: number | null
}

export function stufeAus(wert: unknown): Stufe | null {
  return wert === 1 || wert === 2 || wert === 3 || wert === 4 ? wert : null
}

function ganzzahl(wert: unknown, von: number, bis: number): number | null {
  if (typeof wert === 'string' && wert.trim() !== '') wert = Number(wert)
  if (typeof wert !== 'number' || !Number.isInteger(wert)) return null
  return wert < von || wert > bis ? null : wert
}

/** Reads a row into a setting; anything missing or out of range falls back to the standard. */
export function tischeinstellungAus(
  zeile: Partial<TischeinstellungZeile> | null | undefined,
  standard: Tischeinstellung = STANDARD_EINSTELLUNG
): Tischeinstellung {
  if (zeile == null) return standard
  return {
    schwelle: stufeAus(zeile.schwelle) ?? standard.schwelle,
    vorlauf: {
      4: ganzzahl(zeile.vorlauf_stufe4, 0, 120) ?? standard.vorlauf[4],
      3: ganzzahl(zeile.vorlauf_stufe3, 0, 120) ?? standard.vorlauf[3],
      2: ganzzahl(zeile.vorlauf_stufe2, 0, 120) ?? standard.vorlauf[2]
    },
    dauerangebote_je_woche:
      ganzzahl(zeile.dauerangebote_je_woche, 0, 7) ??
      standard.dauerangebote_je_woche
  }
}

/** A graded row is a proposal from the threshold up; an ungraded one never by this rule. */
export function istVorschlag(wert: number | null, schwelle: number): boolean {
  return wert !== null && wert >= schwelle
}

/**
 * Days ahead for a grade. Grade 1 is never a proposal above threshold 1, so
 * it takes the shortest lead; an ungraded row keeps the desk's normal lead.
 */
export function vorlaufFuer(
  wert: number | null,
  einstellung: Tischeinstellung
): number {
  if (wert === 4) return einstellung.vorlauf[4]
  if (wert === 2 || wert === 1) return einstellung.vorlauf[2]
  return einstellung.vorlauf[3]
}

export function imVorlauf(
  ankerAm: string | null,
  wert: number | null,
  heute: string,
  einstellung: Tischeinstellung
): boolean {
  return imVorschlagsfenster(ankerAm, heute, vorlaufFuer(wert, einstellung))
}

/** The events desk's rule: graded high enough AND inside the lead of that grade. */
export function anlassVorschlag(
  zeile: { vorschlag_wert: number | null; anker_am: string | null },
  heute: string,
  einstellung: Tischeinstellung
): boolean {
  return (
    istVorschlag(zeile.vorschlag_wert, einstellung.schwelle) &&
    imVorlauf(zeile.anker_am, zeile.vorschlag_wert, heute, einstellung)
  )
}

const SPALTEN: ReadonlyArray<{
  feld: keyof TischeinstellungZeile
  von: number
  bis: number
  name: string
}> = [
  { feld: 'schwelle', von: 1, bis: 4, name: 'Schwelle' },
  { feld: 'vorlauf_stufe4', von: 0, bis: 120, name: 'Vorlauf Stufe 4' },
  { feld: 'vorlauf_stufe3', von: 0, bis: 120, name: 'Vorlauf Stufe 3' },
  { feld: 'vorlauf_stufe2', von: 0, bis: 120, name: 'Vorlauf Stufe 2' },
  {
    feld: 'dauerangebote_je_woche',
    von: 0,
    bis: 7,
    name: 'Dauerangebote je Woche'
  }
]

/**
 * The columns a POST may set, validated; throws German for the form. Only the
 * keys present are returned, so a partial body changes only what it names.
 */
export function tischeinstellungFelder(
  koerper: Record<string, unknown>
): Partial<TischeinstellungZeile> {
  const felder: Partial<TischeinstellungZeile> = {}
  for (const spalte of SPALTEN) {
    if (!(spalte.feld in koerper)) continue
    const wert = ganzzahl(koerper[spalte.feld], spalte.von, spalte.bis)
    if (wert === null)
      throw new Error(
        `${spalte.name} muss eine ganze Zahl zwischen ${spalte.von} und ${spalte.bis} sein.`
      )
    felder[spalte.feld] = wert
  }
  if (Object.keys(felder).length === 0)
    throw new Error('Keine Einstellung angegeben.')
  return felder
}

export function istEinstellbarerTisch(
  wert: unknown
): wert is EinstellbarerTisch {
  return (
    typeof wert === 'string' &&
    (EINSTELLBARE_TISCHE as readonly string[]).includes(wert)
  )
}

interface LeseDienst {
  readByQuery(query: Record<string, unknown>): Promise<unknown[]>
}

/**
 * The desk's setting, or the standard when there is no row yet or the table
 * is not there (a run before the schema push) — said in the log, never a
 * crashed run over a dial.
 */
export async function ladeTischeinstellung(
  dienst: LeseDienst,
  tisch: EinstellbarerTisch,
  logger: { warn: (...args: unknown[]) => void },
  standard: Tischeinstellung = STANDARD_EINSTELLUNG
): Promise<Tischeinstellung> {
  try {
    const [zeile] = (await dienst.readByQuery({
      filter: { tisch: { _eq: tisch } },
      fields: [
        'schwelle',
        'vorlauf_stufe4',
        'vorlauf_stufe3',
        'vorlauf_stufe2',
        'dauerangebote_je_woche'
      ],
      limit: 1
    })) as Array<Partial<TischeinstellungZeile>>
    return tischeinstellungAus(zeile, standard)
  } catch (fehler) {
    logger.warn(
      fehler,
      `tischeinstellungen: ${tisch} nicht lesbar — Standard (Schwelle ${standard.schwelle}).`
    )
    return standard
  }
}
