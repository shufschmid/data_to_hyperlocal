import { gql } from '@apollo/client'

// Companion query for the manual-processing view (Punkt6DossiersPanel), mirroring
// graphql/dossiers.ts for the punkt6_dossiers collection.

export interface Punkt6DossierFields {
  id: string
  status: string
  source_subject: string | null
  error_message: string | null
  date_created: string | null
}

export interface Punkt6DossiersQueryResult {
  punkt6_dossiers: Punkt6DossierFields[]
}

export const PUNKT6_DOSSIERS_QUERY = gql`
  query Punkt6Dossiers($limit: Int = 25) {
    punkt6_dossiers(limit: $limit, sort: ["-date_created"], filter: { status: { _neq: "processed" } }) {
      id
      status
      source_subject
      error_message
      date_created
    }
  }
`
