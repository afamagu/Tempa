import { randomUUID } from 'node:crypto'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import { getRelationshipCapacity, newCorrespondenceUnavailableMessage } from '@/lib/relationship-capacity'
import { getRoomDirectoryPage } from '@/lib/room-directory'
import { parseDirectoryFilters } from '@/lib/directory-state'
import AppShell from '@/app/app-shell'
import { helperTextClass } from '@/app/profile/ui'
import BoardTabs from '../board-tabs'
import DirectoryBrowser from '@/app/letters/discover/directory-browser'

/**
 * Secondary, intentional discovery: an author directory, not another feed.
 * Questions are deliberately not a prerequisite for appearing here.
 */
export default async function BoardPeoplePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const raw = await searchParams
  const filters = parseDirectoryFilters(raw)
  const seed = randomUUID()

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in?next=%2Fboard%2Fpeople')

  const [waitingCount, relationshipCapacity, page] = await Promise.all([
    getWaitingLetterCount(supabase, user.id),
    getRelationshipCapacity(supabase),
    getRoomDirectoryPage(supabase, filters, seed),
  ])

  const capacityMessage = newCorrespondenceUnavailableMessage(relationshipCapacity)

  return <AppShell active="board" waitingLetterCount={waitingCount}>
    <main className="mx-auto min-h-screen w-full max-w-4xl px-5 py-9 sm:px-8 sm:py-12">
      <header className="mb-7 space-y-2"><p className="text-[11px] font-medium uppercase tracking-[.21em] text-[#94745f]">The Board</p><h1 className="font-serif text-[38px] font-normal tracking-[-.025em] sm:text-[48px]">Find someone to write to</h1><p className="font-serif text-[18px] leading-relaxed text-foreground/75">Read the open letters, or look for a person by place, language and interests.</p></header>
      <BoardTabs active="people" />
      <header className="mb-7 mt-7 max-w-xl space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-[.2em] text-[#9a7967]">Find by place, language or interest</p>
        <h2 className="font-serif text-[25px] font-normal tracking-[-.025em] text-foreground sm:text-[30px]">People</h2>
        <p className="font-serif text-[19px] leading-relaxed text-foreground/75">
          You can start with someone whose letter moved you, or look a little more deliberately.
        </p>
      </header>
      {capacityMessage && <div className="mb-7 border-l-2 border-accent/30 pl-4">
        <p className={helperTextClass}>{capacityMessage} You can still explore people&rsquo;s letters.</p>
      </div>}
      <DirectoryBrowser
        initialFilters={filters}
        initialEntries={page.entries}
        initialHasMore={page.hasMore}
        initialError={page.error}
        viewerId={user.id}
        seed={seed}
        restore={raw.restore === '1'}
      />
    </main>
  </AppShell>
}
