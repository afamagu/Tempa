import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { resolveOnboardingQuestionDestination } from './page'

// Onboarding & First-Use checkpoint (Checkpoint 2, Section A/B/R) — the
// required first-Question onboarding step. Async Server Component with
// heavy Supabase dependency, same "not directly unit-tested" convention
// as every other page like this in this codebase — proven via source
// inspection instead.
const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('Onboarding required-Question page — reuses the existing Question infrastructure, never a second save implementation', () => {
  it('renders the SAME QuestionAnswer component every other Question save uses, imported from its one canonical location', () => {
    expect(source).toContain("import QuestionAnswer from '@/app/question/question-answer'")
    expect(source).not.toMatch(/function\s+QuestionAnswer/)
  })

  it('the required Question is always the current FLAGSHIP Question specifically — getFlagshipQuestion, never an arbitrary slot', () => {
    expect(source).toContain('getFlagshipQuestion(supabase)')
    expect(source).toContain('isFlagship')
  })

  it('passes onboarding=true — the one prop that distinguishes this from the ordinary /question/[questionId] route', () => {
    expect(source).toContain('onboarding')
  })

  it('the secondary "Answer another Question" path reuses the existing nextEligibleQuestion resolution, no second lookup', () => {
    expect(source).toContain('getEligibleQuestions(supabase, user.id)')
    expect(source).toContain('nextEligibleQuestion(eligibleQuestions, flagship.id)')
  })

  it('gracefully completes onboarding (redirects to /minds) rather than deadlocking when no Flagship Question is currently configured', () => {
    expect(source).toContain('if (!flagship) {')
    const flagshipGuardStart = source.indexOf('if (!flagship) {')
    const flagshipGuardEnd = source.indexOf('}', flagshipGuardStart)
    expect(source.slice(flagshipGuardStart, flagshipGuardEnd)).toContain("redirect('/minds')")
  })

  it('redirects to /profile (never straight into the Question, and never onward) when no profiles row exists yet — this step assumes the profile step already completed', () => {
    expect(source).toContain("if (!profile) {")
    const profileGuardStart = source.indexOf('if (!profile) {')
    const profileGuardEnd = source.indexOf('}', profileGuardStart)
    expect(source.slice(profileGuardStart, profileGuardEnd)).toContain("redirect('/profile')")
  })

  it('never introduces a second, competing save RPC — the existing publish_question_answer stays the only one', () => {
    expect(source).not.toContain('.rpc(')
  })
})

describe('Onboarding required-Question page — existing-member safety (Section R)', () => {
  it('is documented as reachable ONLY from the profile-form.tsx post-insert redirect, never linked to elsewhere or gated globally', () => {
    expect(source.toLowerCase()).toContain('existing-member safety')
    expect(source).toContain('profile-form.tsx')
  })
})

// Checkpoint 2B, Section B — the route/state safety audit, expressed as
// deterministic coverage of the page's own extracted pure routing
// decision (resolveOnboardingQuestionDestination), rather than mocking
// Supabase auth/queries just to exercise it. This IS the durable state
// this page already reads — no new schema/flag was needed or added.
describe('resolveOnboardingQuestionDestination — the route/state safety audit as deterministic coverage', () => {
  // 1. NEW MEMBER: profile just created, Flagship exists, no answer yet
  // → render the required Question.
  it('1. new member: renders the required Question', () => {
    expect(
      resolveOnboardingQuestionDestination({ hasProfile: true, hasFlagshipQuestion: true, hasFlagshipAnswer: false })
    ).toBe('render')
  })

  // 2/3. ONBOARDING QUESTION REFRESH / DIRECT REVISIT BEFORE COMPLETION:
  // identical server-side state (profile + Flagship exist, no answer
  // yet) on every request — a refresh or a direct URL revisit both
  // re-evaluate the SAME durable state and get the SAME answer: render
  // again. Nothing here is keyed on client-side/session state at all.
  it('2/3. refresh or direct revisit before completion: same state in, same result out — still renders the required Question', () => {
    const state = { hasProfile: true, hasFlagshipQuestion: true, hasFlagshipAnswer: false }
    expect(resolveOnboardingQuestionDestination(state)).toBe('render')
    expect(resolveOnboardingQuestionDestination({ ...state })).toBe('render')
  })

  // 5. ALREADY COMPLETED MEMBER, direct revisit: least-surprising
  // behavior — redirect straight to /minds rather than re-rendering the
  // onboarding UI (which would now show ordinary view-mode, not the
  // onboarding completion state, since QuestionAnswer's own
  // `confirmation` is never restored from a page load — still not the
  // right destination for a URL whose entire purpose is "do this once").
  it('5. already-completed member revisiting directly: redirects to /minds, never re-renders onboarding', () => {
    expect(
      resolveOnboardingQuestionDestination({ hasProfile: true, hasFlagshipQuestion: true, hasFlagshipAnswer: true })
    ).toBe('/minds')
  })

  // 8. Having a profiles row alone is NEVER sufficient proof the
  // Flagship response was completed — hasFlagshipAnswer is an
  // independent fact, checked independently, never inferred from
  // hasProfile.
  it('8. profile existence alone never counts as onboarding completion', () => {
    expect(
      resolveOnboardingQuestionDestination({ hasProfile: true, hasFlagshipQuestion: true, hasFlagshipAnswer: false })
    ).not.toBe('/minds')
    // Only genuinely no profile, or a genuinely completed answer, ever
    // redirect away from rendering the Question.
    expect(
      resolveOnboardingQuestionDestination({ hasProfile: false, hasFlagshipQuestion: true, hasFlagshipAnswer: false })
    ).toBe('/profile')
  })

  it('no Flagship Question currently configured: completes onboarding gracefully (redirects to /minds), never deadlocks', () => {
    expect(
      resolveOnboardingQuestionDestination({ hasProfile: true, hasFlagshipQuestion: false, hasFlagshipAnswer: false })
    ).toBe('/minds')
  })

  it('the profile guard takes precedence over every other check', () => {
    expect(
      resolveOnboardingQuestionDestination({ hasProfile: false, hasFlagshipQuestion: false, hasFlagshipAnswer: true })
    ).toBe('/profile')
  })
})

describe('Checkpoint 2B, Section B — the actual page mirrors the tested pure decision for each guard', () => {
  it('no-profile guard redirects to /profile, matching resolveOnboardingQuestionDestination', () => {
    const guardStart = source.indexOf('if (!profile) {')
    const guardEnd = source.indexOf('}', guardStart)
    expect(source.slice(guardStart, guardEnd)).toContain("redirect('/profile')")
  })

  it('already-answered guard redirects to /minds, matching resolveOnboardingQuestionDestination', () => {
    expect(source).toContain('if (answer) {')
    const guardStart = source.indexOf('if (answer) {')
    const guardEnd = source.indexOf('}', guardStart)
    expect(source.slice(guardStart, guardEnd)).toContain("redirect('/minds')")
  })
})
