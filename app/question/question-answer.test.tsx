import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import QuestionAnswer from './question-answer'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))

// Question-answer vs letter-composer separation checkpoint (2026-09-05)
// — a live-test report described this screen as showing "Send letter"/
// "Back to Minds". Tracing the actual code found those strings exist
// ONLY in the two letter composers (app/write/[recipientId]/first-
// letter-composer.tsx, app/letters/[letterId]/moments-composer.tsx) —
// this component has never called send_first_letter or any letter RPC.
// These tests lock that boundary in place regardless: this screen must
// never say "Send letter"/"Back to Minds", and must always say "Save
// answer"/"Back to my answers".
describe('QuestionAnswer — edit mode (no answer yet)', () => {
  it('renders Save answer, never Publish answer, Send letter, Send, or Submit', () => {
    const html = renderToStaticMarkup(
      <QuestionAnswer userId="user-1" questionId="q-1" prompt="A prompt" initialAnswer={null} />
    )
    expect(html).toContain('Save answer')
    expect(html).not.toContain('Send letter')
    expect(html).not.toContain('Publish answer')
    expect(html).not.toMatch(/>Send<\/button>/)
    expect(html).not.toContain('Submit')
  })

  it('renders "Back to my answers", never "Back to Minds"', () => {
    const html = renderToStaticMarkup(
      <QuestionAnswer userId="user-1" questionId="q-1" prompt="A prompt" initialAnswer={null} />
    )
    expect(html).toContain('Back to my answers')
    expect(html).toContain('href="/minds?view=answers"')
    expect(html).not.toContain('Back to Minds')
  })

  it('never mentions a recipient, correspondence, or letter — this is a Question, not a letter', () => {
    const html = renderToStaticMarkup(
      <QuestionAnswer userId="user-1" questionId="q-1" prompt="A prompt" initialAnswer={null} />
    )
    expect(html.toLowerCase()).not.toContain('recipient')
    expect(html.toLowerCase()).not.toContain('correspondence')
    expect(html.toLowerCase()).not.toContain('writing to')
  })

  it('the "Back to my answers" exit is always present and enabled — a member can leave without saving', () => {
    const html = renderToStaticMarkup(
      <QuestionAnswer userId="user-1" questionId="q-1" prompt="A prompt" initialAnswer={null} />
    )
    expect(html).toMatch(/<a[^>]*href="\/minds\?view=answers"[^>]*>Back to my answers<\/a>/)
  })

  it('shows no confirmation copy before any save has happened this visit', () => {
    const html = renderToStaticMarkup(
      <QuestionAnswer userId="user-1" questionId="q-1" prompt="A prompt" initialAnswer={null} />
    )
    expect(html).not.toContain('Answer saved.')
    expect(html).not.toContain('now featured in Minds')
  })

  it('keeps the Emoji picker but never a Bold/Italic toolbar — Questions are intentionally plain text', () => {
    const html = renderToStaticMarkup(
      <QuestionAnswer userId="user-1" questionId="q-1" prompt="A prompt" initialAnswer={null} />
    )
    expect(html).toContain('aria-label="Insert emoji"')
    expect(html).not.toContain('aria-label="Bold"')
    expect(html).not.toContain('aria-label="Italic"')
  })
})

describe('QuestionAnswer — view mode (already has a saved answer)', () => {
  it('renders "Edit answer" and "Back to my answers", never any letter-composer text', () => {
    const html = renderToStaticMarkup(
      <QuestionAnswer userId="user-1" questionId="q-1" prompt="A prompt" initialAnswer="My existing answer." />
    )
    expect(html).toContain('Edit answer')
    expect(html).toContain('Back to my answers')
    expect(html).not.toContain('Send letter')
    expect(html).not.toContain('Back to Minds')
  })

  // Board usability visual follow-up (2026-09-09): a published answer's
  // own text sits on the same bg-surface-shell authored-paper surface
  // used everywhere else a member's writing is shown — this full-page
  // reader was the one genuine gap found during that sweep.
  it('wraps the published answer in the shared bg-surface-shell authored-paper surface', () => {
    const html = renderToStaticMarkup(
      <QuestionAnswer userId="user-1" questionId="q-1" prompt="A prompt" initialAnswer="My existing answer." />
    )
    expect(html).toMatch(/class="[^"]*bg-surface-shell[^"]*"[^>]*>[\s\S]*My existing answer\./)
  })

  it('shows no stale confirmation copy on an ordinary page load', () => {
    const html = renderToStaticMarkup(
      <QuestionAnswer
        userId="user-1"
        questionId="q-1"
        prompt="A prompt"
        initialAnswer="My existing answer."
        initialIsCurrent
      />
    )
    expect(html).not.toContain('Answer saved.')
    expect(html).not.toContain('now featured in Minds')
  })
})
