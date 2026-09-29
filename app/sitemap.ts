import type { MetadataRoute } from 'next'
import { PUBLIC_INDEXABLE_PATHS, SITE_URL } from '@/lib/site'
import { createAnonClient } from '@/lib/supabase/anon'
import { listPublicDispatches, publicDispatchUrl } from '@/lib/public-dispatches'
import {
  listPublicDispatchTopics,
  publicTopicIsIndexable,
  publicTopicUrl,
} from '@/lib/public-dispatch-discovery'

// Public pages, every Dispatch that is "Public on the web" RIGHT NOW,
// and sufficiently populated public topic collections. Both Dispatch
// data sources use the same database visibility predicate as the article
// page. Built per request so a Dispatch made members-only, hidden,
// unpublished or deleted leaves discovery on the next response.
//
// One sitemap covers up to 50,000 URLs; the article SQL caps its list
// below that. Past it, split into a sitemap index via generateSitemaps.
export const dynamic = 'force-dynamic'

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pages: MetadataRoute.Sitemap = PUBLIC_INDEXABLE_PATHS.map((path) => ({ url: `${SITE_URL}${path}` }))
  let dispatches: Awaited<ReturnType<typeof listPublicDispatches>> = []
  let topics: Awaited<ReturnType<typeof listPublicDispatchTopics>> = []

  try {
    const supabase = createAnonClient()
    ;[dispatches, topics] = await Promise.all([
      listPublicDispatches(supabase),
      listPublicDispatchTopics(supabase),
    ])
  } catch {
    // No database / not configured: static public pages only, never an error page.
  }

  return [
    ...pages,
    ...topics
      .filter(publicTopicIsIndexable)
      .map((topic) => ({ url: publicTopicUrl(topic.label), lastModified: topic.lastModified })),
    ...dispatches.map((d) => ({ url: publicDispatchUrl(d.slug), lastModified: d.lastModified })),
  ]
}
