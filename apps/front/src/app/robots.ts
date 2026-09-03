import type { MetadataRoute } from 'next'

/**
 * robots.txt — and it deliberately does NOT forbid crawling.
 *
 * The goal is that nothing of this application appears in a search index while
 * the blog stays reachable for anyone who knows its address. The instruction
 * that achieves that is `noindex`, sent as a header for every route
 * (`next.config.ts`) and as a meta tag in the page head (`layout.tsx`).
 *
 * A `Disallow: /` here would WORK AGAINST that, and this is the trap worth
 * writing down: robots.txt governs CRAWLING, `noindex` governs INDEXING. A
 * crawler that is turned away at robots.txt never reads the `noindex` — and
 * Google documents that it may still list such a URL (without content) when
 * something links to it. Blocking the door is what leaves the address in the
 * index; letting the crawler in to read "do not index me" is what keeps it out.
 *
 * No sitemap either: a sitemap is an invitation, and nothing here is inviting.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        // Empty disallow = nothing is off limits. The pages themselves say
        // `noindex`, and the crawler has to be able to read that.
        disallow: [],
        allow: '/'
      }
    ]
  }
}
