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

export default async function MindsPage({
  searchParams,
}: {
  searchParams: Promise<{
    country?: string
    gender?: string
    age?: string
    batch?: string
  }>
}) {
  const { country, gender, age, batch: batchParam } = await searchParams
  const batch = Math.max(0, Number(batchParam) || 0)

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  const [waitingCount, eligibleQuestions, myAnswers, introSeen] = await Promise.all([
    getWaitingLetterCount(supabase, user.id),
    getEligibleQuestions(supabase, user.id),
    getMyAnswers(supabase, user.id),
    hasCompletedGuide(supabase, user.id, 'people'),
  ])
  // Encouragement, never a gate: an openable, dismissible notice (see
  // QuestionIncompleteNotice) — replaces the old forced redirect into
  // the Question flow, which discarded wherever the member actually
  // meant to go. Response management itself (My responses/Answer a
  // Question) now lives at /you/responses, not here — People is
  // discovery-only (Onboarding & First-Use checkpoint, People
  // Information Architecture).
  const needsAnswer = needsParticipationGate(eligibleQuestions.length, myAnswers.length)

  // People-first discovery (Post-onboarding corrections checkpoint,
  // Section A/B): the default population is every eligible PERSON —
  // sourced from public_profiles directly — never gated on having
  // answered any particular Question. public_profiles is itself
  // full-block-aware at the view/RLS level (see
  // docs/sql/2026-09-12-scoped-blocking-and-fixes.sql, section 2: its
  // block-check helper was redefined to mean "scope = 'full' only"), so
  // a full block is already excluded here for free, and a
  // 'letters'-only (Stop Letters) block correctly does NOT hide a
  // profile from this surface, matching the established safety
  // contract. The Flagship Question's answer (if any) is fetched
  // separately and merged on afterward, purely to decide what a card
  // previews — it is never what decides who's IN the pool.
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

  // Active-correspondence partners are excluded outright (existing pen
  // pals belong in Letters, not discovery). A person whose Flagship
  // answer has already been written to (getContactedAnswerIds — the
  // exact same "don't resurface what I already acted on" exclusion this
  // page has always applied) is excluded too, preserving today's
  // behavior for anyone with a response; it never applies to someone
  // with no Flagship answer, since there's nothing yet to have
  // contacted them about.
  const eligibleProfiles = (profiles ?? []).filter((p) => {
    if (excludedPartnerIds.has(p.id)) return false
    const answer = flagshipAnswerByUserId.get(p.id)
    if (answer && contactedAnswerIds.has(answer.id)) return false
    return true
  })

  // "Any" (an empty filter value) means no constraint on that field — it
  // is never compared against a stored column value.
  const pool = eligibleProfiles
    .filter((p) => (country ? p.country === country : true))
    .filter((p) =>
      gender ? genderDisplay(p.gender, p.gender_custom) === gender || p.gender === gender : true
    )
    .filter((p) => (age ? p.age_range === age : true))

  const ordered = stableShuffle(pool, user.id)
  const windowStart = batch * BATCH_SIZE
  const page = ordered.slice(windowStart, windowStart + BATCH_SIZE)
  const hasMore = windowStart + page.length < ordered.length
  const poolExhausted = ordered.length > 0 && page.length === 0

  const entries: DiscoveryEntry[] = page.map((p) => {
    const answer = flagshipAnswerByUserId.get(p.id)
    return {
      userId: p.id,
      pseudonym: p.pseudonym,
      country: p.country,
      genderDisplay: genderDisplay(p.gender, p.gender_custom),
      ageRange: p.age_range,
      response: answer ? { id: answer.id, body: answer.body, prompt: flagshipPrompt } : null,
    }
  })

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
          <h1 className={sectionTitleClass}>People</h1>

          {/* Onboarding & First-Use checkpoint — shown once, the first
              time this member ever encounters People; dismissing it
              marks 'people' complete in guide_completions and it never
              reappears. Replayable later from You → Tempa Guide. */}
          {!introSeen && (
            <FeatureIntroduction guideKey="people" title="People worth writing to" ctaLabel="Start exploring">
              <p>
                Tempa isn&rsquo;t about collecting followers. Take your time. Open someone&rsquo;s
                profile, read a little of what they&rsquo;ve shared, and write when somebody
                genuinely catches your attention.
              </p>
            </FeatureIntroduction>
          )}

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
              {/* People-level empty states (Post-onboarding corrections
                  checkpoint, Section C) — this is a directory of people,
                  never a response search, so the copy never claims
                  "responses" didn't match. Three distinct, calm cases:
                  paged past everyone in the pool; filters narrowed an
                  otherwise non-empty pool to zero; or there is genuinely
                  no one new to discover yet, regardless of filters. */}
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
