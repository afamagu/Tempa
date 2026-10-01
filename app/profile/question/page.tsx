import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getFlagshipQuestion } from '@/lib/questions'
import QuestionAnswer from '@/app/question/question-answer'

/**
 * The First Question is Tempa's one required communal entrance question.
 * Historical Question slots/answers remain intact, but onboarding no longer
 * advertises or chains into two additional Questions.
 */
export function resolveOnboardingQuestionDestination(state: {
  hasProfile: boolean
  onboardingStage: 'mark' | 'question' | 'complete' | null
  hasFlagshipQuestion: boolean
  hasFlagshipAnswer: boolean
}): 'render' | 'recover' | '/profile' | '/profile/mark' | '/room' {
  if (!state.hasProfile) return '/profile'
  if (state.onboardingStage === 'mark') return '/profile/mark'
  if (state.onboardingStage === 'complete') return '/room'
  if (!state.hasFlagshipQuestion || state.hasFlagshipAnswer) return 'recover'
  return 'render'
}

export default async function OnboardingQuestionPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/sign-in')

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, onboarding_stage')
    .eq('id', user.id)
    .maybeSingle()

  if (!profile) redirect('/profile')
  if (profile.onboarding_stage === 'mark') redirect('/profile/mark')
  if (profile.onboarding_stage === 'complete') redirect('/room')

  const flagship = await getFlagshipQuestion(supabase)

  // Fail open for onboarding if staff have not configured The First Question;
  // otherwise the central guard would loop this member here indefinitely.
  if (!flagship) {
    const { error } = await supabase.rpc('complete_flagship_onboarding')
    if (error) return <OnboardingRecoveryError />
    redirect('/room')
  }

  const { data: answer } = await supabase
    .from('question_answers')
    .select('body')
    .eq('question_id', flagship.id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (answer) {
    const { error } = await supabase.rpc('complete_flagship_onboarding')
    if (error) return <OnboardingRecoveryError />
    redirect('/room')
  }

  return (
    <QuestionAnswer
      userId={user.id}
      questionId={flagship.id}
      prompt={flagship.prompt}
      isActive
      isFlagship
      initialAnswer={null}
      nextQuestion={null}
      onboarding
    />
  )
}

function OnboardingRecoveryError() {
  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      <div className="w-full max-w-md space-y-4 text-center">
        <h1 className="font-serif text-2xl font-medium">One moment</h1>
        <p className="text-sm text-muted">We couldn&rsquo;t finish this step. Refresh the page to try again.</p>
      </div>
    </main>
  )
}
