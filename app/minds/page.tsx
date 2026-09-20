import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getEligibleQuestions, getMyAnswers, getFlagshipQuestion, needsParticipationGate } from '@/lib/questions'
import { getWaitingLetterCount, getActiveCorrespondencePartnerIds, getContactedAnswerIds } from '@/lib/letters'
import { hasCompletedGuide } from '@/lib/guide'
import { publicProfileMarkUrl } from '@/lib/profile-marks'
import { sectionTitleClass, helperTextClass, secondaryButtonClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import FeatureIntroduction from '@/app/feature-introduction'
import FilterDisclosure from './filter-disclosure'
import DiscoveryResults, { type DiscoveryEntry } from './discovery-results'
import QuestionIncompleteNotice from './question-incomplete-notice'

const BATCH_SIZE = 6

type DiscoveryAnswerRow = {
  id: string
  user_id: string
  question_id: string
  body: string
  updated_at: string
  is_current: boolean
}

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

/** Pick the writing that represents this person in discovery. New members use
 * the current Flagship response. Established members who pre-date that
 * Flagship retain their previously-current response instead of disappearing.
 * The final latest-visible fallback keeps historical profiles discoverable
 * even when old data has no is_current flag. */
export function chooseDiscoveryAnswer(
  answers: DiscoveryAnswerRow[],
  flagshipId: string | null
): DiscoveryAnswerRow | null {
  if (answers.length === 0) return null
  const flagship = flagshipId ? answers.find((answer) => answer.question_id === flagshipId) : null
  if (flagship) return flagship
  const current = answers.find((answer) => answer.is_current)
  if (current) return current
  return [...answers].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] ?? null
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

  const [waitingCount, eligibleQuestions, myAnswers, introSeen, flagship] = await Promise.all([
    getWaitingLetterCount(supabase, user.id),
    getEligibleQuestions(supabase, user.id),
    getMyAnswers(supabase, user.id),
    hasCompletedGuide(supabase, user.id, 'people'),
    getFlagshipQuestion(supabase),
  ])
  const needsAnswer = needsParticipationGate(eligibleQuestions.length, myAnswers.length)

  const [{ data: profiles }, { data: visibleAnswers }, excludedPartnerIds, contactedAnswerIds] = await Promise.all([
    supabase
      .from('public_profiles')
      .select('id, pseudonym, country, gender, gender_custom, age_range, mark_id')
      .neq('id', user.id),
    supabase
      .from('question_answers')
      .select('id, user_id, question_id, body, updated_at, is_current')
      .eq('moderation_status', 'visible'),
    getActiveCorrespondencePartnerIds(supabase, user.id),
    getContactedAnswerIds(supabase, user.id),
  ])

  const answers = (visibleAnswers ?? []) as DiscoveryAnswerRow[]
  const questionIds = [...new Set(answers.map((answer) => answer.question_id))]
  const { data: questionRows } = questionIds.length > 0
    ? await supabase.from('questions').select('id, prompt').in('id', questionIds)
    : { data: [] as { id: string; prompt: string }[] }
  const promptsById = new Map((questionRows ?? []).map((question) => [question.id, question.prompt]))

  const answersByUserId = new Map<string, DiscoveryAnswerRow[]>()
  for (const answer of answers) {
    const existing = answersByUserId.get(answer.user_id) ?? []
    existing.push(answer)
    answersByUserId.set(answer.user_id, existing)
  }

  const discoveryAnswerByUserId = new Map<string, DiscoveryAnswerRow>()
  for (const [userId, userAnswers] of answersByUserId) {
    const answer = chooseDiscoveryAnswer(userAnswers, flagship?.id ?? null)
    if (answer) discoveryAnswerByUserId.set(userId, answer)
  }

  // People is discovery through writing, but changing the Flagship must never
  // erase established members. A person needs some visible discovery response,
  // not specifically an answer to today's Flagship Question.
  const eligibleProfiles = (profiles ?? []).filter((profile) => {
    if (excludedPartnerIds.has(profile.id)) return false
    const answer = discoveryAnswerByUserId.get(profile.id)
    if (!answer) return false
    if (contactedAnswerIds.has(answer.id)) return false
    return true
  })

  const pool = eligibleProfiles
    .filter((profile) => (country ? profile.country === country : true))
    .filter((profile) => gender ? genderDisplay(profile.gender, profile.gender_custom) === gender || profile.gender === gender : true)
    .filter((profile) => (age ? profile.age_range === age : true))

  const ordered = stableShuffle(pool, user.id)
  const windowStart = batch * BATCH_SIZE
  const page = ordered.slice(windowStart, windowStart + BATCH_SIZE)
  const hasMore = windowStart + page.length < ordered.length
  const poolExhausted = ordered.length > 0 && page.length === 0

  const entries: DiscoveryEntry[] = page.map((profile) => {
    const answer = discoveryAnswerByUserId.get(profile.id)!
    return {
      userId: profile.id,
      pseudonym: profile.pseudonym,
      country: profile.country,
      genderDisplay: genderDisplay(profile.gender, profile.gender_custom),
      ageRange: profile.age_range,
      markUrl: profile.mark_id ? publicProfileMarkUrl(supabase, `${profile.mark_id}.png`) : null,
      response: {
        id: answer.id,
        body: answer.body,
        prompt: promptsById.get(answer.question_id) ?? '',
      },
    }
  })

  const currentQuery = buildQuery({ country, gender, age, batch: batch > 0 ? String(batch) : undefined })
  const currentPeopleHref = currentQuery ? `/minds?${currentQuery}` : '/minds'
  const moreHref = `/minds?${buildQuery({ country, gender, age, batch: String(batch + 1) })}`

  return (
    <AppShell active="minds" waitingLetterCount={waitingCount}>
      <main className="min-h-screen flex justify-center p-6">
        <div className="w-full max-w-2xl space-y-8 py-10">
          <h1 className={sectionTitleClass}>People</h1>
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
                {poolExhausted ? "You've seen everyone in this pool for now." : eligibleProfiles.length === 0 ? "There's no one new to discover right now." : 'No one matches those filters right now.'}
              </p>
              {!poolExhausted && eligibleProfiles.length > 0 && <p className={helperTextClass}>Try widening your filters.</p>}
              {!poolExhausted && eligibleProfiles.length === 0 && <p className={helperTextClass}>Check back soon as more people join.</p>}
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
