import type { MetadataRoute } from 'next'
import { PUBLIC_INDEXABLE_PATHS, SITE_URL } from '@/lib/site'

// Pre-beta security F-09 — public pages only; never member content.
export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_INDEXABLE_PATHS.map((path) => ({ url: `${SITE_URL}${path}` }))
}
