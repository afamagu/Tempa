'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  getBoardFeedPage,
  getFirstMomentThumbnails,
  type BoardFeedCursor,
  type DispatchListItem,
} from '@/lib/dispatches'
import { helperTextClass } from '@/app/profile/ui'
import DispatchCard from './dispatch-card'
import KeepButton from './keep-button'

const RETURN_TO_TOP_SCROLL_THRESHOLD = 800

/**
 * Board Feed Foundation checkpoint (Phase 2A) — The Board's incremental
 * "Load more" list, one client island around otherwise-ordinary server-
 * rendered cards. Receives the FIRST page already rendered server-side
 * (initialDispatches/initialThumbnails/initialCursor) and only ever
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
 */
export default function BoardFeed({
  viewerId,
  sessionStartedAt,
  seed,
  initialDispatches,
  initialThumbnails,
  initialCursor,
  initialKeptUserIds,
  pageSize,
}: {
  viewerId: string
  sessionStartedAt: string
  seed: string
  initialDispatches: DispatchListItem[]
  initialThumbnails: Record<string, string>
  initialCursor: BoardFeedCursor | null
  initialKeptUserIds: string[]
  pageSize: number
}) {
  const [dispatches, setDispatches] = useState(initialDispatches)
  const [thumbnails, setThumbnails] = useState(new Map(Object.entries(initialThumbnails)))
  const [cursor, setCursor] = useState(initialCursor)
  const [loading, setLoading] = useState(false)
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
    try {
      const supabase = createClient()
      const { items, nextCursor } = await getBoardFeedPage(supabase, {
        sessionStartedAt,
        seed,
        cursor,
        limit: pageSize,
      })
      const newThumbnails = await getFirstMomentThumbnails(
        supabase,
        items.map((d) => d.id)
      )
      setDispatches((prev) => [...prev, ...items])
      setThumbnails((prev) => new Map([...prev, ...newThumbnails]))
      setCursor(nextCursor)
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
          thumbnailUrl={thumbnails.get(dispatch.id)}
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
        <div className="pt-2 text-center">
          <button
            type="button"
            onClick={loadMore}
            disabled={loading}
            className={`${helperTextClass} rounded-md border border-foreground/15 px-4 py-2 transition-colors hover:border-foreground/30 hover:bg-foreground/[.03] disabled:opacity-60`}
          >
            {loading ? 'Loading…' : 'More from the Board'}
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
