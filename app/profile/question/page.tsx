import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getFlagshipQuestion, getEligibleQuestions, nextEligibleQuestion } from '@/lib/questions'
import QuestionAnswer from '@/app/question/question-answer'

/**
 * Pure: the one routing decision this page makes, extracted specifically
 * so it's directly, deterministically testable without mocking Supabase
 * auth/queries — same rationale as canWriteToMind (app/minds/[userId]/
 * page.tsx) and validateRequiredFields (app/profile/profile-form.tsx).
 * 'render' means render the required-Question UI itself; the two string
 * values are the exact redirect targets the page uses.
 */
export function resolveOnboardingQuestionDestination(state: {
  hasProfile: boolean
  onboardingStage: 'mark' | 'question' | 'complete' | null
  hasFlagshipQuestion: boolean
  hasFlagshipAnswer: boolean
}): 'render' | 'recover' | '/profile' | '/profile/mark' | '/minds' {
  if (!state.hasProfile) return '/profile'
  if (state.onboardingStage === 'mark') return '/profile/mark'
  if (state.onboardingStage === 'complete') return '/minds'
  if (!state.hasFlagshipQuestion || state.hasFlagshipAnswer) return 'recover'
  return 'render'
}

/**
 * Onboarding & First-Use checkpoint (Checkpoint 2, Section A/B) — the
 * required first Question, now the final onboarding step itself rather
 * than a later soft nudge. Reached ONLY from profile-form.tsx's own
 * final stage after a brand-new member has created a profile and Mark.
 * The shared central guard resumes incomplete members here, while this
 * route repeats the stage checks as defense in depth. Reuses the same
 * QuestionAnswer component and publish_question_answer RPC every other
 * Question save already uses (app/question/[questionId]/page.tsx) —
 * `onboarding` is the one new prop that changes its copy/post-save
 * behavior, never a second save implementation.
 *
 * The required Question is always the current FLAGSHIP Question
 * specifically (never an arbitrary slot) — this is what makes a member
 * appear in People discovery and become writable-to at all (see
 * lib/questions.ts's getFlagshipQuestion/getPrimaryAnswer doc
 * comments), matching the Checkpoint 1 audit finding this resolves.
 *
 * The private profiles.onboarding_stage is now the durable authority:
 * mark cannot bypass /profile/mark, question resumes here, and complete
 * members are not put back through onboarding. Existing profiles were
 * grandfathered complete by the prepared migration.
 *
 * A member who has ALREADY
 * published a response to the current Flagship Question (durable,
 * already-queryable state: a question_answers row for (user_id,
 * flagship.id), the exact same read this page already performs, no new
 * schema/flag needed) is redirected straight to /minds on a direct
 * revisit — this page is a one-time onboarding gate, never a permanent
 * "view/edit my Flagship response" destination (that already exists at
 * /question/[questionId] and /you/responses). Never renders the
 * onboarding education or completion UI a second time.
 */
export default async function OnboardingQuestionPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, onboarding_stage')
    .eq('id', user.id)
    .maybeSingle()

  // Each guard below mirrors resolveOnboardingQuestionDestination above
  // exactly (see that function's own tests) — expressed as direct
  // sequential checks here, rather than one combined call, purely
  // because each of these three facts is fetched one at a time (the
  // `answer` query genuinely depends on `flagship.id`, so it can't be
  // known upfront) — never fetching more than the minimum needed to
  // decide.
  if (!profile) {
    redirect('/profile')
  }

  if (profile.onboarding_stage === 'mark') {
    redirect('/profile/mark')
  }

  if (profile.onboarding_stage === 'complete') {
    redirect('/minds')
  }

  const flagship = await getFlagshipQuestion(supabase)

  // No Flagship Question currently configured: durably complete the
  // question stage before leaving, otherwise the central guard would
  // correctly send this member straight back here forever.
  if (!flagship) {
    const { error } = await supabase.rpc('complete_flagship_onboarding')
    if (error) {
      return <OnboardingRecoveryError />
    }
    redirect('/minds')
  }

  const [{ data: answer }, eligibleQuestions] = await Promise.all([
    supabase
      .from('question_answers')
      .select('body')
      .eq('question_id', flagship.id)
      .eq('user_id', user.id)
      .maybeSingle(),
    getEligibleQuestions(supabase, user.id),
  ])

  // Checkpoint 2B, Section B — already completed the required response
  // (durable question_answers state, no new flag): this page's own job
  // is done, redirect to the approved destination rather than showing
  // the view/edit UI at an onboarding-only URL.
  if (answer) {
    const { error } = await supabase.rpc('complete_flagship_onboarding')
    if (error) {
      return <OnboardingRecoveryError />
    }
    redirect('/minds')
  }

  // Same "next" resolution the ordinary /question/[questionId] route
  // already uses — the secondary "Answer another Question" CTA can link
  // straight to it once the required Flagship response is saved,
  // exactly like the existing (non-onboarding) Next button does.
  const nextQuestion = nextEligibleQuestion(eligibleQuestions, flagship.id)

  return (
    <QuestionAnswer
      userId={user.id}
      questionId={flagship.id}
      prompt={flagship.prompt}
      isActive
      isFlagship
      // Guaranteed null here — the `if (answer) redirect(...)` above
      // already exits for the one case where it wouldn't be.
      initialAnswer={null}
      nextQuestion={nextQuestion}
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
