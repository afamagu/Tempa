import RoomQuestionCredit from '@/app/member-questions/room-question-credit'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getQuestionById } from '@/lib/questions'
import QuestionAnswer from '../question-answer'
import { getMyWritingStyle } from '@/lib/writing-style-data'

export default async function QuestionWritePage({
  params,
  searchParams,
}: {
  params: Promise<{ questionId: string }>
  searchParams?: Promise<{ source?: string }>
}) {
  const { questionId } = await params
  const source = (await searchParams)?.source
  const returnTo = source === 'home_room' ? '/home' : source === 'room' ? '/room' : undefined
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  const question = await getQuestionById(supabase, questionId)

  if (!question) {
    redirect('/room')
  }

  const [{ data: answer }, writingStyleId] = await Promise.all([
    supabase
      .from('question_answers')
      .select('body, updated_at, is_current, moderation_status')
      .eq('question_id', question.id)
      .eq('user_id', user.id)
      .maybeSingle(),
    getMyWritingStyle(supabase, user.id),
  ])

  return (
    <>
    <div className="mx-auto max-w-2xl px-6 pt-4"><RoomQuestionCredit questionId={question.id} /></div>
    <QuestionAnswer
      key={question.id}
      returnTo={returnTo}
      userId={user.id}
      questionId={question.id}
      prompt={question.prompt}
      isActive={question.isActive}
      isFlagship={question.isFlagship}
      initialAnswer={answer?.body ?? null}
      editable={question.isActive && answer?.moderation_status !== 'hidden'}
      nextQuestion={null}
      writingStyleId={writingStyleId}
    />
    </>
  )
}
