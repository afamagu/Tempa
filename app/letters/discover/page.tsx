import { randomUUID } from 'node:crypto'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import { getDiscoveryPage } from '@/lib/discovery'
import { discoveryEntries } from '@/lib/discovery-entries'
import { recordRoomExposureOpportunities } from '@/lib/room-exposure'
import AppShell from '@/app/app-shell'
import { pageTitleClass, helperTextClass } from '@/app/profile/ui'
import LettersTabs from '../letters-tabs'
import DiscoverBrowser from './discover-browser'
import { discoveryRequest } from '@/lib/discover-browser-state'

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams
  const value = (key: string) => typeof raw[key] === 'string' ? raw[key].slice(0, key === 'search' ? 80 : 100) : ''
  const values = Object.fromEntries(['country', 'language', 'age', 'gender', 'intent', 'interest', 'search'].map(key => [key, value(key)]))
  const seed = randomUUID()
  const request = discoveryRequest(values, seed)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')
  const [t, letters, waitingCount, page, suggestedPage] = await Promise.all([
    getTranslations('Discovery'), getTranslations('Letters'), getWaitingLetterCount(supabase, user.id), getDiscoveryPage(supabase, request),
    getDiscoveryPage(supabase, { peopleMode: 'suggested', browseSeed: seed, limit: 6 }),
  ])
  const [entries, suggestions] = await Promise.all([discoveryEntries(supabase, page.candidates), discoveryEntries(supabase, suggestedPage.candidates)])
  await recordRoomExposureOpportunities(user.id, page.candidates, 'room')
  return <AppShell active="letters" waitingLetterCount={waitingCount}><main className="flex min-h-screen justify-center px-4 py-8 sm:px-8"><div className="w-full max-w-5xl space-y-6">
    <div><h1 className={pageTitleClass}>{letters('heading')}</h1><LettersTabs active="discover"/></div>
    <p className={helperTextClass}>{t('intro')}</p>
    <DiscoverBrowser initialValues={values} initialEntries={entries} initialHasMore={page.filteredCount > entries.length} initialUnavailable={!!page.unavailable} suggestions={suggestions} seed={seed} />
  </div></main></AppShell>
}
