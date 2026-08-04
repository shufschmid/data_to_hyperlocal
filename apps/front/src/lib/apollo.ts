'use client'

import { ApolloClient, HttpLink, InMemoryCache } from '@apollo/client'

// Apollo talks to our own /api/graphql route, never to Directus directly. The
// Directus URL and the session token stay on the server; the browser only knows a
// same-origin path.
export function makeApolloClient(): ApolloClient {
  return new ApolloClient({
    link: new HttpLink({ uri: '/api/graphql' }),
    cache: new InMemoryCache()
  })
}

// Apollo Client 4 requires default options to be declared through a module
// augmentation before they can be set on the client, so fetch policies are passed
// per hook instead — see NOTES_FETCH_POLICY below.
// https://www.apollographql.com/docs/react/data/typescript#declaring-default-options-for-type-safety
export const LIVE_FETCH_POLICY = 'cache-and-network' as const
