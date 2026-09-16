import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import OtherAnswersDisclosure from './other-answers-disclosure'
import type { MyQuestionAnswer } from '@/lib/questions'

function answer(overrides: Partial<MyQuestionAnswer> = {}): MyQuestionAnswer {
  return {
    id: 'a-1',
    questionId: 'q-1',
    prompt: 'A question.',
    body: 'A response.',
    updatedAt: '2026-09-07T12:00:00Z',
    isCurrent: false,
    isPrimary: false,
    moderationStatus: 'visible',
    ...overrides,
  }
}

// Onboarding & First-Use checkpoint — Section I: personalize the
// disclosure label when the owner's pseudonym is already available at
// the caller's own boundary (it always is — app/minds/[userId]/page.tsx
// already fetches the profile being viewed), otherwise fall back to a
// generic label; a member's own profile gets a second-person label
// instead of a third-person pseudonym.
describe('OtherAnswersDisclosure — response terminology + personalization', () => {
  it('renders nothing at all when there are no other responses', () => {
    const html = renderToStaticMarkup(<OtherAnswersDisclosure answers={[]} showReport />)
    expect(html).toBe('')
  })

  it('personalizes the collapsed label with the owner pseudonym when given', () => {
    const html = renderToStaticMarkup(
      <OtherAnswersDisclosure answers={[answer()]} showReport ownerPseudonym="Evening Quill" />
    )
    expect(html).toContain("Read Evening Quill&#x27;s other responses (1)")
  })

  it('uses a second-person label on the member\'s own profile, never their own pseudonym in third person', () => {
    const html = renderToStaticMarkup(
      <OtherAnswersDisclosure answers={[answer(), answer({ id: 'a-2' })]} showReport isSelf ownerPseudonym="Evening Quill" />
    )
    expect(html).toContain('Read your other responses (2)')
    expect(html).not.toContain('Evening Quill')
  })

  it('falls back to a generic label when no pseudonym is supplied (never a plumbing requirement for this copy alone)', () => {
    const html = renderToStaticMarkup(<OtherAnswersDisclosure answers={[answer()]} showReport />)
    expect(html).toContain('Read other responses (1)')
  })

  it('uses "responses," never "answers," in the collapsed label and the expanded section heading', () => {
    const html = renderToStaticMarkup(<OtherAnswersDisclosure answers={[answer()]} showReport />)
    expect(html.toLowerCase()).not.toContain('answers')
  })

  it('still renders through a real, accessible disclosure button (aria-expanded), collapsed by default', () => {
    const html = renderToStaticMarkup(<OtherAnswersDisclosure answers={[answer()]} showReport />)
    expect(html).toMatch(/<button[^>]*aria-expanded="false"/)
  })
})
