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

/** Where the files live — a row setting (`konfiguration.abstimmungen_bund`), this is the measured value. */
export const BUND_BASIS = 'https://ogd-static.voteinfo-app.ch/v1/ogd'

export function bundUrl(basis: string, datum: string): string {
  return `${basis}/sd-t-17-02-${datum.replace(/-/g, '')}-eidgAbstimmung.json`
}

export interface BundVorlage {
  titel: string
  angenommen: boolean | null
  beendet: boolean
}

/** Compared without case, quotes, punctuation or spacing — the canton and the Bund print the same words. */
export function titelSchluessel(titel: string): string {
  return titel
    .normalize('NFC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

export function parseBund(payload: unknown): BundVorlage[] {
  const vorlagen = (payload as { schweiz?: { vorlagen?: unknown } } | null)
    ?.schweiz?.vorlagen
  if (!Array.isArray(vorlagen)) return []
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
    liste.push({
      titel: titel.trim(),
      beendet,
      angenommen: beendet && typeof angenommen === 'boolean' ? angenommen : null
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
