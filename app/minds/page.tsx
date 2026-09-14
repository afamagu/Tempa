import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getEligibleQuestions, getMyAnswers, getFlagshipQuestion, needsParticipationGate } from '@/lib/questions'
import {
  getWaitingLetterCount,
  getActiveCorrespondencePartnerIds,
  getContactedAnswerIds,
} from '@/lib/letters'
import { sectionTitleClass, helperTextClass, secondaryButtonClass, pillClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import FilterDisclosure from './filter-disclosure'
import DiscoveryResults, { type DiscoveryEntry } from './discovery-results'
import QuestionWorkspace from './question-workspace'
import QuestionIncompleteNotice from './question-incomplete-notice'

const BATCH_SIZE = 6

// A pure, deterministic hash of (viewerId, candidateId) — not Math.random(),
// so it's safe to call during render. Keying on the viewer as well as the
// candidate means different viewers get different fair orderings of the
// same pool (no systematic first-batch advantage for whoever happens to
// hash lowest overall), while a single viewer's ordering stays stable
// across requests — which is what lets a batch survive a refresh or a
// back-navigation from the reading/write flow without needing any seed
// stored in the URL: it falls straight out of sorting by a stable value.
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

function buildQuery(params: {
  country?: string
  gender?: string
  age?: string
  batch?: string
}) {
  const query = new URLSearchParams()
  if (params.country) query.set('country', params.country)
  if (params.gender) query.set('gender', params.gender)
  if (params.age) query.set('age', params.age)
  if (params.batch) query.set('batch', params.batch)
  return query.toString()
}

type MindsView = 'explore' | 'answers' | 'answer'

// A small, quiet dot — never a count, never urgent-red — the
// persistent half of the non-blocking Question-completion nudge (see
// QuestionIncompleteNotice for the openable, dismissible half).
function IncompleteDot() {
  return (
    <span
      aria-hidden="true"
      className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle"
    />
  )
}

function MindsTabs({ view, needsAnswer }: { view: MindsView; needsAnswer: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Link href="/minds" className={pillClass(view === 'explore')}>
        Explore
      </Link>
      <Link href="/minds?view=answers" className={pillClass(view === 'answers')}>
        My answers
      </Link>
      <Link href="/minds?view=answer" className={pillClass(view === 'answer')}>
        Answer a Question
        {needsAnswer && <IncompleteDot />}
      </Link>
    </div>
  )
}

export default async function MindsPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string
    country?: string
    gender?: string
    age?: string
    batch?: string
  }>
}) {
  const { view: viewParam, country, gender, age, batch: batchParam } = await searchParams
  const view: MindsView =
    viewParam === 'answers' ? 'answers' : viewParam === 'answer' ? 'answer' : 'explore'
  const batch = Math.max(0, Number(batchParam) || 0)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  const [waitingCount, eligibleQuestions, myAnswers] = await Promise.all([
    getWaitingLetterCount(supabase, user.id),
    getEligibleQuestions(supabase, user.id),
    getMyAnswers(supabase, user.id),
  ])
  // Encouragement, never a gate: a quiet dot on the "Answer a Question"
  // tab (both branches below) plus an openable, dismissible notice on
  // Explore specifically (see QuestionIncompleteNotice) — replaces the
  // old forced redirect into the Question flow, which discarded
  // wherever the member actually meant to go.
  const needsAnswer = needsParticipationGate(eligibleQuestions.length, myAnswers.length)

  if (view !== 'explore') {
    return (
      <AppShell active="minds" waitingLetterCount={waitingCount}>
        <main className="min-h-screen flex justify-center p-6">
          <div className="w-full max-w-2xl space-y-8 py-10">
            <h1 className={sectionTitleClass}>Minds</h1>
            <MindsTabs view={view} needsAnswer={needsAnswer} />
            <QuestionWorkspace
              tab={view === 'answer' ? 'new' : 'answers'}
              questions={eligibleQuestions}
              answers={myAnswers}
            />
          </div>
        </main>
      </AppShell>
    )
  }

  // Discovery's pool is strictly "answers to the current Flagship
  // Question," never is_current (member-choosable, and no longer what
  // determines Minds eligibility at all). Flagship is a separate,
  // admin-chosen bit of state (questions.is_flagship) — NEVER
  // permanently tied to slot #1 or any other particular slot number
  // (getFlagshipQuestion resolves it directly; this file never reads
  // current_position to find it). A member who hasn't answered the
  // current Flagship — even if they have a perfectly good answer to
  // another current Question, even if is_current happens to point
  // elsewhere — is simply not in this pool. No fallback, ever.
  const flagship = await getFlagshipQuestion(supabase)

  const [{ data: answers }, excludedPartnerIds, contactedAnswerIds] = await Promise.all([
    flagship
      ? supabase
          .from('question_answers')
          .select('id, user_id, question_id, body')
          .eq('question_id', flagship.id)
          .eq('moderation_status', 'visible')
          .neq('user_id', user.id)
      : Promise.resolve({ data: [] as { id: string; user_id: string; question_id: string; body: string }[] }),
    getActiveCorrespondencePartnerIds(supabase, user.id),
    getContactedAnswerIds(supabase, user.id),
  ])

  const eligible = (answers ?? []).filter(
    (a) => !excludedPartnerIds.has(a.user_id) && !contactedAnswerIds.has(a.id)
  )

  // Every entry in this pool answers the SAME Question (the flagship),
  // so there is exactly one prompt to resolve, not a per-answer lookup.
  const flagshipPrompt = flagship?.prompt ?? ''

  const userIds = [...new Set(eligible.map((a) => a.user_id))]
  const profilesById = new Map<
    string,
    { pseudonym: string; country: string; gender: string | null; gender_custom: string | null; age_range: string }
  >()

  if (userIds.length > 0) {
    const { data: profiles } = await supabase
      .from('public_profiles')
      .select('id, pseudonym, country, gender, gender_custom, age_range')
      .in('id', userIds)

    for (const p of profiles ?? []) {
      profilesById.set(p.id, p)
    }
  }

  // "Any" (an empty filter value) means no constraint on that field — it
  // is never compared against a stored column value.
  const pool = eligible
    .map((a) => ({ ...a, profile: profilesById.get(a.user_id) }))
    .filter(
      (a): a is typeof a & { profile: NonNullable<typeof a.profile> } =>
        a.profile !== undefined
    )
    .filter((a) => (country ? a.profile.country === country : true))
    .filter((a) =>
      gender
        ? genderDisplay(a.profile.gender, a.profile.gender_custom) === gender ||
          a.profile.gender === gender
        : true
    )
    .filter((a) => (age ? a.profile.age_range === age : true))

  const ordered = stableShuffle(pool, user.id)
  const windowStart = batch * BATCH_SIZE
  const page = ordered.slice(windowStart, windowStart + BATCH_SIZE)
  const hasMore = windowStart + page.length < ordered.length
  const poolExhausted = ordered.length > 0 && page.length === 0

  const entries: DiscoveryEntry[] = page.map((a) => ({
    id: a.id,
    userId: a.user_id,
    questionId: a.question_id,
    body: a.body,
    pseudonym: a.profile.pseudonym,
    country: a.profile.country,
    genderDisplay: genderDisplay(a.profile.gender, a.profile.gender_custom),
    ageRange: a.profile.age_range,
    prompt: flagshipPrompt,
  }))

  const moreHref = `/minds?${buildQuery({
    country,
    gender,
    age,
    batch: String(batch + 1),
  })}`

  return (
    <AppShell active="minds" waitingLetterCount={waitingCount}>
      <main className="min-h-screen flex justify-center p-6">
        <div className="w-full max-w-2xl space-y-8 py-10">
          <h1 className={sectionTitleClass}>Minds</h1>
          <MindsTabs view={view} needsAnswer={needsAnswer} />

          {needsAnswer && <QuestionIncompleteNotice />}

          {/* Discoverability of an existing current answer never depends
              on whether the active-Question library is currently
              non-empty — that library only governs which Questions are
              OFFERED to someone answering a brand-new one. Filters and
              results always render; the empty state below (driven by
              the actual eligible pool, not activeQuestions) is what
              distinguishes "you've seen everyone" from "no one's
              answered yet." */}
          <FilterDisclosure
            country={country ?? ''}
            gender={gender ?? ''}
            ageRange={age ?? ''}
          />

          {entries.length === 0 ? (
            <div className="space-y-2">
              <p className={helperTextClass}>
                {poolExhausted
                  ? "You've seen everyone in this pool for now."
                  : 'No answers match right now.'}
              </p>
              {!poolExhausted && (
                <p className={helperTextClass}>
                  Try widening your filters, or check back as more minds answer.
                </p>
              )}
            </div>
          ) : (
            <>
              <DiscoveryResults entries={entries} />
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
