import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMyAnswers } from '@/lib/questions'
import { getWaitingLetterCount } from '@/lib/letters'
import { getDiscoveryPage, genderDisplay, DISCOVERY_BATCH_SIZE } from '@/lib/discovery'
import { hasCompletedGuide } from '@/lib/guide'
import { publicProfileMarkUrl } from '@/lib/profile-marks'
import { getMemberWritingStyles } from '@/lib/writing-style-data'
import { pageTitleClass, helperTextClass, primaryButtonClass, secondaryButtonClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import FeatureIntroduction from '@/app/feature-introduction'
import FilterDisclosure from '@/app/minds/filter-disclosure'
import DiscoveryResults, { type DiscoveryEntry } from './discovery-results'

const BATCH_SIZE = DISCOVERY_BATCH_SIZE

function buildQuery(params: { country?: string; gender?: string; age?: string; batch?: string }) {
  const query = new URLSearchParams()
  if (params.country) query.set('country', params.country)
  if (params.gender) query.set('gender', params.gender)
  if (params.age) query.set('age', params.age)
  if (params.batch) query.set('batch', params.batch)
  return query.toString()
}

export default async function RoomPage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string; gender?: string; age?: string; batch?: string }>
}) {
  const { country, gender, age, batch: batchParam } = await searchParams
  const batch = Math.max(0, Number(batchParam) || 0)
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  // Keep the existing three-slot admin data intact for historical safety, but
  // expose only ONE non-Flagship Question as the live communal Question.
  // This is deliberately application-level until production SQL state has been
  // reconciled; no historical Question or answer is deleted to achieve it.
  const [waitingCount, myAnswers, introSeen, discovery, { data: positionedQuestions }] = await Promise.all([
    getWaitingLetterCount(supabase, user.id),
    getMyAnswers(supabase, user.id),
    hasCompletedGuide(supabase, user.id, 'people'),
    getDiscoveryPage(supabase, {
      country,
      gender,
      ageRange: age,
      offset: batch * BATCH_SIZE,
      limit: BATCH_SIZE,
    }),
    supabase
      .from('questions')
      .select('id, prompt, current_position, is_flagship')
      .not('current_position', 'is', null)
      .eq('is_active', true)
      .order('current_position', { ascending: true }),
  ])

  const liveQuestion = (positionedQuestions ?? []).find((question) => !question.is_flagship) ?? null
  const liveAnswer = liveQuestion
    ? myAnswers.find((answer) => answer.questionId === liveQuestion.id) ?? null
    : null
  const firstAnswer = myAnswers.find((answer) => answer.isPrimary) ?? null

  const { candidates: page, eligibleCount, filteredCount } = discovery
  const windowStart = batch * BATCH_SIZE
  const hasMore = windowStart + page.length < filteredCount
  const poolExhausted = filteredCount > 0 && page.length === 0
  const writingStyles = await getMemberWritingStyles(supabase, page.map((candidate) => candidate.userId))

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
    writingStyleId: writingStyles.get(candidate.userId) ?? null,
  }))

  const currentQuery = buildQuery({ country, gender, age, batch: batch > 0 ? String(batch) : undefined })
  const currentRoomHref = currentQuery ? `/room?${currentQuery}` : '/room'
  const moreHref = `/room?${buildQuery({ country, gender, age, batch: String(batch + 1) })}`

  return (
    <AppShell active="room" waitingLetterCount={waitingCount}>
      <main className="min-h-screen flex justify-center p-6">
        <div className="w-full max-w-2xl space-y-10 py-10">
          <header className="space-y-2">
            <h1 className={pageTitleClass}>The Room</h1>
            <p className="max-w-xl font-serif text-xl leading-relaxed text-foreground/80">
              A question, answered in many different ways.
            </p>
          </header>

          {!introSeen && (
            <FeatureIntroduction guideKey="people" title="Read the Room" ctaLabel="Enter the Room">
              <p>Read first. If a person&rsquo;s words stay with you, that is a good reason to write. There are no followers to collect here.</p>
            </FeatureIntroduction>
          )}

          {liveQuestion && (
            <section aria-labelledby="room-question-heading" className="rounded-lg border border-foreground/10 bg-surface-shell p-6 sm:p-8">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/50">This week in The Room</p>
              <h2 id="room-question-heading" className="mt-3 font-serif text-2xl leading-snug text-foreground sm:text-3xl">
                {liveQuestion.prompt}
              </h2>
              <p className={`mt-3 ${helperTextClass}`}>A few lines is enough.</p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Link href={`/question/${liveQuestion.id}?source=room`} className={primaryButtonClass}>
                  {liveAnswer ? 'Read or edit your answer' : 'Answer the Question'}
                </Link>
                {liveAnswer && <a href="#read-the-room" className={secondaryButtonClass}>Read the Room</a>}
              </div>
            </section>
          )}

          <section id="read-the-room" aria-labelledby="read-room-heading" className="space-y-5 scroll-mt-6">
            <div className="flex items-end justify-between gap-4 border-b border-foreground/10 pb-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/50">Explore</p>
                <h2 id="read-room-heading" className="mt-1 font-serif text-2xl text-foreground">Read the Room</h2>
                <p className={`mt-1 ${helperTextClass}`}>Take a look around through what people have actually written.</p>
              </div>
              <FilterDisclosure country={country ?? ''} gender={gender ?? ''} ageRange={age ?? ''} />
            </div>

            {entries.length === 0 ? (
              <div className="space-y-2 py-2">
                <p className={helperTextClass}>
                  {poolExhausted
                    ? "You've read everyone in this part of the Room for now."
                    : eligibleCount === 0
                      ? "There's no one new to read right now."
                      : 'No one matches those filters right now.'}
                </p>
                {!poolExhausted && eligibleCount > 0 && <p className={helperTextClass}>Try widening your filters.</p>}
                {!poolExhausted && eligibleCount === 0 && <p className={helperTextClass}>The Room will change as more people arrive.</p>}
              </div>
            ) : (
              <>
                <DiscoveryResults entries={entries} returnTo={currentRoomHref} />
                {hasMore && (
                  <div className="flex justify-center">
                    <Link href={moreHref} className={secondaryButtonClass}>Read six more</Link>
                  </div>
                )}
              </>
            )}
          </section>

          {firstAnswer && (
            <section className="border-t border-foreground/10 pt-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/50">The First Question</p>
              <p className={`mt-2 max-w-xl ${helperTextClass}`}>
                Everyone enters Tempa through the same question. Your answer remains part of how people first encounter you in the Room.
              </p>
            </section>
          )}
        </div>
      </main>
    </AppShell>
  )
}
