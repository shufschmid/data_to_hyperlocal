import { gql } from '@apollo/client'

// Companion query for the manual-processing view (DossiersPanel): dossiers that
// are not yet fully processed, so an editor can see what's pending/failed and
// trigger processing without waiting for the scheduled Flow.

export interface DossierFields {
  id: string
  status: string
  source_subject: string | null
  error_message: string | null
  date_created: string | null
}

export interface DossiersQueryResult {
  dossiers: DossierFields[]
}

export const DOSSIERS_QUERY = gql`
  query Dossiers($limit: Int = 25) {
    dossiers(limit: $limit, sort: ["-date_created"], filter: { status: { _neq: "processed" } }) {
      id
      status
      source_subject
      error_message
      date_created
    }
  }
`
