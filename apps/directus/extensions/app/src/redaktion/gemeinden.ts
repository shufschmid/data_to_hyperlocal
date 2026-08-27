import type { OdsRecord } from '../shared/ods'
import type { Gemeinde } from '../types/schema'

// Turning portal rows into per-municipality data, and — just as important —
// finding out which municipalities have no data at all.
//
// Entity type names mirror the collections they describe (`Gemeinde`), because
// that is the vocabulary the admin UI and the Dorfkönig API speak. Everything
// else is English, per the convention in the root CLAUDE.md.

/**
 * Normalises a BFS number from either side of the join.
 *
 * The portal types `bfs_gemeindenummer` as `text`, so it arrives as "2761",
 * while our own column is an integer. Leading zeros and stray whitespace show
 * up in exports often enough to be worth handling here rather than at four call
 * sites.
 */
export function normalizeBfs(value: unknown): number | null {
  if (typeof value === 'number') return Number.isInteger(value) ? value : null
  if (typeof value !== 'string') return null

  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null

  const parsed = Number.parseInt(trimmed, 10)
  return Number.isNaN(parsed) ? null : parsed
}

/** "Aesch (BL)" and " aesch " are the same municipality. */
export function normalizeName(value: unknown): string {
  if (typeof value !== 'string') return ''
  return value
    .replace(/\s*\((BL|BS|SO|AG|JU)\)\s*$/i, '')
    .trim()
    .toLowerCase()
}

export interface MunicipalityRows {
  gemeinde: Gemeinde
  rows: OdsRecord[]
}

export interface Coverage {
  /** Municipalities that have rows, in the order the municipalities were given. */
  matched: MunicipalityRows[]
  /** Municipalities with no row in this slice. They get no article at all. */
  missing: Gemeinde[]
  /** BFS numbers in the data that we do not know. Foreign municipalities, usually. */
  unknown: number[]
}

/**
 * Groups portal rows by municipality.
 *
 * Matching is on the BFS number and never on the label. Six of the 86
 * Basel-Landschaft municipalities carry a canton suffix in the portal's
 * `gemeinde` column — "Aesch (BL)", "Oberwil (BL)", "Reinach (BL)",
 * "Kilchberg (BL)", "Rickenbach (BL)", "Oberdorf (BL)" — so a name join would
 * quietly drop them and produce a run that is short six articles with nothing
 * in the log to say why.
 */
export function matchMunicipalities(
  rows: OdsRecord[],
  gemeinden: readonly Gemeinde[],
  bfsField: string
): Coverage {
  const byBfs = new Map<number, OdsRecord[]>()
  const unknown = new Set<number>()
  const known = new Set(gemeinden.map((gemeinde) => gemeinde.bfs_nummer))

  // Only consulted when the identity column holds names rather than numbers,
  // which happens when an editor points us at a dataset the portal does not
  // annotate. Still not a name join in disguise: the canton suffix is stripped
  // here, once, so "Aesch (BL)" and "Aesch" are the same municipality instead
  // of six silently missing articles.
  const nachName = new Map(
    gemeinden.map((gemeinde) => [
      normalizeName(gemeinde.name),
      gemeinde.bfs_nummer
    ])
  )

  for (const row of rows) {
    const bfs =
      normalizeBfs(row[bfsField]) ??
      nachName.get(normalizeName(row[bfsField])) ??
      null
    if (bfs === null) continue

    if (!known.has(bfs)) {
      unknown.add(bfs)
      continue
    }

    const existing = byBfs.get(bfs)
    if (existing === undefined) byBfs.set(bfs, [row])
    else existing.push(row)
  }

  const matched: MunicipalityRows[] = []
  const missing: Gemeinde[] = []

  for (const gemeinde of gemeinden) {
    const rowsForMunicipality = byBfs.get(gemeinde.bfs_nummer)
    if (rowsForMunicipality === undefined || rowsForMunicipality.length === 0) {
      missing.push(gemeinde)
    } else {
      matched.push({ gemeinde, rows: rowsForMunicipality })
    }
  }

  return {
    matched,
    missing,
    unknown: [...unknown].sort((a, b) => a - b)
  }
}

/**
 * Whether a run should go ahead at all.
 *
 * A dataset can carry a municipality column and still have no rows for a given
 * municipality in the newest period. Writing an article anyway is how a language
 * model ends up inventing numbers, so municipalities without data get no article
 * — not an empty one, and not a draft to be filled in later.
 */
export function hasUsableCoverage(coverage: Coverage): boolean {
  return coverage.matched.length > 0
}

/** A line for the run log, so a short run explains itself without a debugger. */
export function describeCoverage(coverage: Coverage): string {
  const parts = [`${coverage.matched.length} Gemeinden mit Daten`]

  if (coverage.missing.length > 0) {
    parts.push(
      `ohne Daten: ${coverage.missing.map((gemeinde) => gemeinde.name).join(', ')}`
    )
  }
  if (coverage.unknown.length > 0) {
    parts.push(
      `${coverage.unknown.length} unbekannte BFS-Nummern uebersprungen`
    )
  }

  return parts.join(' — ')
}

/**
 * Picks the newest period in a slice.
 *
 * Values are compared as strings on purpose: the portal's period columns are
 * "2025" or "2026-06-14", and both sort correctly that way while a Date parse
 * would turn "2025" into the first of January and lose the distinction.
 */
export function latestPeriod(
  rows: OdsRecord[],
  periodField: string
): string | null {
  let latest: string | null = null

  for (const row of rows) {
    const value = row[periodField]
    if (typeof value !== 'string' || value.trim() === '') continue
    if (latest === null || value > latest) latest = value
  }

  return latest
}
