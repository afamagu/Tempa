import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import {
  getQuestionById,
  getCanonicalQuestions,
  getCanonicalAnswers,
  mergeCanonicalQuestionState,
  nextUnansweredCanonicalQuestion,
} from '@/lib/questions'
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

  const [{ data: answer }, canonicalQuestions, canonicalAnswers] = await Promise.all([
    supabase
      .from('question_answers')
      .select('body, updated_at, is_current')
      .eq('question_id', question.id)
      .eq('user_id', user.id)
      .maybeSingle(),
    getCanonicalQuestions(supabase),
    getCanonicalAnswers(supabase, user.id),
  ])

  // Computed from the OTHER canonical Questions' answer state at this
  // load, regardless of whether this one has been answered yet itself
  // — nextUnansweredCanonicalQuestion never needs to consult the
  // current Question's own answer to find what comes after it. Null
  // (never shown) for a non-canonical Question, or when nothing else
  // is left unanswered.
  const canonicalStates = mergeCanonicalQuestionState(canonicalQuestions, canonicalAnswers)
  const nextQuestion = nextUnansweredCanonicalQuestion(question.id, canonicalStates)

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
