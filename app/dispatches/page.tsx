import type { Metadata } from 'next'
import Link from 'next/link'
import { cache } from 'react'
import { createAnonClient } from '@/lib/supabase/anon'
import {
  PUBLIC_DISPATCH_INDEX_PATH,
  listPublicDispatchPreviews,
  listPublicDispatchTopics,
  publicTopicIsIndexable,
  publicTopicPath,
} from '@/lib/public-dispatch-discovery'
import { SITE_NAME, SITE_URL } from '@/lib/site'
import { primaryButtonClass, proseHeadingClass, systemBodyClass } from '@/app/profile/ui'
import PublicDispatchCard from './public-dispatch-card'

export const dynamic = 'force-dynamic'

const INDEX_TITLE = `Dispatches — ${SITE_NAME}`
const INDEX_DESCRIPTION = 'Thoughtful writing from Tempa, shared openly on the web by the people who chose to make it public.'

const loadIndex = cache(async () => {
  const supabase = createAnonClient()
  const [dispatches, topics] = await Promise.all([
    listPublicDispatchPreviews(supabase, { limit: 36 }),
    listPublicDispatchTopics(supabase),
  ])
  return { dispatches, topics }
})

export async function generateMetadata(): Promise<Metadata> {
  const { dispatches } = await loadIndex()
  const indexable = dispatches.length > 0
  const url = `${SITE_URL}${PUBLIC_DISPATCH_INDEX_PATH}`
  return {
    title: { absolute: INDEX_TITLE },
    description: INDEX_DESCRIPTION,
    alternates: { canonical: url },
    robots: {
      index: indexable,
      follow: true,
      googleBot: { index: indexable, follow: true },
    },
    openGraph: {
      type: 'website',
      siteName: SITE_NAME,
      title: INDEX_TITLE,
      description: INDEX_DESCRIPTION,
      url,
    },
    twitter: { card: 'summary_large_image', title: INDEX_TITLE, description: INDEX_DESCRIPTION },
  }
}

export default async function PublicDispatchIndexPage() {
  const { dispatches, topics } = await loadIndex()
  const indexableTopics = topics.filter(publicTopicIsIndexable).slice(0, 14)

  return (
    <main className="flex justify-center p-6">
      <div className="w-full max-w-3xl space-y-10 py-10">
        <header className="space-y-4">
          <p className="font-serif text-lg italic text-foreground">Tempa</p>
          <div className="space-y-2">
            <p className="text-[13px] font-medium uppercase tracking-wider text-muted">Public Dispatches</p>
            <h1 className={proseHeadingClass}>Dispatches</h1>
            <p className={`${systemBodyClass} max-w-2xl`}>
              Thoughtful writing from Tempa, shared openly on the web by the people who chose to make it public.
            </p>
          </div>

          {indexableTopics.length > 0 && (
            <nav className="flex flex-wrap gap-2 pt-1" aria-label="Dispatch topics">
              {indexableTopics.map((topic) => (
                <Link
                  key={topic.key}
                  href={publicTopicPath(topic.label)}
                  className="rounded-full border border-foreground/15 px-3 py-1.5 text-[13px] text-foreground/75 transition-colors hover:border-foreground/30 hover:text-foreground"
                >
                  {topic.label}
                </Link>
              ))}
            </nav>
          )}
        </header>

        {dispatches.length > 0 ? (
          <section aria-label="Latest public Dispatches">
            {dispatches.map((dispatch) => (
              <PublicDispatchCard key={dispatch.slug} dispatch={dispatch} />
            ))}
          </section>
        ) : (
          <section className="rounded-md border border-foreground/10 p-5">
            <p className={systemBodyClass}>
              Public Dispatches will appear here when writers choose to share them on the web.
            </p>
          </section>
        )}

        <section className="space-y-3 border-t border-foreground/10 pt-6 text-center">
          <p className={systemBodyClass}>Tempa is built for meeting people through what they think, write and choose to share.</p>
          <Link href="/sign-in?intent=join" className={primaryButtonClass}>
            Join Tempa
          </Link>
        </section>
      </div>
    </main>
  )
}
