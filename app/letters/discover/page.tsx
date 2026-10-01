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
import PeopleBrowser from '@/app/room/people-browser'
import DiscoverFilters from './discover-filters'

export default async function DiscoverPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const raw = await searchParams
  const value = (key: string) => typeof raw[key] === 'string' ? raw[key].slice(0, 100) : ''
  const request = { country: value('country'), language: value('language'), ageRange: value('age'), gender: value('gender'), intent: value('intent'), search: value('search').slice(0, 80), profileLed: true }
  const query = new URLSearchParams(Object.entries({ country: request.country, language: request.language, age: request.ageRange, gender: request.gender, intent: request.intent, search: request.search }).filter(([, v]) => v))
  const returnTo = `/letters/discover${query.size ? `?${query}` : ''}`
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')
  const [t, letters, waitingCount, page] = await Promise.all([
    getTranslations('Discovery'), getTranslations('Letters'), getWaitingLetterCount(supabase, user.id), getDiscoveryPage(supabase, request),
  ])
  const entries = await discoveryEntries(supabase, page.candidates)
  await recordRoomExposureOpportunities(user.id, page.candidates, 'room')
  return <AppShell active="letters" waitingLetterCount={waitingCount}><main className="flex min-h-screen justify-center px-4 py-8 sm:px-8"><div className="w-full max-w-5xl space-y-6">
    <div><h1 className={pageTitleClass}>{letters('heading')}</h1><LettersTabs active="discover"/></div>
    <p className={helperTextClass}>{t('intro')}</p>
    <DiscoverFilters key={returnTo}/>
    {entries.length ? <PeopleBrowser key={returnTo} initialEntries={entries} initialHasMore={page.filteredCount > entries.length} request={request} returnTo={returnTo} profileLed /> : <p role="status" className={helperTextClass}>{t(page.unavailable ? 'unavailable' : 'empty')}</p>}
  </div></main></AppShell>
}
