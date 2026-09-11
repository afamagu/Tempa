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

  // "Next" is simply the first other currently-eligible (positioned,
  // unanswered) Question in #1/#2/#3 order, or null once nothing else
  // is left — no fixed-order wraparound needed with only 3 possible
  // slots.
  const nextQuestion = nextEligibleQuestion(eligibleQuestions, question.id)

  return (
    <QuestionAnswer
      userId={user.id}
      questionId={question.id}
      prompt={question.prompt}
      isActive={question.isActive}
      isPositionOne={question.position === 1}
      initialAnswer={answer?.body ?? null}
      nextQuestion={nextQuestion}
    />
  )
}
