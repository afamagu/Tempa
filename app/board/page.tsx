import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import {
  getPublishedDispatches,
  searchDispatches,
  getSeenDispatchIds,
  getKeptUserIds,
  sortBoardDispatches,
  getFirstMomentThumbnails,
} from '@/lib/dispatches'
import { sectionTitleClass, helperTextClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import DispatchCard from './dispatch-card'
import DispatchSearch from './dispatch-search'
import KeepButton from './keep-button'
import WriteDispatchButton from './write-dispatch-button'

/**
 * The Board — a normal vertically scrolling discovery/list page, never
 * Reels/Stories/an animated feed. Ordering is viewer-aware and
 * unseen-first (sortBoardDispatches), never a popularity signal — none
 * of likes/views/followers exist anywhere in this schema to rank by.
 * Search results (when ?q is present) are shown newest-first only,
 * without the seen/kept tiering — a deliberate lookup, not passive
 * discovery.
 */
export default async function BoardPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const { q } = await searchParams
  const query = (q ?? '').trim()

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  const [waitingCount, pool, seenIds, keptUserIds] = await Promise.all([
    getWaitingLetterCount(supabase, user.id),
    query ? searchDispatches(supabase, query) : getPublishedDispatches(supabase),
    getSeenDispatchIds(supabase, user.id),
    getKeptUserIds(supabase, user.id),
  ])

  const dispatches = query
    ? pool
    : sortBoardDispatches(
        pool.map((d) => ({ ...d, seen: seenIds.has(d.id), kept: keptUserIds.has(d.authorId) }))
      )

  // Board list Moment preview (Board live-test corrections, 2026-09-10):
  // the same batched first-Moment lookup Home's shelf already uses (see
  // getFirstMomentThumbnails), so a Dispatch with a photo Moment shows
  // the same small thumbnail here that it shows on Home — previously
  // this page fetched nothing at all, so DispatchCard never had a
  // thumbnailUrl to render even when one existed.
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

          <DispatchSearch initialQuery={query} />

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
          ) : (
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
          )}
        </div>
      </main>
    </AppShell>
  )
}
