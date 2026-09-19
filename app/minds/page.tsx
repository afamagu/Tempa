import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getEligibleQuestions, getMyAnswers, getFlagshipQuestion, needsParticipationGate } from '@/lib/questions'
import {
  getWaitingLetterCount,
  getActiveCorrespondencePartnerIds,
  getContactedAnswerIds,
} from '@/lib/letters'
import { hasCompletedGuide } from '@/lib/guide'
import { sectionTitleClass, helperTextClass, secondaryButtonClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import FeatureIntroduction from '@/app/feature-introduction'
import FilterDisclosure from './filter-disclosure'
import DiscoveryResults, { type DiscoveryEntry } from './discovery-results'
import QuestionIncompleteNotice from './question-incomplete-notice'

const BATCH_SIZE = 6

function hashPair(viewerId: string, candidateId: string): number {
  let h = 2166136261
  const combined = `${viewerId}:${candidateId}`
  for (let i = 0; i < combined.length; i++) {
    h ^= combined.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function stableShuffle<T extends { id: string }>(items: T[], viewerId: string): T[] {
  return [...items].sort((a, b) => hashPair(viewerId, a.id) - hashPair(viewerId, b.id))
}

function genderDisplay(gender: string | null, genderCustom: string | null) {
  if (!gender || gender === 'Prefer not to say') return null
  if (gender === 'Self-describe') return genderCustom || null
  return gender
}

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

  const [waitingCount, eligibleQuestions, myAnswers, introSeen] = await Promise.all([
    getWaitingLetterCount(supabase, user.id),
    getEligibleQuestions(supabase, user.id),
    getMyAnswers(supabase, user.id),
    hasCompletedGuide(supabase, user.id, 'people'),
  ])
  const needsAnswer = needsParticipationGate(eligibleQuestions.length, myAnswers.length)

  const flagship = await getFlagshipQuestion(supabase)
  const flagshipPrompt = flagship?.prompt ?? ''

  const [{ data: profiles }, { data: flagshipAnswers }, excludedPartnerIds, contactedAnswerIds] = await Promise.all([
    supabase
      .from('public_profiles')
      .select('id, pseudonym, country, gender, gender_custom, age_range')
      .neq('id', user.id),
    flagship
      ? supabase
          .from('question_answers')
          .select('id, user_id, body')
          .eq('question_id', flagship.id)
          .eq('moderation_status', 'visible')
      : Promise.resolve({ data: [] as { id: string; user_id: string; body: string }[] }),
    getActiveCorrespondencePartnerIds(supabase, user.id),
    getContactedAnswerIds(supabase, user.id),
  ])

  const flagshipAnswerByUserId = new Map(
    (flagshipAnswers ?? []).map((a) => [a.user_id, { id: a.id, body: a.body }])
  )

  // People is a discovery-through-writing surface. A profile does not enter
  // the pool until it has a visible Flagship response, so every card has the
  // same promise and the same interaction: open the response reader first.
  const eligibleProfiles = (profiles ?? []).filter((p) => {
    if (excludedPartnerIds.has(p.id)) return false
    const answer = flagshipAnswerByUserId.get(p.id)
    if (!answer) return false
    if (contactedAnswerIds.has(answer.id)) return false
    return true
  })

  const pool = eligibleProfiles
    .filter((p) => (country ? p.country === country : true))
    .filter((p) => gender ? genderDisplay(p.gender, p.gender_custom) === gender || p.gender === gender : true)
    .filter((p) => (age ? p.age_range === age : true))

  const ordered = stableShuffle(pool, user.id)
  const windowStart = batch * BATCH_SIZE
  const page = ordered.slice(windowStart, windowStart + BATCH_SIZE)
  const hasMore = windowStart + page.length < ordered.length
  const poolExhausted = ordered.length > 0 && page.length === 0

  const entries: DiscoveryEntry[] = page.map((p) => {
    const answer = flagshipAnswerByUserId.get(p.id)!
    return {
      userId: p.id,
      pseudonym: p.pseudonym,
      country: p.country,
      genderDisplay: genderDisplay(p.gender, p.gender_custom),
      ageRange: p.age_range,
      response: { id: answer.id, body: answer.body, prompt: flagshipPrompt },
    }
  })

  const currentQuery = buildQuery({
    country,
    gender,
    age,
    batch: batch > 0 ? String(batch) : undefined,
  })
  const currentPeopleHref = currentQuery ? `/minds?${currentQuery}` : '/minds'
  const moreHref = `/minds?${buildQuery({ country, gender, age, batch: String(batch + 1) })}`

  return (
    <AppShell active="minds" waitingLetterCount={waitingCount}>
      <main className="min-h-screen flex justify-center p-6">
        <div className="w-full max-w-2xl space-y-8 py-10">
          <h1 className={sectionTitleClass}>People</h1>

          {!introSeen && (
            <FeatureIntroduction guideKey="people" title="People worth writing to" ctaLabel="Start exploring">
              <p>
                Tempa isn&rsquo;t about collecting followers. Take your time. Read a little of what
                someone has shared, and write when somebody genuinely catches your attention.
              </p>
            </FeatureIntroduction>
          )}

          {needsAnswer && <QuestionIncompleteNotice />}

          <FilterDisclosure country={country ?? ''} gender={gender ?? ''} ageRange={age ?? ''} />

          {entries.length === 0 ? (
            <div className="space-y-2">
              <p className={helperTextClass}>
                {poolExhausted
                  ? "You've seen everyone in this pool for now."
                  : eligibleProfiles.length === 0
                    ? "There's no one new to discover right now."
                    : 'No one matches those filters right now.'}
              </p>
              {!poolExhausted && eligibleProfiles.length > 0 && (
                <p className={helperTextClass}>Try widening your filters.</p>
              )}
              {!poolExhausted && eligibleProfiles.length === 0 && (
                <p className={helperTextClass}>Check back soon as more people join.</p>
              )}
            </div>
          ) : (
            <>
              <DiscoveryResults entries={entries} returnTo={currentPeopleHref} />
              {hasMore && (
                <div className="flex justify-center">
                  <Link href={moreHref} className={secondaryButtonClass}>
                    Show me six more
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </AppShell>
  )
}
