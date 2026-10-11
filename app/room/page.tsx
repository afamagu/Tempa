import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import { generateBoardSeed, getBoardFeedPage, type BoardFeedCursor } from '@/lib/dispatches'
import { ROOM_LETTER_BATCH_SIZE, selectRoomLetterBatch } from '@/lib/room-letter-selection'
import { ROOM_WRITE } from '@/lib/room-paths'
import { pageTitleClass, helperTextClass, primaryButtonClass, secondaryButtonClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import RoomLetterCard from './room-letter-card'

// Use the established bounded ranked feed; the URL cursor is display-only,
// never trusted as a capability. 48 candidate rows is a bounded window to
// find six different writers where the actual member pool permits it.
const CANDIDATE_WINDOW = 48
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function cursorFromQuery(raw: Record<string, string | string[] | undefined>): BoardFeedCursor | null {
  const num = (key: string) => typeof raw[key] === 'string' ? Number(raw[key]) : NaN
  const id = raw.after
  const rankKey = raw.rank
  if (typeof id !== 'string' || !UUID.test(id) || typeof rankKey !== 'string' || !/^-?\d{1,28}(\.\d{1,28})?$/.test(rankKey)) return null
  const seenBucket = num('bucket')
  const seedHash = num('shash')
  if (!Number.isInteger(seenBucket) || !Number.isInteger(seedHash) || seenBucket < 0 || seenBucket > 10 || !Number.isSafeInteger(seedHash)) return null
  return { id, rankKey, seenBucket, seedHash }
}

function linkForNext(session: string, seed: string, cursor: BoardFeedCursor): string {
  const query = new URLSearchParams({
    s: session, seed,
    after: cursor.id,
    rank: cursor.rankKey,
    bucket: String(cursor.seenBucket),
    shash: String(cursor.seedHash),
  })
  return `/room?${query}`
}

export default async function RoomPage({
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
  if (!user) redirect('/sign-in?next=%2Froom')

  const session = typeof raw.s === 'string' && !Number.isNaN(Date.parse(raw.s))
    && raw.s.length <= 40 ? raw.s : null
  const seed = typeof raw.seed === 'string' && /^[a-z0-9]{1,20}$/.test(raw.seed)
    ? raw.seed : null
  if (!session || !seed) {
    redirect(`/room?s=${encodeURIComponent(new Date().toISOString())}&seed=${generateBoardSeed()}`)
  }

  const cursor = cursorFromQuery(raw)
  const [waiting, result] = await Promise.all([
    getWaitingLetterCount(supabase, user.id),
    getBoardFeedPage(supabase, { sessionStartedAt: session, seed, cursor, limit: CANDIDATE_WINDOW }),
  ])
  const { letters } = selectRoomLetterBatch(result.items, {
    viewerId: user.id,
    previousLetterIds: new Set(),
    previousAuthorIds: new Set(),
    limit: ROOM_LETTER_BATCH_SIZE,
  })
  // The feed's stable order is authoritative. Page from the last item
  // actually shown, not the last fetched candidate, to avoid skipping
  // the unshown portion of a window when the selection fills early.
  const lastShown = letters[letters.length - 1]
  const canContinue = Boolean(lastShown && (result.items.length > letters.length || result.nextCursor))
  const nextHref = lastShown ? linkForNext(session, seed, lastShown.cursor) : null

  return (
    <AppShell active="room" waitingLetterCount={waiting}>
      <main className="mx-auto min-h-screen max-w-6xl px-5 pb-20 pt-9 sm:px-8 sm:pt-14 lg:px-12">
        <header className="flex flex-col justify-between gap-6 border-b border-foreground/10 pb-8 sm:flex-row sm:items-end">
          <div className="max-w-2xl">
            <p className="text-[11px] font-medium uppercase tracking-[.21em] text-[#94745f]">Letters left here</p>
            <h1 className={`${pageTitleClass} mt-3 !text-[42px] !font-normal sm:!text-[54px]`}>The Room</h1>
            <p className="mt-3 max-w-lg font-serif text-[19px] leading-relaxed text-foreground/75">
              Little things from ordinary lives, left where someone else might find them.
            </p>
          </div>
          <Link href={ROOM_WRITE} className={primaryButtonClass}>Leave a letter <span aria-hidden="true">↗</span></Link>
        </header>

        {letters.length > 0 ? (
          <section aria-label="Letters left in The Room" className="mt-9 space-y-8">
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              {letters.map((letter, index) => (
                <RoomLetterCard key={letter.id} letter={letter} featured={index === 0} />
              ))}
            </div>
            {canContinue && nextHref && (
              <div className="flex justify-center pt-5">
                <Link href={nextHref} className={secondaryButtonClass}>Keep looking <span aria-hidden="true">→</span></Link>
              </div>
            )}
          </section>
        ) : (
          <section className="mx-auto max-w-lg py-20 text-center" aria-live="polite">
            <h2 className="font-serif text-2xl">That’s what has been left here for now.</h2>
            <p className={`${helperTextClass} mt-3`}>There may be more another day. You can also leave something of your own.</p>
            <Link href={ROOM_WRITE} className={`${secondaryButtonClass} mt-6`}>Leave a letter</Link>
          </section>
        )}
        <div className="mt-16 border-t border-foreground/10 pt-7">
          <p className="text-[13px] text-foreground/60">You can leave something here, too. It doesn’t need to be a grand story.</p>
          <div className="mt-4 flex flex-wrap items-center gap-4">
            <Link href={ROOM_WRITE} className="text-[14px] underline underline-offset-4">Leave your first letter</Link>
            <Link href="/letters/discover" className="text-[14px] underline underline-offset-4">Browse people by place</Link>
          </div>
        </div>
      </main>
    </AppShell>
  )
}
