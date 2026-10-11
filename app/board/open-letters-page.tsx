import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import { generateBoardSeed, getBoardFeedPage } from '@/lib/dispatches'
import { ROOM_WRITE } from '@/lib/room-paths'
import { pageTitleClass, primaryButtonClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import RoomBrowser from '@/app/room/room-browser'
import BoardTabs from './board-tabs'
import { getEditorialBylines, editorialTitleFor } from '@/lib/editorial-byline'

// Bounded permission-checked initial window. The client retains unshown
// candidates rather than skipping them between six-letter batches.
const CANDIDATE_WINDOW=48
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export default async function BoardOpenLettersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const raw = await searchParams
  // Preserve historic links to a specific public Question; never silently
  // ignore the identifier just because the main Room no longer features it.
  if (typeof raw.question === 'string') {
    if (!UUID.test(raw.question)) notFound()
    redirect(`/question/${raw.question}?source=room`)
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in?next=%2Fboard')

  const session = typeof raw.s === 'string' && !Number.isNaN(Date.parse(raw.s))
    && raw.s.length <= 40 ? raw.s : null
  const seed = typeof raw.seed === 'string' && /^[a-z0-9]{1,20}$/.test(raw.seed)
    ? raw.seed : null
  if (!session || !seed) {
    redirect(`/board?s=${encodeURIComponent(new Date().toISOString())}&seed=${generateBoardSeed()}`)
  }

  const [waiting, result, editorialBylines] = await Promise.all([
    getWaitingLetterCount(supabase, user.id),
    getBoardFeedPage(supabase, { sessionStartedAt: session, seed, cursor: null, limit: CANDIDATE_WINDOW }),
    getEditorialBylines(supabase),
  ])
  return (
    <AppShell active="board" waitingLetterCount={waiting}>
      <main className="mx-auto min-h-screen max-w-6xl px-5 pb-20 pt-9 sm:px-8 sm:pt-14 lg:px-12">
        <header className="flex flex-col justify-between gap-6 border-b border-foreground/10 pb-8 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <p className="text-[11px] font-medium uppercase tracking-[.21em] text-[#94745f]">Letters left here</p>
            <h1 className={`${pageTitleClass} mt-3 !text-[42px] !font-normal sm:!text-[54px]`}>The Board</h1>
            <p className="mt-3 max-w-lg font-serif text-[19px] leading-relaxed text-foreground/75">
              Open letters from ordinary lives. Read what catches your attention, or leave something of your own.
            </p>
          </div>
          <Link href={ROOM_WRITE} className={primaryButtonClass}>Pin a letter <span aria-hidden="true">↗</span></Link>
        </header>

        <BoardTabs active="letters" />
        <RoomBrowser
          viewerId={user.id}
          startedAt={session}
          seed={seed}
          initialPool={result.items.filter(item => item.publishedAs === 'member' && !editorialTitleFor(editorialBylines, item.authorPseudonym))}
          initialCursor={result.nextCursor}
          restore={raw.restore === '1'}
        />
        <div className="mt-16 border-t border-foreground/10 pt-7">
          <p className="text-[13px] text-foreground/60">You can leave something here, too. An ordinary day is enough.</p>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <Link href={ROOM_WRITE} className="text-[14px] underline underline-offset-4">Pin an open letter</Link>
            <Link href="/board/people" className="text-[14px] underline underline-offset-4">Discover people</Link>
          </div>
        </div>
      </main>
    </AppShell>
  )
}
