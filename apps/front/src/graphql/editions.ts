import { gql } from '@apollo/client'

// GraphQL documents live here, one file per collection - not inline in a
// component. Directus derives this API from the data model: collection
// `editions` gives `editions`, `editions_by_id`, `update_editions_item(s)`, etc.
// Explore it at http://localhost:8055/graphql.

export interface TranscriptParagraph {
  timestamp: string
  seconds: number
  text: string
}

export interface ExtraTopic {
  headline: string
  paragraphTimestamp: string | null
  paragraphSeconds: number | null
  summary: string | null
}

export interface EditionFields {
  id: string
  broadcast_date: string
  edition_label: string | null
  broadcast_at: string | null
  headline: string
  lead: string | null
  /** A `cast-json` column, so GraphQL hands it over as a real array, not a string to parse. */
  teaser_blocks: string[] | null
  audio_url: string | null
  transcript: TranscriptParagraph[] | null
  extra_topics: ExtraTopic[] | null
}

export interface EditionsQueryResult {
  editions: EditionFields[]
}

export const EDITIONS_QUERY = gql`
  query Editions($limit: Int = 50) {
    editions(limit: $limit, sort: ["-broadcast_at", "-date_created"]) {
      id
      broadcast_date
      edition_label
      broadcast_at
      headline
      lead
      teaser_blocks
      audio_url
      transcript
      extra_topics
    }
  }
`
