import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getActiveQuestions, getCurrentAnswer } from '@/lib/questions'
import {
  sectionLabelClass,
  helperTextClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '@/app/profile/ui'

export default async function HomePage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('pseudonym')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) {
    redirect('/profile')
  }

  const [activeQuestions, currentAnswer] = await Promise.all([
    getActiveQuestions(supabase),
    getCurrentAnswer(supabase, user.id),
  ])

  async function signOut() {
    'use server'
    const supabase = await createClient()
    await supabase.auth.signOut()
    redirect('/sign-in')
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-10 py-10">
        <div className="flex items-center justify-between text-sm text-black/50 dark:text-white/50">
          <span>{profile.pseudonym}</span>
          <form action={signOut}>
            <button type="submit" className="hover:text-black/80 dark:hover:text-white/80">
              Sign out
            </button>
          </form>
        </div>

        {currentAnswer ? (
          <div className="space-y-6">
            <p className={sectionLabelClass}>The Question</p>
            <h1 className="text-2xl font-semibold leading-snug">
              {currentAnswer.prompt}
            </h1>
            <p className={helperTextClass}>
              Take your time. There is no right answer.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Link
                href={`/question/${currentAnswer.questionId}`}
                className={primaryButtonClass}
              >
                Read your answer
              </Link>
              <Link href="/question/discover" className={secondaryButtonClass}>
                Read other answers
              </Link>
            </div>
          </div>
        ) : activeQuestions.length > 0 ? (
          <div className="space-y-6">
            <p className={sectionLabelClass}>The Question</p>
            <p className="text-lg leading-relaxed">
              A few Questions are open right now. Choose the one that gives
              you the best opportunity to express yourself.
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <Link href="/question" className={primaryButtonClass}>
                Answer a Question
              </Link>
              <Link href="/question/discover" className={secondaryButtonClass}>
                Read other answers
              </Link>
            </div>
          </div>
        ) : (
          <p className={helperTextClass}>
            There isn&apos;t a question available right now.
          </p>
        )}
      </div>
    </main>
  )
}
