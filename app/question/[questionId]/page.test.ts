import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Onboarding & First-Use checkpoint — server page, same established
// "not directly unit-tested" convention as every other heavy-Supabase
// async Server Component in this codebase (see e.g.
// app/board/[dispatchId]/page.test.ts's own header comment).
const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('Question write page — response-management redirect target', () => {
  it('redirects to /you/responses (never the retired /minds?view=answer) when the requested Question no longer exists', () => {
    expect(source).toContain("redirect('/you/responses?tab=new')")
    expect(source).not.toContain('/minds?view=answer')
  })
})

// Checkpoint 2B, Section B, item 7 — the ordinary /question/[questionId]
// route must remain completely independent of the new onboarding step:
// no onboarding prop, no onboarding-only education/completion behavior,
// no dependency on the new pure routing decision.
describe('Question write page — remains the ordinary (non-onboarding) route, unchanged by the onboarding checkpoint', () => {
  it('never passes onboarding to QuestionAnswer', () => {
    expect(source).not.toContain('onboarding')
  })

  it('never imports the onboarding-only routing decision', () => {
    expect(source).not.toContain('resolveOnboardingQuestionDestination')
    expect(source).not.toContain('/profile/question')
  })
})
