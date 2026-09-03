import path from 'node:path'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Produces .next/standalone — a self-contained server with only the modules it
  // actually needs. The Dockerfile copies that instead of node_modules.
  output: 'standalone',

  // The monorepo root also carries a lockfile, and when Turbopack infers THAT as
  // the workspace root, the catch-all API route ([...pfad]) silently 404s in
  // dev. This app is its own root — no hoisting, own lockfile (root CLAUDE.md).
  turbopack: {
    root: path.join(__dirname)
  },

  async headers() {
    return [
      {
        // Every route under /api is session-dependent. A cached API response here
        // means one user seeing another user's data.
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, max-age=0' }]
      },
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // Nothing here belongs in a search index. The workspace needs a login
          // anyway, and the blog is deliberately unlisted: reachable for anyone
          // who has the address, not something a search turns up.
          //
          // As a HEADER, not only as a meta tag: it also covers what carries no
          // HTML head — a JSON answer, a file — and it is the form Google and
          // Bing document for exactly this. `noarchive` additionally keeps a
          // cached copy from outliving a withdrawn article.
          //
          // This works ONLY because robots.txt lets crawlers in (see
          // src/app/robots.ts). A `Disallow` there would stop them reading this
          // header, and a page they cannot read is one they may list from
          // someone else's link — the opposite of what is wanted.
          { key: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive' }
        ]
      },
      {
        // The approval link carries its credential in the URL, so this page must
        // never hand that URL anywhere else — not to an embedded image host, not
        // to a link the reader follows from here. The site-wide policy above
        // would still send the origin; here even that is too much.
        //
        // This block sits *after* the general one on purpose. Next does not stop
        // at the first match: it applies every rule that matches, and for a
        // repeated key the later one wins. Putting the specific rule first looks
        // right and silently loses.
        source: '/freigabe/:path*',
        headers: [
          { key: 'Referrer-Policy', value: 'no-referrer' },
          { key: 'X-Robots-Tag', value: 'noindex, nofollow' }
        ]
      }
    ]
  }
}

export default nextConfig
