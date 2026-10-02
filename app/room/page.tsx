import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentRoomQuestion, getMyAnswers } from '@/lib/questions'
import { getWaitingLetterCount } from '@/lib/letters'
import { readRoomAnswers, readRoomLibrary } from '@/lib/room-reading'
import { hasCompletedGuide } from '@/lib/guide'
import AppShell from '@/app/app-shell'
import FeatureIntroduction from '@/app/feature-introduction'
import FilterDisclosure from '@/app/minds/filter-disclosure'
import RoomQuestionCredit from '@/app/member-questions/room-question-credit'
import { pageTitleClass, helperTextClass, primaryButtonClass, secondaryButtonClass } from '@/app/profile/ui'
import QuestionAnswerBrowser from './question-answer-browser'
import QuestionSuggestionForm from './question-suggestion-form'
import QuestionLibraryCards from './question-library-cards'

export default async function RoomPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const raw = await searchParams
  const textParam = (key: string) => typeof raw[key] === 'string' ? raw[key].slice(0, 100) : undefined
  const params = { country: textParam('country'), gender: textParam('gender'), age: textParam('age'), question: textParam('question') }
  const client = await createClient()
  const { data: { user } } = await client.auth.getUser()
  if (!user) redirect('/sign-in')
  const t = await getTranslations('RoomEngagement')
  const [live, mine, waiting, introSeen, library] = await Promise.all([
    getCurrentRoomQuestion(client), getMyAnswers(client, user.id), getWaitingLetterCount(client, user.id),
    hasCompletedGuide(client, user.id, 'people'), readRoomLibrary(client),
  ])
  let question = live
  if (params.question && params.question !== live?.id) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(params.question)) notFound()
    const { data: allowed, error } = await client.rpc('room_question_published', { p_question_id: params.question })
    if (error || allowed !== true) notFound()
    const { data } = await client.from('questions').select('id,prompt').eq('id', params.question).maybeSingle()
    if (!data) notFound()
    question = data
  }
  const filters = { country: params.country, gender: params.gender, age: params.age }
  const query = new URLSearchParams()
  if (question) query.set('question', question.id)
  for (const [key, value] of Object.entries(filters)) if (value) query.set(key, value)
  const returnTo = query.size ? `/room?${query}` : '/room'
  const answers = question ? await readRoomAnswers(client, question.id, filters) : null
  const current = question?.id === live?.id
  const answered = mine.some(a => a.questionId === question?.id)
  const earlier = library.questions.filter(q => !q.is_current)
  return <AppShell active="room" waitingLetterCount={waiting}>
    <main className="mx-auto w-full max-w-3xl space-y-10 px-6 py-10">
      <header className="space-y-2"><h1 className={pageTitleClass}>{t('title')}</h1><p className="font-serif text-xl text-foreground/80">Read what people have written. Let a conversation begin there.</p></header>
      {!introSeen && <FeatureIntroduction guideKey="people" title={t('readRoom')} ctaLabel={t('enterRoom')}><p>{t('guideIntro')}</p></FeatureIntroduction>}
      {question && <section className="space-y-6" aria-labelledby="room-question-heading">
        <div className="rounded-lg border border-foreground/10 bg-surface-shell p-6 sm:p-8">
          <p className="text-xs uppercase tracking-widest text-foreground/55">{current ? 'This week in the Room' : 'From the question library'}</p>
          <h2 id="room-question-heading" className="my-4 font-serif text-2xl leading-relaxed sm:text-3xl">{question.prompt}</h2>
          <RoomQuestionCredit questionId={question.id} />
          <div className="mt-6">{current ? <Link href={`/question/${question.id}?source=room`} className={primaryButtonClass}>{answered ? t('readEdit') : t('answerQuestion')}</Link> : <Link href="/room" className={secondaryButtonClass}>Back to this week&apos;s question</Link>}</div>
        </div>
        <div id="question-answers" className="space-y-5 scroll-mt-6">
          <div className="space-y-3"><h3 className="font-serif text-xl">See how people answered</h3><FilterDisclosure country={params.country ?? ''} gender={params.gender ?? ''} ageRange={params.age ?? ''} /></div>
          {answers && <QuestionAnswerBrowser viewerId={user.id} key={returnTo} questionId={question.id} initial={answers} filters={filters} returnTo={returnTo} />}
        </div>
      </section>}
      <QuestionSuggestionForm />
      <section id="read-the-room" className="space-y-5 border-t border-foreground/10 pt-8">
        <div><p className="text-xs uppercase tracking-widest text-foreground/55">Explore</p><h2 className="mt-2 font-serif text-2xl">Read the Room</h2><p className={`mt-2 ${helperTextClass}`}>Explore how people answered earlier questions.</p></div>
        {library.error ? <p role="alert" className="text-sm text-red-600">{library.error}</p> : <QuestionLibraryCards questions={earlier} />}
        <Link href="/room/questions" className={secondaryButtonClass}>Explore the question library</Link>
      </section>
      <section className="border-t border-foreground/10 pt-6"><Link href="/letters/discover" className={secondaryButtonClass}>Discover People</Link></section>
    </main>
  </AppShell>
}
