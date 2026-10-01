import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getCurrentRoomQuestion, getMyAnswers } from '@/lib/questions'
import { getWaitingLetterCount } from '@/lib/letters'
import { getDiscoveryPage, genderDisplay, DISCOVERY_BATCH_SIZE } from '@/lib/discovery'
import { recordRoomExposureOpportunities } from '@/lib/room-exposure'
import { hasCompletedGuide } from '@/lib/guide'
import { editorialTitleFor, getEditorialBylines } from '@/lib/editorial-byline'
import { publicProfileMarkUrl } from '@/lib/profile-marks'
import { getMemberWritingStyles } from '@/lib/writing-style-data'
import { pageTitleClass, helperTextClass, primaryButtonClass, secondaryButtonClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import FeatureIntroduction from '@/app/feature-introduction'
import FilterDisclosure from '@/app/minds/filter-disclosure'
import DiscoveryResults, { type DiscoveryEntry } from './discovery-results'
import QuestionSuggestionForm from './question-suggestion-form'

const BATCH_SIZE = DISCOVERY_BATCH_SIZE

function buildQuery(params: { country?: string; gender?: string; age?: string; batch?: string; question?: string; started?: string }) {
  const query = new URLSearchParams()
  if (params.country) query.set('country', params.country)
  if (params.gender) query.set('gender', params.gender)
  if (params.age) query.set('age', params.age)
  if (params.batch) query.set('batch', params.batch)
  if (params.question) query.set('question', params.question)
  if (params.started) query.set('started', params.started)
  return query.toString()
}

export default async function RoomPage({
  searchParams,
}: {
  searchParams: Promise<{ country?: string; gender?: string; age?: string; batch?: string; question?: string; started?: string }>
}) {
  const { country, gender, age, batch: batchParam, question: requestedQuestionId, started } = await searchParams
  const batch = Math.max(0, Number(batchParam) || 0)
  const t = await getTranslations('RoomEngagement')
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/sign-in')

  const [waitingCount, myAnswers, introSeen, liveQuestion] = await Promise.all([
    getWaitingLetterCount(supabase, user.id),
    getMyAnswers(supabase, user.id),
    hasCompletedGuide(supabase, user.id, 'people'),
    getCurrentRoomQuestion(supabase),
  ])

  const focusedQuestionId = liveQuestion && requestedQuestionId === liveQuestion.id
    ? liveQuestion.id
    : undefined

  const discovery = await getDiscoveryPage(supabase, {
    country,
    gender,
    ageRange: age,
    questionId: focusedQuestionId,
    browseStartedAt: started && Number.isFinite(Date.parse(started)) ? started : undefined,
    offset: batch * BATCH_SIZE,
    limit: BATCH_SIZE,
  })

  const liveAnswer = liveQuestion
    ? myAnswers.find((answer) => answer.questionId === liveQuestion.id) ?? null
    : null
  const firstAnswer = myAnswers.find((answer) => answer.isPrimary) ?? null

  const { candidates: page, eligibleCount, filteredCount } = discovery
  await recordRoomExposureOpportunities(user.id, page, focusedQuestionId ? 'room_question' : 'room')

  const windowStart = batch * BATCH_SIZE
  const hasMore = (discovery.fairRankingApplied ? page.length : windowStart + page.length) < filteredCount
  const poolExhausted = page.length === 0 && (
    filteredCount > 0 || (discovery.fairRankingApplied && Boolean(started) && eligibleCount > 0)
  )
  const writingStyles = await getMemberWritingStyles(supabase, page.map((candidate) => candidate.userId))

  const editorialBylines = await getEditorialBylines(supabase)
  const entries: DiscoveryEntry[] = page.map((candidate) => ({
    userId: candidate.userId,
    pseudonym: candidate.pseudonym,
    editorialTitle: editorialTitleFor(editorialBylines, candidate.pseudonym),
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

  const currentQuery = buildQuery({
    country,
    gender,
    age,
    batch: batch > 0 ? String(batch) : undefined,
    question: focusedQuestionId,
    started: discovery.browseStartedAt ?? undefined,
  })
  const currentRoomHref = currentQuery ? `/room?${currentQuery}` : '/room'
  const moreHref = `/room?${buildQuery({
    country,
    gender,
    age,
    batch: String(batch + 1),
    question: focusedQuestionId,
    started: discovery.browseStartedAt ?? undefined,
  })}`

  return (
    <AppShell active="room" waitingLetterCount={waitingCount}>
      <main className="min-h-screen flex justify-center p-6">
        <div className="w-full max-w-2xl space-y-10 py-10">
          <header className="space-y-2">
            <h1 className={pageTitleClass}>{t('title')}</h1>
            <p className="max-w-xl font-serif text-xl leading-relaxed text-foreground/80">
              {t('intro')}
            </p>
          </header>

          {!introSeen && (
            <FeatureIntroduction guideKey="people" title={t('readRoom')} ctaLabel={t('enterRoom')}>
              <p>{t('guideIntro')}</p>
            </FeatureIntroduction>
          )}

          {liveQuestion && (
            <section aria-labelledby="room-question-heading" className="rounded-lg border border-foreground/10 bg-surface-shell p-6 sm:p-8">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/50">{t('thisWeek')}</p>
              <h2 id="room-question-heading" className="mt-3 font-serif text-2xl leading-snug text-foreground sm:text-3xl">
                {liveQuestion.prompt}
              </h2>
              <p className={`mt-3 ${helperTextClass}`}>{t('fewLines')}</p>
              <div className="mt-6 flex flex-wrap items-center gap-3">
                <Link href={`/question/${liveQuestion.id}?source=room`} className={primaryButtonClass}>
                  {liveAnswer ? t('readEdit') : t('answerQuestion')}
                </Link>
                {focusedQuestionId ? (
                  <Link href="/room#read-the-room" className={secondaryButtonClass}>{t('findWriter')}</Link>
                ) : liveAnswer ? (
                  <a href="#read-the-room" className={secondaryButtonClass}>{t('readRoom')}</a>
                ) : null}
              </div>
            </section>
          )}

          <section id="read-the-room" aria-labelledby="read-room-heading" className="space-y-5 scroll-mt-6">
            <div className="flex items-end justify-between gap-4 border-b border-foreground/10 pb-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/50">
                  {focusedQuestionId ? t('week') : t('explore')}
                </p>
                <h2 id="read-room-heading" className="mt-1 font-serif text-2xl text-foreground">
                  {focusedQuestionId ? t('peopleSaid') : t('readRoom')}
                </h2>
                <p className={`mt-1 ${helperTextClass}`}>
                  {focusedQuestionId
                    ? t('sameQuestion')
                    : t('lookAround')}
                </p>
              </div>
              <FilterDisclosure country={country ?? ''} gender={gender ?? ''} ageRange={age ?? ''} />
            </div>

            {entries.length === 0 ? (
              <div className="space-y-2 py-2">
                <p className={helperTextClass}>
                  {poolExhausted
                    ? focusedQuestionId
                      ? t('answersExhausted')
                      : t('roomExhausted')
                    : eligibleCount === 0
                      ? focusedQuestionId
                        ? t('noAnswers')
                        : t('noPeople')
                      : t('noMatches')}
                </p>
                {!poolExhausted && eligibleCount > 0 && <p className={helperTextClass}>{t('widenFilters')}</p>}
                {!poolExhausted && eligibleCount === 0 && !focusedQuestionId && <p className={helperTextClass}>{t('moreArrivals')}</p>}
                {focusedQuestionId && (
                  <Link href="/room#read-the-room" className={secondaryButtonClass}>{t('findWriter')}</Link>
                )}
              </div>
            ) : (
              <>
                <DiscoveryResults entries={entries} returnTo={currentRoomHref} />
                {hasMore && (
                  <div className="flex justify-center">
                    <Link href={moreHref} className={secondaryButtonClass}>{t('keepLooking')}</Link>
                  </div>
                )}
              </>
            )}
          </section>

          {firstAnswer && (
            <section className="border-t border-foreground/10 pt-6">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground/50">{t('firstQuestion')}</p>
              <p className={`mt-2 max-w-xl ${helperTextClass}`}>
                {t('firstIntro')}
              </p>
            </section>
          )}

          <QuestionSuggestionForm />
        </div>
      </main>
    </AppShell>
  )
}
