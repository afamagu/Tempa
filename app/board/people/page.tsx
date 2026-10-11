import { randomUUID } from 'node:crypto'
import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import { getRelationshipCapacity, newCorrespondenceUnavailableMessage } from '@/lib/relationship-capacity'
import { getRoomDirectoryPage } from '@/lib/room-directory'
import { parseDirectoryFilters } from '@/lib/directory-state'
import AppShell from '@/app/app-shell'
import { helperTextClass, pageTitleClass, primaryButtonClass } from '@/app/profile/ui'
import Link from 'next/link'
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
  const t=await getTranslations('Board')
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
    <main className="mx-auto min-h-screen w-full max-w-6xl px-5 pb-20 pt-9 sm:px-8 sm:pt-14 lg:px-12">
      <header className="flex flex-col justify-between gap-6 border-b border-foreground/10 pb-8 sm:flex-row sm:items-end">
        <div className="max-w-2xl">
          <p className="text-[11px] font-medium uppercase tracking-[.21em] text-[#94745f]">{t('tagline')}</p>
          <h1 className={`${pageTitleClass} mt-3 !text-[42px] !font-normal sm:!text-[54px]`}>The Board</h1>
          <p className="mt-3 max-w-lg font-serif text-[19px] leading-relaxed text-foreground/75">{t('intro')}</p>
        </div>
        <Link href="/board/write" className={primaryButtonClass}>{t('pin')} <span aria-hidden="true">↗</span></Link>
      </header>
      <BoardTabs active="people" />
      <section aria-labelledby="board-people-heading" className="mb-7 mt-8 max-w-xl space-y-2">
        <p className="text-[11px] font-medium uppercase tracking-[.2em] text-[#9a7967]">{t('filters')}</p>
        <h2 id="board-people-heading" className="font-serif text-[30px] font-normal tracking-[-.025em]">{t('findHeading')}</h2>
        <p className="text-[15px] leading-relaxed text-foreground/70">{t('peopleHelp')}</p>
      </section>
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
