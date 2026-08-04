'use client'

import { useState, type ReactNode } from 'react'
import { ApolloProvider } from '@apollo/client/react'
import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider } from '@mui/material/styles'
import { makeApolloClient } from '@/lib/apollo'
import { theme } from '@/lib/theme'

// Client-side context for the whole app: Apollo and the MUI theme.
//
// The Apollo client is created inside `useState` so each browser session gets its
// own cache and a server render never shares one between requests.
export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(makeApolloClient)

  return (
    <ApolloProvider client={client}>
      <ThemeProvider theme={theme} defaultMode="system">
        <CssBaseline enableColorScheme />
        {children}
      </ThemeProvider>
    </ApolloProvider>
  )
}
