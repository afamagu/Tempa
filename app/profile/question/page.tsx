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
  hasFlagshipQuestion: boolean
  hasFlagshipAnswer: boolean
}): 'render' | '/profile' | '/minds' {
  if (!state.hasProfile) return '/profile'
  if (!state.hasFlagshipQuestion) return '/minds'
  if (state.hasFlagshipAnswer) return '/minds'
  return 'render'
}

/**
 * Onboarding & First-Use checkpoint (Checkpoint 2, Section A/B) — the
 * required first Question, now the final onboarding step itself rather
 * than a later soft nudge. Reached ONLY from profile-form.tsx's own
 * post-insert redirect, immediately after a brand-new member's first
 * profiles row is created — never linked to from anywhere else, and
 * never enforced as a gate anywhere else in the app (see this file's
 * own existing-member-safety note below). Reuses the exact same
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
 * Existing-member safety (Section R): this page performs NO new GLOBAL
 * completion check and gates nothing beyond itself — it never becomes a
 * site-wide mandatory redirect. A member only ever reaches it via the
 * profile-form.tsx redirect immediately after inserting their first
 * profiles row — an existing member (who already has a profiles row) is
 * already redirected away from /profile entirely (app/profile/page.tsx)
 * and can never land here again. Its own guard here is deliberately the
 * OPPOSITE of /profile's: it requires a profiles row to exist (a
 * prerequisite — "the profile step already happened") rather than
 * redirecting because one exists, which is exactly why a just-created
 * member can still reach and use this page despite their profiles row
 * already being present. If a brand-new member navigates away before
 * answering, nothing elsewhere in the app chases them back here — they
 * simply continue to see the existing, unchanged, non-blocking
 * QuestionIncompleteNotice/needsParticipationGate nudge everywhere it
 * already appears, exactly as any other member without a Flagship
 * response does today. This is deliberate: the previous forced-redirect
 * gate was removed specifically because it could intercept a member
 * elsewhere in the app, and this checkpoint must not recreate that.
 *
 * Checkpoint 2B, Section B correction — a member who has ALREADY
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

  const { data: profile } = await supabase.from('profiles').select('id').eq('id', user.id).maybeSingle()

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

  const flagship = await getFlagshipQuestion(supabase)

  // No Flagship Question currently configured (an admin-curation gap,
  // not something a member should ever be blocked by) — nothing
  // required to ask, so onboarding is simply complete.
  if (!flagship) {
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
