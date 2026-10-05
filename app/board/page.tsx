import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import { hasCompletedGuide } from '@/lib/guide'
import {
  searchDispatches,
  getKeptUserIds,
  getFiniteBoardComposition,
  generateBoardSeed,
  readingTrailSearchParams,
  type DispatchListItem,
} from '@/lib/dispatches'
import { pageTitleClass, helperTextClass, quietLinkClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import FeatureIntroduction from '@/app/feature-introduction'
import DispatchCard from './dispatch-card'
import DispatchSearch from './dispatch-search'
import KeepButton from './keep-button'
import WriteDispatchButton from './write-dispatch-button'
import BoardCrossedPathImpression from './board-crossed-path-impression'

/**
 * The Board — finite passive discovery plus intentional Search.
 *
 * A non-search visit is stable for one URL-carried session (s + seed) and
 * renders a bounded editorial composition. There is no passive pagination or
 * refresh-for-more control. Search is deliberately separate and may return a
 * broader explicit result set.
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

  // Search and passive Board composition stay separate: Search is an
  // intentional lookup; the finite Board is a bounded session-stable surface.
  const [waitingCount, keptUserIds, searchResults, finiteBoard, introSeen] = await Promise.all([
    getWaitingLetterCount(supabase, user.id),
    getKeptUserIds(supabase, user.id),
    query ? searchDispatches(supabase, query).then(items => ({ items, failed: false })).catch(() => ({ items: [], failed: true })) : Promise.resolve(null),
    query ? Promise.resolve(null) : getFiniteBoardComposition(supabase, user.id, { sessionStartedAt: s!, seed: seed! }),
    hasCompletedGuide(supabase, user.id, 'board'),
  ])

  const dispatches: DispatchListItem[] = query ? searchResults!.items : []

  return (
    <AppShell active="board" waitingLetterCount={waitingCount}>
      <main className="min-h-screen flex justify-center p-6">
        <div className="w-full max-w-2xl space-y-6 py-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="space-y-1">
              <h1 className={pageTitleClass}>The Board</h1>
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
            <DispatchSearch key={query} initialQuery={query} sessionStartedAt={s} seed={seed} />
            {query && (
              <Link href={s && seed ? `/board?s=${encodeURIComponent(s)}&seed=${encodeURIComponent(seed)}` : '/board'} className={quietLinkClass}>
                Clear search
              </Link>
            )}
          </div>

          {searchResults?.failed ? (<p role="alert" className={helperTextClass}>Search is temporarily unavailable. Please try Search again, or clear it to return to the Board.</p>) : query && dispatches.length === 0 ? (
            <div className="space-y-2">
              <p className={helperTextClass}>No Dispatches match &ldquo;{query}&rdquo;.</p>
            </div>
          ) : !query && finiteBoard && finiteBoard.crossedPaths.length === 0 && finiteBoard.kept.length === 0 && finiteBoard.unexpected.length === 0 ? (
            <div className="space-y-2">
              <p className={helperTextClass}>Nothing has been placed on your Board just now.</p>
              <p className={helperTextClass}>Search if you’re looking for something particular, or come back another time.</p>
            </div>
          ) : query ? (
            <div className="space-y-4">
              {dispatches.map((dispatch) => (
                <DispatchCard
                  key={dispatch.id}
                  dispatch={dispatch}
                  keepSlot={
                    dispatch.identity.kind === 'member' && dispatch.authorId !== user.id ? (
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
          ) : finiteBoard && (
            <div className="space-y-10">
              {finiteBoard.crossedPaths.length > 0 && (
                <section className="space-y-4" aria-labelledby="board-crossed-paths">
                  <div className="space-y-1">
                    <h2 id="board-crossed-paths" className="font-serif text-2xl text-foreground">From people you’ve crossed paths with</h2>
                    <p className={helperTextClass}>You’ve crossed paths before. Here’s something new from them.</p>
                  </div>
                  <div className="space-y-4">
                    {finiteBoard.crossedPaths.map((dispatch) => (
                      <BoardCrossedPathImpression key={dispatch.id} candidateId={dispatch.authorId}>
                        <DispatchCard
                          dispatch={dispatch}
                          trailQuery={readingTrailSearchParams({ sessionStartedAt: s!, seed: seed! }, dispatch).toString()}
                          keepSlot={
                            dispatch.identity.kind === 'member' && dispatch.authorId !== user.id ? (
                              <KeepButton
                                viewerId={user.id}
                                keptUserId={dispatch.authorId}
                                keptPseudonym={dispatch.authorPseudonym}
                                initiallyKept={keptUserIds.has(dispatch.authorId)}
                              />
                            ) : undefined
                          }
                        />
                      </BoardCrossedPathImpression>
                    ))}
                  </div>
                </section>
              )}

              {finiteBoard.kept.length > 0 && (
                <section className="space-y-4" aria-labelledby="board-kept">
                  <div className="space-y-1">
                    <h2 id="board-kept" className="font-serif text-2xl text-foreground">From people you Keep in Mind</h2>
                    <p className={helperTextClass}>Fresh writing from people you chose to remember.</p>
                  </div>
                  <div className="space-y-4">
                    {finiteBoard.kept.map((dispatch) => (
                      <DispatchCard
                        key={dispatch.id}
                        dispatch={dispatch}
                        trailQuery={readingTrailSearchParams({ sessionStartedAt: s!, seed: seed! }, dispatch).toString()}
                        keepSlot={
                          dispatch.identity.kind === 'member' && dispatch.authorId !== user.id ? (
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
                </section>
              )}

              {finiteBoard.unexpected.length > 0 && (
                <section className="space-y-4" aria-labelledby="board-unexpected">
                  <div className="space-y-1">
                    <h2 id="board-unexpected" className="font-serif text-2xl text-foreground">Something unexpected</h2>
                    <p className={helperTextClass}>One piece from beyond the people already familiar to you.</p>
                  </div>
                  {finiteBoard.unexpected.map((dispatch) => (
                    <DispatchCard
                      key={dispatch.id}
                      dispatch={dispatch}
                      trailQuery={readingTrailSearchParams({ sessionStartedAt: s!, seed: seed! }, dispatch).toString()}
                      keepSlot={
                        dispatch.identity.kind === 'member' && dispatch.authorId !== user.id ? (
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
                </section>
              )}

              <div className="space-y-2 border-t border-foreground/10 pt-6 text-center">
                <p className="font-serif text-xl text-foreground">That’s the Board for now.</p>
                <p className={helperTextClass}>Search if you’re looking for something particular, or come back another time.</p>
              </div>
            </div>
          )}
        </div>
      </main>
    </AppShell>
  )
}
