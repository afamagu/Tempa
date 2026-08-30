import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getQuestionById } from '@/lib/questions'
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
    redirect('/question')
  }

  const { data: answer } = await supabase
    .from('question_answers')
    .select('body, updated_at')
    .eq('question_id', question.id)
    .eq('user_id', user.id)
    .maybeSingle()

  return (
    <QuestionAnswer
      userId={user.id}
      questionId={question.id}
      prompt={question.prompt}
      isActive={question.isActive}
      initialAnswer={answer?.body ?? null}
    />
  )
}
