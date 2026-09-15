import Link from 'next/link'
import Mindform from '@/app/mindform'
import CountryFlag from '@/app/country-flag'
import TopicChips from '@/app/board/topic-chips'
import DispatchBody from '@/app/board/dispatch-body'
import MomentHint from '@/app/board/moment-hint'
import LetterheadPostcard from '@/app/letters/letterhead-postcard'
import { formatDatePlain } from '@/lib/format-date'
import {
  metadataTextClass,
  proseHeadingClass,
  systemBodyClass,
  primaryButtonClass,
} from '@/app/profile/ui'
import { dispatchPostcardToBaseContent, type SharedDispatch } from '@/lib/dispatches'

/**
 * The external reader's actual content — factored out from the async
 * page.tsx purely so it stays unit-testable (this codebase never unit-
 * tests async Server Component pages directly; the same reasoning
 * already applies to dispatch-body.tsx/dispatch-reader.tsx for the
 * authenticated reader). One piece of writing, nothing else: no Board/
 * search/Keep/Letterbox/Minds/You navigation, no link to the writer's
 * full profile or their other Dispatches, no follower/view/Keep count,
 * no resume state. This component receives exactly what
 * get_shared_dispatch returned (via lib/dispatches.ts's
 * getSharedDispatch) and renders exactly that — it makes no data access
 * of its own. No swipe, no next Dispatch, no feed continuation: leaving
 * the page is the only "close."
 *
 * Mindform's identifier is the Dispatch's own id, not the author's user
 * id — get_shared_dispatch deliberately never returns the author's id
 * to an anonymous caller, so the same author's Mindform tint will not
 * visually match their in-app one here. A deliberate, accepted
 * consequence of that privacy boundary, not an oversight.
 *
 * Visual rule (Board usability follow-up, 2026-09-09): the writing
 * itself sits on `bg-surface-shell` — the exact token the private-
 * letter reader (letter-body.tsx) already uses for its own darker
 * paper surface — while everything around it (masthead, identity,
 * title, topics, Join CTA) stays on the ordinary page background. Only
 * DispatchBody gets the treatment, matching the authenticated reader
 * (app/board/[dispatchId]/page.tsx) exactly, so the external and
 * authenticated readers feel like the same surface. See the Build
 * Guide's own note on this rule before changing it.
 *
 * Wordmark rule (Board live-test corrections, 2026-09-10): the masthead
 * uses the SAME italic-serif "Tempa" treatment as every other masthead
 * in the app (app-shell.tsx, dispatch-unavailable.tsx) — this used to
 * read "TEMPA" in the small-caps metadata-label style instead, an
 * inconsistent one-off. "Tempa" inside ordinary sentences/buttons below
 * stays plain interface type, never italicized — a wordmark is a
 * masthead treatment, not something sprinkled through UI copy.
 *
 * Positioning (Board live-test corrections, 2026-09-10): the closing
 * CTA is deliberately pen-pal/correspondence-positioned, not a
 * Medium-style "discover more content" line — see the Build Guide's own
 * note on this distinction. The CTA for a signed-out visitor routes to
 * account creation first (/sign-in?intent=join), never a bare "Sign
 * in" that would confuse someone who has never heard of Tempa before.
 */
export default function SharedDispatchView({
  dispatch,
  isAuthenticated,
}: {
  dispatch: SharedDispatch
  isAuthenticated: boolean
}) {
  const hasMoments = dispatch.moments.some((m) => m.imageUrl)

  return (
    <main className="flex justify-center p-6">
      <div className="w-full max-w-2xl space-y-8 py-10">
        <p className="font-serif text-lg italic text-foreground">Tempa</p>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Mindform identifier={dispatch.id} size="md" />
            <div>
              <div className="flex items-center gap-1.5">
                <p className="text-[15px] font-medium text-foreground">{dispatch.authorPseudonym}</p>
                <CountryFlag country={dispatch.authorCountry} />
              </div>
              <p className={metadataTextClass}>{formatDatePlain(dispatch.publishedAt)}</p>
            </div>
          </div>

          <h1 className={proseHeadingClass}>{dispatch.title}</h1>

          {dispatch.topics.length > 0 && <TopicChips topics={dispatch.topics} />}

          {hasMoments && <MomentHint dispatchId={dispatch.id} />}

          {/* Dispatch Postcards Checkpoint 2 — the same LetterheadPostcard
              component the authenticated reader uses, fed exactly the
              resolved fields get_shared_dispatch already returned (no
              second fetch, no direct query against dispatch_postcards/
              postcard_catalog/postcard_versions from this anon-facing
              page). A signed-out visitor gets the full front/back/
              Living-Reveal experience — never an additional member-only
              capability, since LetterheadPostcard/PostcardObject make no
              Supabase calls of their own. No attached Postcard renders
              nothing here, same as the authenticated reader. */}
          {dispatch.postcard && (
            <div className="flex justify-end">
              <LetterheadPostcard
                base={dispatchPostcardToBaseContent(dispatch.postcard.version)}
                revealLine={dispatch.postcard.revealLine}
                backMessage={dispatch.postcard.backMessage}
                senderPseudonym={dispatch.postcard.senderPseudonymSnapshot}
              />
            </div>
          )}

          <div className="rounded-md bg-surface-shell p-4 sm:p-6">
            <DispatchBody body={dispatch.body} moments={dispatch.moments} />
          </div>
        </div>

        <div className="space-y-3 border-t border-foreground/10 pt-6 text-center">
          {!isAuthenticated && (
            <p className={systemBodyClass}>
              Tempa is a pen-pal experience built around thoughtful letters, shared questions, and glimpses
              from people&rsquo;s worlds. Meet minds worth writing to.
            </p>
          )}
          <Link href={isAuthenticated ? '/board' : '/sign-in?intent=join'} className={primaryButtonClass}>
            {isAuthenticated ? 'Go to The Board' : 'Join Tempa'}
          </Link>
        </div>
      </div>
    </main>
  )
}
