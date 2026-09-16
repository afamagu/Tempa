import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import { hasCompletedGuide } from '@/lib/guide'
import {
  searchDispatches,
  getKeptUserIds,
  getBoardFeedPage,
  getFirstMomentThumbnails,
  generateBoardSeed,
  BOARD_FEED_PAGE_SIZE,
  type DispatchListItem,
} from '@/lib/dispatches'
import { sectionTitleClass, helperTextClass, quietLinkClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import FeatureIntroduction from '@/app/feature-introduction'
import DispatchCard from './dispatch-card'
import DispatchSearch from './dispatch-search'
import KeepButton from './keep-button'
import WriteDispatchButton from './write-dispatch-button'
import BoardFeed from './board-feed'

/**
 * The Board — a normal vertically scrolling discovery/list page, never
 * Reels/Stories/an animated feed. Search results (when ?q is present)
 * are shown newest-first only, without any tiering — a deliberate
 * lookup, not passive discovery — and never touch the session/cursor
 * machinery below at all.
 *
 * Board Feed Foundation checkpoint (Phase 2A) — the non-search path now
 * carries an explicit Board browsing session in its own URL:
 * `?s=<session_started_at>&seed=<seed>`. Neither value is persisted
 * anywhere (no new database table) — the FIRST request of a session
 * (no `s`/`seed` present) mints both and redirects once to the
 * canonical URL carrying them, so a plain browser refresh (which
 * re-requests that same URL) reuses the SAME session rather than
 * silently starting a new one. "Load more" (see board-feed.tsx) and a
 * genuine "back" navigation after opening one Dispatch both naturally
 * reuse the same URL/session too. An explicit Refresh is simply a link
 * back to plain `/board` — hitting the page with neither value present
 * triggers the same mint-and-redirect path, producing a fresh
 * session_started_at and seed (see getBoardFeedPage/board_feed_page for
 * exactly what that changes and what it deliberately doesn't).
 */
export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; s?: string; seed?: string }>
}) {
  const { q, s, seed } = await searchParams
  const query = (q ?? '').trim()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  if (!query && (!s || !seed)) {
    redirect(`/board?s=${encodeURIComponent(new Date().toISOString())}&seed=${generateBoardSeed()}`)
  }

  // Kept as two distinctly-typed results, never unified into one
  // polymorphic variable — search results (plain DispatchListItem[],
  // no tiering of any kind) must never be given reading-trail cursor
  // fields they don't actually have; only a genuine board_feed_page
  // result (BoardFeedItem[]) carries those. Both branches still run
  // fully in parallel with the other two calls below.
  const [waitingCount, keptUserIds, searchResults, boardFeedResult, introSeen] = await Promise.all([
    getWaitingLetterCount(supabase, user.id),
    getKeptUserIds(supabase, user.id),
    query ? searchDispatches(supabase, query) : Promise.resolve(null),
    query ? Promise.resolve(null) : getBoardFeedPage(supabase, { sessionStartedAt: s!, seed: seed!, cursor: null }),
    hasCompletedGuide(supabase, user.id, 'board'),
  ])

  const dispatches: DispatchListItem[] = query ? searchResults! : boardFeedResult!.items

  // Board list Moment preview (Board live-test corrections, 2026-09-10):
  // the same batched first-Moment lookup Home's shelf already uses (see
  // getFirstMomentThumbnails) — one call per page, whether this is the
  // first page or a later "Load more" page (see board-feed.tsx), never
  // per-card.
  const thumbnailByDispatchId = await getFirstMomentThumbnails(
    supabase,
    dispatches.map((d) => d.id)
  )

  return (
    <AppShell active="board" waitingLetterCount={waitingCount}>
      <main className="min-h-screen flex justify-center p-6">
        <div className="w-full max-w-2xl space-y-6 py-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <h1 className={sectionTitleClass}>The Board</h1>
              <p className={helperTextClass}>Writing shared with everyone on Tempa.</p>
            </div>
            <WriteDispatchButton />
          </div>

          {/* Onboarding & First-Use checkpoint — shown once, the first
              time this member ever encounters the Board; dismissing it
              marks 'board' complete in guide_completions. Replayable
              later from You → Tempa Guide. */}
          {!introSeen && (
            <FeatureIntroduction guideKey="board" title="The Board" ctaLabel="See what's on the Board">
              <p className="italic">Writing meant to be stumbled upon.</p>
              <p>
                Dispatches are public pieces Tempa members leave behind — stories, observations,
                questions, things they&rsquo;ve been thinking about.
              </p>
              <p>
                Read whatever catches you. If the person behind it interests you, you can visit
                their profile or write to them privately.
              </p>
            </FeatureIntroduction>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <DispatchSearch initialQuery={query} />
            {!query && (
              <Link href="/board" className={quietLinkClass}>
                Refresh the Board
              </Link>
            )}
          </div>

          {dispatches.length === 0 ? (
            <div className="space-y-2">
              {query ? (
                <p className={helperTextClass}>No Dispatches match &ldquo;{query}&rdquo;.</p>
              ) : (
                <>
                  <p className={helperTextClass}>No Dispatches here yet.</p>
                  <p className={helperTextClass}>Be the first to leave one, or check back later.</p>
                </>
              )}
            </div>
          ) : query ? (
            <div className="space-y-4">
              {dispatches.map((dispatch) => (
                <DispatchCard
                  key={dispatch.id}
                  dispatch={dispatch}
                  thumbnailUrl={thumbnailByDispatchId.get(dispatch.id)}
                  keepSlot={
                    dispatch.authorId !== user.id ? (
                      <KeepButton
                        viewerId={user.id}
                        keptUserId={dispatch.authorId}
                        keptPseudonym={dispatch.authorPseudonym}
                        initiallyKept={keptUserIds.has(dispatch.authorId)}
                      />
                    ) : undefined
                  }
                />
              ))}
            </div>
          ) : (
            <BoardFeed
              viewerId={user.id}
              sessionStartedAt={s!}
              seed={seed!}
              initialDispatches={boardFeedResult!.items}
              initialThumbnails={Object.fromEntries(thumbnailByDispatchId)}
              initialCursor={boardFeedResult!.nextCursor}
              initialKeptUserIds={[...keptUserIds]}
              pageSize={BOARD_FEED_PAGE_SIZE}
            />
          )}
        </div>
      </main>
    </AppShell>
  )
}
