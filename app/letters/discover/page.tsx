import { randomUUID } from 'node:crypto'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import { getRelationshipCapacity, newCorrespondenceUnavailableMessage } from '@/lib/relationship-capacity'
import { getDiscoveryPage, type DiscoveryPage } from '@/lib/discovery'
import { discoveryEntries } from '@/lib/discovery-entries'
import AppShell from '@/app/app-shell'
import { pageTitleClass, helperTextClass } from '@/app/profile/ui'
import LettersTabs from '../letters-tabs'
import DiscoverBrowser from './discover-browser'
import {
  discoveryRequest,
  hasIntentionalDiscoverCriteria,
} from '@/lib/discover-browser-state'

const EMPTY_PAGE: DiscoveryPage = {
  candidates: [],
  eligibleCount: 0,
  filteredCount: 0,
  fairRankingApplied: true,
  browseStartedAt: null,
}

export default async function DiscoverPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const raw = await searchParams
  const value = (key: string) =>
    typeof raw[key] === 'string' ? raw[key].slice(0, key === 'search' ? 80 : 100) : ''
  const values = Object.fromEntries(
    ['country', 'language', 'age', 'gender', 'intent', 'interest', 'search'].map((key) => [key, value(key)])
  )
  const intentional = hasIntentionalDiscoverCriteria(values)
  const seed = randomUUID()
  const request = discoveryRequest(values, seed)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const [t, letters, waitingCount, relationshipCapacity] = await Promise.all([
    getTranslations('Discovery'),
    getTranslations('Letters'),
    getWaitingLetterCount(supabase, user.id),
    getRelationshipCapacity(supabase),
  ])

  // Blank Discover is not a replacement-shopping feed. When the member has
  // no room for another private correspondence we render no passive set at
  // all, while explicit search/filter remains available and broad.
  const mayShowPassiveIntroductions = relationshipCapacity?.canStartFirstContact !== false
  const page = !intentional && !mayShowPassiveIntroductions
    ? EMPTY_PAGE
    : await getDiscoveryPage(supabase, request)
  const entries = await discoveryEntries(supabase, page.candidates)
  const newCorrespondenceMessage = newCorrespondenceUnavailableMessage(relationshipCapacity)

  return (
    <AppShell active="letters" waitingLetterCount={waitingCount}>
      <main className="flex min-h-screen justify-center px-4 py-8 sm:px-8">
        <div className="w-full max-w-5xl space-y-6">
          <div>
            <h1 className={pageTitleClass}>{letters('heading')}</h1>
            <LettersTabs active="discover" />
          </div>
          <p className={helperTextClass}>{t('intro')}</p>
          {newCorrespondenceMessage && (
            <div className="rounded-md border border-foreground/10 bg-surface-shell px-4 py-3">
              <p className="text-xs uppercase tracking-widest text-foreground/55">Your correspondence</p>
              <p className={`mt-1 ${helperTextClass}`}>
                {newCorrespondenceMessage} You can still search, read profiles and take part in the Room and Board.
              </p>
            </div>
          )}
          <DiscoverBrowser
            viewerId={user.id}
            restore={value('restore') === '1'}
            initialValues={values}
            initialEntries={entries}
            initialHasMore={intentional && page.filteredCount > entries.length}
            initialUnavailable={!!page.unavailable}
            seed={seed}
            passiveIntroductionsEnabled={mayShowPassiveIntroductions}
          />
        </div>
      </main>
    </AppShell>
  )
}
