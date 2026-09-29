import type { Metadata } from 'next'
import Link from 'next/link'
import { cache } from 'react'
import { notFound } from 'next/navigation'
import { createAnonClient } from '@/lib/supabase/anon'
import {
  PUBLIC_DISPATCH_INDEX_PATH,
  findPublicTopicBySlug,
  listPublicDispatchPreviews,
  listPublicDispatchTopics,
  publicTopicIsIndexable,
  publicTopicUrl,
} from '@/lib/public-dispatch-discovery'
import { jsonLdScriptContent } from '@/lib/public-dispatches'
import { SITE_NAME, SITE_URL } from '@/lib/site'
import { proseHeadingClass, quietLinkClass, systemBodyClass } from '@/app/profile/ui'
import PublicDispatchCard from '../../public-dispatch-card'

export const dynamic = 'force-dynamic'

const loadTopic = cache(async (slug: string) => {
  const supabase = createAnonClient()
  const topics = await listPublicDispatchTopics(supabase)
  const topic = findPublicTopicBySlug(topics, slug)
  if (!topic) return null
  const dispatches = await listPublicDispatchPreviews(supabase, { limit: 48, topic: topic.key })
  return { topic, dispatches }
})

export async function generateMetadata({ params }: { params: Promise<{ topic: string }> }): Promise<Metadata> {
  const { topic: slug } = await params
  const loaded = await loadTopic(slug)
  if (!loaded) {
    return { title: { absolute: `Dispatches — ${SITE_NAME}` }, robots: { index: false, follow: false } }
  }

  const { topic, dispatches } = loaded
  const indexable = publicTopicIsIndexable(topic) && dispatches.length >= 3
  const title = `${topic.label} Dispatches — ${SITE_NAME}`
  const description = `Public Dispatches about ${topic.label}, written by people on Tempa and shared openly on the web.`
  const url = publicTopicUrl(topic.label)
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: url },
    robots: {
      index: indexable,
      follow: true,
      googleBot: { index: indexable, follow: true },
    },
    openGraph: { type: 'website', siteName: SITE_NAME, title, description, url },
    twitter: { card: 'summary_large_image', title, description },
  }
}

export default async function PublicDispatchTopicPage({ params }: { params: Promise<{ topic: string }> }) {
  const { topic: slug } = await params
  const loaded = await loadTopic(slug)
  if (!loaded || loaded.dispatches.length === 0) notFound()

  const { topic, dispatches } = loaded
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Dispatches', item: `${SITE_URL}${PUBLIC_DISPATCH_INDEX_PATH}` },
      { '@type': 'ListItem', position: 2, name: topic.label },
    ],
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScriptContent(breadcrumb) }} />
      <main className="flex justify-center p-6">
        <div className="w-full max-w-3xl space-y-9 py-10">
          <header className="space-y-4">
            <p className="font-serif text-lg italic text-foreground">Tempa</p>
            <Link href={PUBLIC_DISPATCH_INDEX_PATH} className={quietLinkClass}>
              All public Dispatches
            </Link>
            <div className="space-y-2">
              <p className="text-[13px] font-medium uppercase tracking-wider text-muted">Topic</p>
              <h1 className={proseHeadingClass}>{topic.label}</h1>
              <p className={`${systemBodyClass} max-w-2xl`}>
                Public Dispatches tagged {topic.label} by the people who chose to share them on the web.
              </p>
            </div>
          </header>

          <section aria-label={`Public Dispatches about ${topic.label}`}>
            {dispatches.map((dispatch) => (
              <PublicDispatchCard key={dispatch.slug} dispatch={dispatch} />
            ))}
          </section>
        </div>
      </main>
    </>
  )
}
