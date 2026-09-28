import type { MetadataRoute } from 'next'
import { PUBLIC_INDEXABLE_PATHS, SITE_URL } from '@/lib/site'
import { PUBLIC_DISPATCH_PATH } from '@/lib/public-dispatches'

// Pre-beta security F-09 — crawl hygiene only, never an access control
// (every private route is protected server-side regardless). Allow-list:
// the public pages are allowed, everything else is disallowed, so no
// private route has to be named here.
//
// Public Dispatch web pages: /dispatches/ (articles + their generated
// share images) and /_next/ (the scripts/styles/images a crawler needs to
// render them) are allowed. Share links (/d/…) stay disallowed/noindex.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: [...PUBLIC_INDEXABLE_PATHS, `${PUBLIC_DISPATCH_PATH}/`, '/_next/'],
      disallow: '/',
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
