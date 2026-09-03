import type { Metadata, Viewport } from 'next'
import InitColorSchemeScript from '@mui/material/InitColorSchemeScript'
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter'
import { Providers } from './providers'

export const metadata: Metadata = {
  title: 'App',
  description: 'Directus + Next + MUI Anwendung',
  /**
   * Inherited by every page, the public blog included: nothing here belongs in
   * a search index. The blog is unlisted, not secret — reachable for whoever
   * has the address.
   *
   * Doubled with the `X-Robots-Tag` header in `next.config.ts` on purpose. The
   * header also covers what has no HTML head, the tag is the form a person
   * sees when they look at the page source, and both say the same thing.
   * `googleBot` is spelled out because Google reads its own directive where it
   * finds one, and a future `max-image-preview` for the generic crawler must
   * not quietly re-enable indexing for Google.
   */
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false }
  }
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1
}

// The root layout is a server component. Two MUI pieces have to be here:
//   - AppRouterCacheProvider collects Emotion's styles during the server render, so
//     the first paint is already styled (no flash of unstyled content).
//   - InitColorSchemeScript sets the light/dark attribute before React hydrates, so
//     dark mode does not flash white on load.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de" suppressHydrationWarning>
      <body>
        <InitColorSchemeScript attribute="data-mui-color-scheme" />
        <AppRouterCacheProvider options={{ enableCssLayer: true }}>
          <Providers>{children}</Providers>
        </AppRouterCacheProvider>
      </body>
    </html>
  )
}
