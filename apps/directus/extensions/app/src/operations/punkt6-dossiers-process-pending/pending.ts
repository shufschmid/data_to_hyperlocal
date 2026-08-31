export interface PendingDossierCandidate {
  id: string
}

/**
 * Picks the punkt6_dossiers a scheduled run should process: those still
 * pending, capped at `limit`. Mirrors dossiers-process-pending/pending.ts's
 * shape - the filtering itself is trivial here (the DB query already filters
 * on status='pending'), but keeping the cap in a pure, tested function rather
 * than inline in api.ts is what makes "what counts as this run's batch"
 * independently verifiable.
 */
export function selectPendingDossiers(
  candidates: PendingDossierCandidate[],
  limit: number
): PendingDossierCandidate[] {
  const safeLimit = Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : 5
  return candidates.slice(0, safeLimit)
}
