import { gql } from '@apollo/client'

// GraphQL documents live here, one file per collection — not inline in components.
// That keeps every query the app can issue findable in one place, and lets
// `npm run codegen` generate types from them.
//
// Directus derives this API from the data model: a collection `notes` gives you
// `notes`, `notes_by_id`, `create_notes_item(s)`, `update_notes_item(s)` and
// `delete_notes_item(s)`. Explore it at http://localhost:8055/graphql.

export interface NoteFields {
  id: string
  title: string
  body: string | null
  status: string
  ai_summary: string | null
  /** A `cast-csv` column in Directus, so GraphQL hands it over as a list. */
  ai_summary_tags: string[] | null
  ai_summary_generated_at: string | null
  date_created: string | null
}

export interface NotesQueryResult {
  notes: NoteFields[]
}

export const NOTES_QUERY = gql`
  query Notes($limit: Int = 25) {
    notes(limit: $limit, sort: ["-date_created"]) {
      id
      title
      body
      status
      ai_summary
      ai_summary_tags
      ai_summary_generated_at
      date_created
    }
  }
`

export interface CreateNoteResult {
  create_notes_item: { id: string } | null
}

export const CREATE_NOTE_MUTATION = gql`
  mutation CreateNote($title: String!, $body: String, $status: String!) {
    create_notes_item(data: { title: $title, body: $body, status: $status }) {
      id
    }
  }
`

export interface DeleteNoteResult {
  delete_notes_item: { id: string } | null
}

export const DELETE_NOTE_MUTATION = gql`
  mutation DeleteNote($id: ID!) {
    delete_notes_item(id: $id) {
      id
    }
  }
`
