import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  reactStrictMode: true,

  // Produces .next/standalone — a self-contained server with only the modules it
  // actually needs. The Dockerfile copies that instead of node_modules.
  output: 'standalone',

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
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }
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
