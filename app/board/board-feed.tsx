'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  getBoardFeedPage,
  readingTrailSearchParams,
  type BoardFeedCursor,
  type BoardFeedItem,
} from '@/lib/dispatches'
import { helperTextClass } from '@/app/profile/ui'
import DispatchCard from './dispatch-card'
import KeepButton from './keep-button'

const RETURN_TO_TOP_SCROLL_THRESHOLD = 800

/**
 * Board Feed Foundation checkpoint (Phase 2A) — The Board's incremental
 * "Load more" list, one client island around otherwise-ordinary server-
 * rendered cards. Receives the FIRST page already rendered server-side
 * (initialDispatches/initialCursor) and only ever
 * APPENDS further pages on an explicit "More from the Board" click —
 * never autoplay/auto-loading infinite scroll, matching The Board's
 * deliberate, writing-first character rather than a social-feed one.
 *
 * sessionStartedAt/seed are the SAME two values the server used for
 * page 1 (carried in the URL — see app/board/page.tsx) — every "Load
 * more" call reuses them unchanged, which is what keeps this session's
 * ordering stable (see board_feed_page's own doc comment in
 * docs/sql/2026-09-22-board-feed-foundation.sql for the full reasoning).
 *
 * Known, accepted rough edge: toggling Keep on any card here calls the
 * existing, shared KeepButton, which (unchanged, matching its behavior
 * everywhere else it's used) calls router.refresh() — a full server
 * re-render of page 1 only. Any additional pages loaded via "Load more"
 * before that click are lost, same as navigating away and back would
 * lose them. Not fixed in this checkpoint — flagged as a known,
 * narrow interaction, not a silent gap.
 *
 * Board Load More resilience checkpoint — before this pass, a failed
 * "Load more" request (getBoardFeedPage
 * throwing) simply reset the button back to idle with no explanation at
 * all; a cohort tester had no way to tell the Board hadn't just silently
 * finished. `loadMoreFailed` is the one new piece of state: set only
 * inside loadMore's own catch, cleared at the very start of every new
 * attempt (so retrying never leaves the stale message showing during the
 * new request), and never set alongside a successful setCursor call — so
 * it can never appear at a genuine end-of-feed. Retry is NOT a second
 * code path: the same button, at the same click handler (loadMore),
 * simply relabels to "Try again" — since cursor is only ever advanced on
 * success, a retry click necessarily requests the exact same next page
 * that just failed, never a different one. This intentionally does NOT
 * change what counts as a failure: getBoardFeedPage does not currently
 * inspect the Supabase `error` field on its own call (a pre-existing,
 * codebase-wide lib/dispatches.ts
 * convention, unrelated to and out of scope for this checkpoint) — only
 * a genuine thrown exception (e.g. the underlying fetch failing outright)
 * reaches this catch today.
 */
export default function BoardFeed({
  viewerId,
  sessionStartedAt,
  seed,
  initialDispatches,
  initialCursor,
  initialKeptUserIds,
  pageSize,
}: {
  viewerId: string
  sessionStartedAt: string
  seed: string
  initialDispatches: BoardFeedItem[]
  initialCursor: BoardFeedCursor | null
  initialKeptUserIds: string[]
  pageSize: number
}) {
  const [dispatches, setDispatches] = useState(initialDispatches)
  const [cursor, setCursor] = useState(initialCursor)
  const [loading, setLoading] = useState(false)
  const [loadMoreFailed, setLoadMoreFailed] = useState(false)
  const [showReturnToTop, setShowReturnToTop] = useState(false)
  const keptUserIds = new Set(initialKeptUserIds)

  useEffect(() => {
    function onScroll() {
      setShowReturnToTop(window.scrollY > RETURN_TO_TOP_SCROLL_THRESHOLD)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  async function loadMore() {
    if (loading || !cursor) return
    setLoading(true)
    // A deliberate new attempt (first try or a "Try again" retry) clears
    // any stale failure from a previous attempt immediately — never left
    // displayed as though the retry has already failed while the new
    // request is still in flight.
    setLoadMoreFailed(false)
    try {
      const supabase = createClient()
      const { items, nextCursor } = await getBoardFeedPage(supabase, {
        sessionStartedAt,
        seed,
        // Unchanged on every attempt, success or failure — this IS what
        // makes a retry request the same next page rather than a
        // different one: cursor only ever advances below, on success.
        cursor,
        limit: pageSize,
      })
      setDispatches((prev) => [...prev, ...items])
      setCursor(nextCursor)
    } catch {
      // Board Load More resilience checkpoint — a failed page fetch must
      // never clear or replace what's already on screen, and must never
      // advance/corrupt the cursor: simply not calling any of the three
      // setters above already guarantees both, so the ONLY new state
      // this catch introduces is the calm, retryable failure flag below.
      // Deliberately no error detail is captured or logged here (see
      // this component's own doc comment) — the user-facing copy stays
      // fixed and generic regardless of what actually failed.
      setLoadMoreFailed(true)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      {dispatches.map((dispatch) => (
        <DispatchCard
          key={dispatch.id}
          dispatch={dispatch}
          trailQuery={readingTrailSearchParams({ sessionStartedAt, seed }, dispatch).toString()}
          keepSlot={
            dispatch.authorId !== viewerId ? (
              <KeepButton
                viewerId={viewerId}
                keptUserId={dispatch.authorId}
                keptPseudonym={dispatch.authorPseudonym}
                initiallyKept={keptUserIds.has(dispatch.authorId)}
              />
            ) : undefined
          }
        />
      ))}

      {cursor && (
        <div className="space-y-2 pt-2 text-center">
          {/* Board Load More resilience checkpoint — a quiet, restrained
              inline status right next to the control, never a large
              alert panel and never alarming red (this is a retryable
              pagination hiccup, not a fatal error). role="status" gives
              assistive tech a polite, non-interrupting announcement
              without stealing focus. Genuine end-of-feed (cursor becomes
              null on a successful empty final page) can never show this
              — loadMoreFailed is only ever set inside loadMore's own
              catch, never alongside a successful setCursor call. */}
          {loadMoreFailed && (
            <p role="status" className={helperTextClass}>
              Tempa couldn&rsquo;t bring in more Dispatches just now.
            </p>
          )}
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className={`${helperTextClass} rounded-md border border-foreground/15 px-4 py-2 transition-colors hover:border-foreground/30 hover:bg-foreground/[.03] disabled:opacity-60`}
          >
            {loading ? 'Loading…' : loadMoreFailed ? 'Try again' : 'More from the Board'}
          </button>
        </div>
      )}

      {showReturnToTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label="Back to top of the Board"
          className="fixed bottom-6 right-6 rounded-full border border-foreground/15 bg-background px-3 py-2 text-[13px] text-foreground/60 shadow-sm transition-colors hover:border-foreground/30 hover:text-foreground/80"
        >
          Back to top
        </button>
      )}
    </div>
  )
}
