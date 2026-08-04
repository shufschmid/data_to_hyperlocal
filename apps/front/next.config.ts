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
      }
    ]
  }
}

export default nextConfig
