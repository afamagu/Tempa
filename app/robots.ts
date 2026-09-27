import type { MetadataRoute } from 'next'
import { PUBLIC_INDEXABLE_PATHS, SITE_URL } from '@/lib/site'

// Pre-beta security F-09 — crawl hygiene only, never an access control
// (every private route is protected server-side regardless). Allow-list:
// the public pages are allowed, everything else is disallowed, so no
// private route has to be named here.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: [...PUBLIC_INDEXABLE_PATHS],
      disallow: '/',
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
