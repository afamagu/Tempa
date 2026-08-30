import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getActiveQuestions, getCurrentAnswer } from '@/lib/questions'
import {
  sectionLabelClass,
  helperTextClass,
  secondaryButtonClass,
} from '@/app/profile/ui'

export default async function QuestionHubPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  const currentAnswer = await getCurrentAnswer(supabase, user.id)

  if (currentAnswer) {
    redirect(`/question/${currentAnswer.questionId}`)
  }

  const activeQuestions = await getActiveQuestions(supabase)

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md space-y-8 py-10">
        <div className="space-y-2">
          <p className={sectionLabelClass}>The Question</p>
          <h1 className="text-2xl font-semibold leading-snug">
            Choose the Question that gives you the best chance to express
            yourself.
          </h1>
        </div>

        {activeQuestions.length === 0 ? (
          <p className={helperTextClass}>
            There isn&apos;t a question available right now.
          </p>
        ) : (
          <div className="space-y-3">
            {activeQuestions.map((q) => (
              <Link
                key={q.id}
                href={`/question/${q.id}`}
                className="block w-full rounded-md border border-black/10 dark:border-white/20 px-4 py-4 text-left text-base leading-snug hover:border-black/25 dark:hover:border-white/35 active:bg-black/[.03] dark:active:bg-white/[.06]"
              >
                {q.prompt}
              </Link>
            ))}
          </div>
        )}

        <div className="flex flex-wrap gap-3">
          <Link href="/home" className={secondaryButtonClass}>
            Home
          </Link>
          <Link href="/question/discover" className={secondaryButtonClass}>
            Read other answers
          </Link>
        </div>
      </div>
    </main>
  )
}
