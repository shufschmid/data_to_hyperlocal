import type { OdsFetch } from '../ods'

// The Bund's result of a federal vote day — only whether each Vorlage was
// accepted, for the one thing the newsroom wants from it: «anders als die
// Schweiz» (27 September 2026). The national figures are deliberately not
// read into any article; the newsletter reports them elsewhere.
//
// The door is the Federal Chancellery's open-government data for vote days
// (opendata.swiss, «Echtzeitdaten am Abstimmungstag»): one static JSON file
// per vote day at `ogd-static.voteinfo-app.ch`, no key. Measured on the same
// afternoon: `vorlageAngenommen` stays null until `vorlageBeendet` is true,
// and the German titles are the canton's own titles word for word, which is
// what the pairing below rests on.
//
// Before a Vorlage is finished the file already carries the INTERIM count —
// the Ja share so far and the Stände counted so far. The newsroom decided on
// 27 September 2026 that the summary is written as soon as Baselland is
// complete, with the Bund's interim tendency and a warning: whether it is
// clear enough is the journalist's call, and it usually is. `tendenz` is that
// tendency, and `beendet: false` is what the warning is built from.

/** Where the files live — a row setting (`konfiguration.abstimmungen_bund`), this is the measured value. */
export const BUND_BASIS = 'https://ogd-static.voteinfo-app.ch/v1/ogd'

export function bundUrl(basis: string, datum: string): string {
  return `${basis}/sd-t-17-02-${datum.replace(/-/g, '')}-eidgAbstimmung.json`
}

export interface BundVorlage {
  titel: string
  /** Final once `beendet`; before that the interim tendency, or null when it is a tie. */
  angenommen: boolean | null
  beendet: boolean
  /** Ja share of the Swiss count so far. */
  jaProzent: number | null
  /** Stände counted so far, half cantons as halves; null without Ständemehr. */
  staendeJa: number | null
  staendeNein: number | null
  /** The file's own timestamp — when the interim count was taken. */
  stand: string | null
}

function zahl(wert: unknown): number | null {
  return typeof wert === 'number' && Number.isFinite(wert) ? wert : null
}

/**
 * The interim outcome: the popular vote, and where the Vorlage needs it the
 * Stände counted so far. Null while either majority is a tie.
 */
export function tendenz(
  jaProzent: number | null,
  staendeJa: number | null,
  staendeNein: number | null
): boolean | null {
  if (jaProzent === null || jaProzent === 50) return null
  const volk = jaProzent > 50
  if (staendeJa === null || staendeNein === null) return volk
  if (staendeJa === staendeNein) return volk ? null : false
  return volk && staendeJa > staendeNein
}

/** Compared without case, quotes, punctuation or spacing — the canton and the Bund print the same words. */
export function titelSchluessel(titel: string): string {
  return titel
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

export function parseBund(payload: unknown): BundVorlage[] {
  const datei = payload as {
    timestamp?: unknown
    schweiz?: { vorlagen?: unknown }
  } | null
  const vorlagen = datei?.schweiz?.vorlagen
  if (!Array.isArray(vorlagen)) return []
  const stand = typeof datei?.timestamp === 'string' ? datei.timestamp : null
  const liste: BundVorlage[] = []
  for (const v of vorlagen as Array<Record<string, unknown>>) {
    const titel = Array.isArray(v['vorlagenTitel'])
      ? (
          v['vorlagenTitel'] as Array<{ langKey?: unknown; text?: unknown }>
        ).find((t) => t.langKey === 'de')?.text
      : undefined
    if (typeof titel !== 'string' || titel.trim() === '') continue
    const beendet = v['vorlageBeendet'] === true
    const angenommen = v['vorlageAngenommen']
    const resultat = (v['resultat'] ?? {}) as Record<string, unknown>
    const staende = (v['staende'] ?? {}) as Record<string, unknown>
    const jaProzent = zahl(resultat['jaStimmenInProzent'])
    const mitStaenden = v['doppeltesMehr'] === true
    const ja = mitStaenden
      ? (zahl(staende['jaStaendeGanz']) ?? 0) +
        (zahl(staende['jaStaendeHalb']) ?? 0) / 2
      : null
    const nein = mitStaenden
      ? (zahl(staende['neinStaendeGanz']) ?? 0) +
        (zahl(staende['neinStaendeHalb']) ?? 0) / 2
      : null
    liste.push({
      titel: titel.trim(),
      beendet,
      angenommen:
        beendet && typeof angenommen === 'boolean'
          ? angenommen
          : tendenz(jaProzent, ja, nein),
      jaProzent,
      staendeJa: ja,
      staendeNein: nein,
      stand
    })
  }
  return liste
}

/** The Bund's Vorlage with the same title, or null — never paired by position. */
export function bundFuer(
  titel: string,
  liste: readonly BundVorlage[]
): BundVorlage | null {
  const schluessel = titelSchluessel(titel)
  return liste.find((v) => titelSchluessel(v.titel) === schluessel) ?? null
}

/** The day's federal Vorlagen, or null when the Bund publishes no file for that day (no federal vote). */
export async function liesBund(
  basis: string,
  datum: string,
  doFetch: OdsFetch
): Promise<BundVorlage[] | null> {
  const antwort = await doFetch(bundUrl(basis, datum))
  if (antwort.status === 404) return null
  if (!antwort.ok)
    throw new Error(`voteinfo-app.ch antwortete ${antwort.status}`)
  return parseBund(await antwort.json())
}
