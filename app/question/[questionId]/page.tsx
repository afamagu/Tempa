import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getQuestionById, getEligibleQuestions, nextEligibleQuestion } from '@/lib/questions'
import QuestionAnswer from '../question-answer'

export default async function QuestionWritePage({
  params,
}: {
  params: Promise<{ questionId: string }>
}) {
  const { questionId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  const question = await getQuestionById(supabase, questionId)

  if (!question) {
    redirect('/minds?view=answer')
  }

  const [{ data: answer }, eligibleQuestions] = await Promise.all([
    supabase
      .from('question_answers')
      .select('body, updated_at, is_current')
      .eq('question_id', question.id)
      .eq('user_id', user.id)
      .maybeSingle(),
    getEligibleQuestions(supabase, user.id),
  ])

  // Question source-of-truth correction: "next" is no longer a fixed-
  // order wraparound over 3 canonical slugs — it's simply the first
  // other currently-eligible (active, unanswered, family-diverse)
  // Question, or null once nothing else is left.
  const nextQuestion = nextEligibleQuestion(eligibleQuestions, question.id)

  return (
    <QuestionAnswer
      userId={user.id}
      questionId={question.id}
      prompt={question.prompt}
      isActive={question.isActive}
      initialAnswer={answer?.body ?? null}
      initialIsCurrent={answer?.is_current ?? false}
      nextQuestion={nextQuestion}
    />
  )
}
