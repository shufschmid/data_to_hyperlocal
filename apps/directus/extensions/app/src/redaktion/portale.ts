// What a statistics portal says about itself, beyond its address.
//
// The statistics feed is the one feed of the nine that is CANTONAL. The other
// eight are not: the gazette portal carries every canton and the Confederation,
// the municipal-website reader recognises a CMS family rather than a host, the
// weekly papers are read per platform, the sports connectors are national, and
// waste calendars and broadcasts are registered per municipality. So a second
// medium needs exactly one thing the code used to hard-wire: which portal its
// figures come from, and whose office to name for them.
//
// Both answers already belong to a row in `quellen` — `basis_url` is the
// address and `konfiguration` ("Adapterspezifische Optionen") is where the rest
// goes. Deliberately NOT a second column on `datensaetze` and NOT an
// environment variable: a dataset already knows its portal through its source,
// and the daily catalogue check already walks the sources one by one. A portal
// listed in a variable but missing from the table — or the other way round —
// would be a second truth about the same thing, and the two would disagree on
// the day it mattered.
//
// The same pattern as `gemeinden.simap_vergabestellen`: newsroom-maintained
// JSON in the admin UI, parsed by one tolerant function that never throws,
// because a malformed blob must cost a source line and not a run.

export interface PortalKonfiguration {
  /**
   * The office to name in an article's source sentence.
   *
   * Null means "not configured", and the caller falls back to the Baselland
   * office rather than inventing one. Naming the wrong statistical office in a
   * published article is the same class of error as a wrong source link: a
   * reader cannot see it and cannot check it.
   */
  amt: string | null
  /**
   * The `gemeinden.bezirk` values this portal carries figures for.
   *
   * Empty is a real answer and means "covers nothing declared". Silence is not
   * a promise — a portal that has not said which municipalities it serves must
   * not be shown to an editor as if it served hers.
   */
  bezirke: readonly string[]
}

const LEER: PortalKonfiguration = { amt: null, bezirke: [] }

function feld(konfiguration: unknown, name: string): unknown {
  // Arrays are objects too, and an array here is a misconfiguration, not a map.
  if (typeof konfiguration !== 'object' || konfiguration === null)
    return undefined
  if (Array.isArray(konfiguration)) return undefined
  return (konfiguration as Record<string, unknown>)[name]
}

/** Reads `quellen.konfiguration`. Never throws — a broken blob reads as empty. */
export function lesePortalKonfiguration(
  konfiguration: unknown
): PortalKonfiguration {
  if (typeof konfiguration !== 'object' || konfiguration === null) return LEER
  if (Array.isArray(konfiguration)) return LEER

  const rohesAmt = feld(konfiguration, 'amt')
  const amt =
    typeof rohesAmt === 'string' && rohesAmt.trim() !== ''
      ? rohesAmt.trim()
      : null

  const roheBezirke = feld(konfiguration, 'bezirke')
  const bezirke = Array.isArray(roheBezirke)
    ? roheBezirke
        .filter((eintrag): eintrag is string => typeof eintrag === 'string')
        .map((eintrag) => eintrag.trim())
        .filter((eintrag) => eintrag !== '')
    : []

  return { amt, bezirke }
}

/** Whether this portal carries figures for a municipality of that district. */
export function bedientBezirk(
  konfiguration: PortalKonfiguration,
  bezirk: string
): boolean {
  const gesucht = bezirk.trim().toLowerCase()
  if (gesucht === '') return false
  return konfiguration.bezirke.some(
    (eintrag) => eintrag.toLowerCase() === gesucht
  )
}
