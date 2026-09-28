import type { MetadataRoute } from 'next'
import { PUBLIC_INDEXABLE_PATHS, SITE_URL } from '@/lib/site'
import { createAnonClient } from '@/lib/supabase/anon'
import { listPublicDispatches, publicDispatchUrl } from '@/lib/public-dispatches'

// Public pages, plus every Dispatch that is "Public on the web" RIGHT NOW
// (list_public_dispatches — the same gate as the article page). Built per
// request so a Dispatch made members-only, hidden, unpublished or deleted
// leaves the sitemap at once. lastModified = the last real title/body
// change, else first publication. Never member content or share links.
// (One sitemap covers up to 50,000 URLs; the SQL caps the list below
// that. Past it, split into a sitemap index via generateSitemaps.)
export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages: MetadataRoute.Sitemap = PUBLIC_INDEXABLE_PATHS.map((path) => ({ url: `${SITE_URL}${path}` }))
  let dispatches: Awaited<ReturnType<typeof listPublicDispatches>> = []
  try {
    dispatches = await listPublicDispatches(createAnonClient())
  } catch {
    // No database / not configured: the public pages alone, never an error page.
  }
  return [
    ...pages,
    ...dispatches.map((d) => ({ url: publicDispatchUrl(d.slug), lastModified: d.lastModified })),
  ]
}
