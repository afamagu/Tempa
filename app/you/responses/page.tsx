import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getEligibleQuestions, getMyAnswers } from '@/lib/questions'
import { getWaitingLetterCount } from '@/lib/letters'
import { sectionTitleClass, secondaryButtonClass, pillClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import QuestionWorkspace from '@/app/minds/question-workspace'

/**
 * Onboarding & First-Use checkpoint — People Information Architecture
 * (Section F). A member's own response-management ("My answers"/"Answer
 * a Question", formerly two co-equal tabs on /minds alongside Explore)
 * now lives here, under You/self identity, where it conceptually
 * belongs — People stays discovery-only. Reuses QuestionWorkspace
 * exactly as it already existed (app/minds/question-workspace.tsx,
 * unmodified internally beyond its own retargeted internal link) rather
 * than rebuilding it — this route is purely a new, smaller host page
 * for the same existing component and the same existing data fetchers
 * (getEligibleQuestions/getMyAnswers, lib/questions.ts, unchanged).
 */
export default async function YourResponsesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab: tabParam } = await searchParams
  const tab: 'answers' | 'new' = tabParam === 'new' ? 'new' : 'answers'

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

  return (
    <AppShell active="you" waitingLetterCount={waitingCount}>
      <main className="min-h-screen flex justify-center p-6">
        <div className="w-full max-w-2xl space-y-8 py-10">
          <div className="space-y-2">
            <Link href="/you" className={secondaryButtonClass}>
              You
            </Link>
            <h1 className={sectionTitleClass}>Your responses</h1>
          </div>

          <div className="flex flex-wrap gap-2">
            <Link href="/you/responses" className={pillClass(tab === 'answers')}>
              My responses
            </Link>
            <Link href="/you/responses?tab=new" className={pillClass(tab === 'new')}>
              Answer another Question
            </Link>
          </div>

          <QuestionWorkspace
            tab={tab === 'new' ? 'new' : 'answers'}
            questions={eligibleQuestions}
            answers={myAnswers}
          />
        </div>
      </main>
    </AppShell>
  )
}
