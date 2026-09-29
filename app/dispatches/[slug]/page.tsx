import type { Metadata } from 'next'
import Link from 'next/link'
import { cache } from 'react'
import { cookies } from 'next/headers'
import { notFound } from 'next/navigation'
import { createAnonClient } from '@/lib/supabase/anon'
import {
  getPublicDispatch,
  jsonLdScriptContent,
  publicDispatchJsonLd,
  publicDispatchMetadata,
  UNAVAILABLE_DISPATCH_METADATA,
} from '@/lib/public-dispatches'
import {
  PUBLIC_DISPATCH_INDEX_PATH,
  listRelatedPublicDispatches,
} from '@/lib/public-dispatch-discovery'
import { SITE_URL } from '@/lib/site'
import { getPublicDispatchWritingStyle } from '@/lib/writing-style-data'
import { quietLinkClass } from '@/app/profile/ui'
import SharedDispatchView from '@/app/d/[shareToken]/shared-dispatch-view'
import PublicDispatchCard from '../public-dispatch-card'

/**
 * Public Dispatch web page — /dispatches/{slug} (docs/public-dispatch-
 * web-pages.md). The same Tempa reading surface as a share link, for a
 * Dispatch that is "Public on the web": readable without an account,
 * server-rendered, indexable, with article metadata and BlogPosting
 * JSON-LD. Humans and crawlers receive the same HTML.
 *
 * Privacy: every read goes through get_public_dispatch with a stateless
 * anonymous client, so this page can only ever show what an anonymous
 * visitor may see right now. Rendered per request (no data cache): a
 * Dispatch made members-only, hidden, unpublished or deleted disappears
 * from the next response. Anything not public → 404 + noindex, with no
 * trace of the former title, text or images.
 */
export const dynamic = 'force-dynamic'

const load = cache(async (slug: string) => getPublicDispatch(createAnonClient(), slug))

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const d = await load(slug)
  return d ? publicDispatchMetadata(d) : UNAVAILABLE_DISPATCH_METADATA
}

export default async function PublicDispatchPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const d = await load(slug)
  if (!d) notFound()

  // Only steers the closing call to action (members → The Board); never
  // a network call and never a gate on the article itself.
  const hasSession = (await cookies()).getAll().some((c) => /^sb-.+-auth-token/.test(c.name))
  const [related, writingStyleId] = await Promise.all([
    listRelatedPublicDispatches(createAnonClient(), d.slug, d.topics, 4),
    getPublicDispatchWritingStyle(createAnonClient(), d.slug),
  ])
  const breadcrumb = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Dispatches', item: `${SITE_URL}${PUBLIC_DISPATCH_INDEX_PATH}` },
      { '@type': 'ListItem', position: 2, name: d.title },
    ],
  }

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScriptContent(publicDispatchJsonLd(d)) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLdScriptContent(breadcrumb) }} />
      <SharedDispatchView
        dispatch={d}
        isAuthenticated={hasSession}
        writerInvitation={d.identity.kind === 'member' ? d.identity.name : null}
        writingStyleId={writingStyleId}
      />

      <section className="flex justify-center px-6 pb-14" aria-label="More public Dispatches">
        <div className="w-full max-w-2xl space-y-5 border-t border-foreground/10 pt-7">
          {related.length > 0 && (
            <>
              <h2 className="font-serif text-xl font-medium text-foreground">More public Dispatches</h2>
              <div>
                {related.map((dispatch) => (
                  <PublicDispatchCard key={dispatch.slug} dispatch={dispatch} />
                ))}
              </div>
            </>
          )}
          <Link href={PUBLIC_DISPATCH_INDEX_PATH} className={quietLinkClass}>
            Browse all public Dispatches
          </Link>
        </div>
      </section>
    </>
  )
}
