import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getEligibleQuestions, getMyAnswers, needsParticipationGate } from '@/lib/questions'
import { getWaitingLetterCount } from '@/lib/letters'
import { getDiscoveryPage, genderDisplay, DISCOVERY_BATCH_SIZE } from '@/lib/discovery'
import { hasCompletedGuide } from '@/lib/guide'
import { publicProfileMarkUrl } from '@/lib/profile-marks'
import { pageTitleClass, helperTextClass, secondaryButtonClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import FeatureIntroduction from '@/app/feature-introduction'
import FilterDisclosure from './filter-disclosure'
import DiscoveryResults, { type DiscoveryEntry } from './discovery-results'
import QuestionIncompleteNotice from './question-incomplete-notice'

const BATCH_SIZE = DISCOVERY_BATCH_SIZE

function buildQuery(params: { country?: string; gender?: string; age?: string; batch?: string }) {
  const query = new URLSearchParams()
  if (params.country) query.set('country', params.country)
  if (params.gender) query.set('gender', params.gender)
  if (params.age) query.set('age', params.age)
  if (params.batch) query.set('batch', params.batch)
  return query.toString()
}

export default async function MindsPage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string; gender?: string; age?: string; batch?: string }>
}) {
  const { country, gender, age, batch: batchParam } = await searchParams
  const batch = Math.max(0, Number(batchParam) || 0)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  // One round of independent reads. Discovery itself is a single bounded
  // RPC (lib/discovery.ts): self, active correspondence partners,
  // already-contacted answers, block/Safety visibility, the
  // Flagship -> current -> latest visible representative-response rule,
  // filters, the stable per-viewer order and the six-per-batch window are
  // all applied in Postgres — only this batch reaches the server.
  const [waitingCount, eligibleQuestions, myAnswers, introSeen, discovery] = await Promise.all([
    getWaitingLetterCount(supabase, user.id),
    getEligibleQuestions(supabase, user.id),
    getMyAnswers(supabase, user.id),
    hasCompletedGuide(supabase, user.id, 'people'),
    getDiscoveryPage(supabase, { country, gender, ageRange: age, offset: batch * BATCH_SIZE, limit: BATCH_SIZE }),
  ])
  const needsAnswer = needsParticipationGate(eligibleQuestions.length, myAnswers.length)

  const { candidates: page, eligibleCount, filteredCount } = discovery
  const windowStart = batch * BATCH_SIZE
  const hasMore = windowStart + page.length < filteredCount
  const poolExhausted = filteredCount > 0 && page.length === 0

  const entries: DiscoveryEntry[] = page.map((candidate) => ({
    userId: candidate.userId,
    pseudonym: candidate.pseudonym,
    country: candidate.country,
    genderDisplay: genderDisplay(candidate.gender, candidate.genderCustom),
    ageRange: candidate.ageRange,
    markUrl: candidate.markId ? publicProfileMarkUrl(supabase, `${candidate.markId}.png`) : null,
    response: {
      id: candidate.answerId,
      body: candidate.body,
      prompt: candidate.prompt,
    },
  }))

  const currentQuery = buildQuery({ country, gender, age, batch: batch > 0 ? String(batch) : undefined })
  const currentPeopleHref = currentQuery ? `/minds?${currentQuery}` : '/minds'
  const moreHref = `/minds?${buildQuery({ country, gender, age, batch: String(batch + 1) })}`

  return (
    <AppShell active="minds" waitingLetterCount={waitingCount}>
      <main className="min-h-screen flex justify-center p-6">
        <div className="w-full max-w-2xl space-y-8 py-10">
          <h1 className={pageTitleClass}>People</h1>
          {!introSeen && (
            <FeatureIntroduction guideKey="people" title="People worth writing to" ctaLabel="Start exploring">
              <p>Tempa isn&rsquo;t about collecting followers. Take your time. Read a little of what someone has shared, and write when somebody genuinely catches your attention.</p>
            </FeatureIntroduction>
          )}
          {needsAnswer && <QuestionIncompleteNotice />}
          <FilterDisclosure country={country ?? ''} gender={gender ?? ''} ageRange={age ?? ''} />
          {entries.length === 0 ? (
            <div className="space-y-2">
              <p className={helperTextClass}>
                {poolExhausted ? "You've seen everyone in this pool for now." : eligibleCount === 0 ? "There's no one new to discover right now." : 'No one matches those filters right now.'}
              </p>
              {!poolExhausted && eligibleCount > 0 && <p className={helperTextClass}>Try widening your filters.</p>}
              {!poolExhausted && eligibleCount === 0 && <p className={helperTextClass}>Check back soon as more people join.</p>}
            </div>
          ) : (
            <>
              <DiscoveryResults entries={entries} returnTo={currentPeopleHref} />
              {hasMore && (
                <div className="flex justify-center"><Link href={moreHref} className={secondaryButtonClass}>Show me six more</Link></div>
              )}
            </>
          )}
        </div>
      </main>
    </AppShell>
  )
}
