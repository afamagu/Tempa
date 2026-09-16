import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
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
// never say "Send letter"/"Back to Minds". Onboarding & First-Use
// checkpoint (Section H) — "Save answer"/"Back to my answers" are now
// "Save response"/"Back to my responses" (routed to /you/responses, the
// new response-management home — see Section F), copy-only.
describe('QuestionAnswer — edit mode (no answer yet)', () => {
  it('renders Save response, never Publish, Send letter, Send, or Submit', () => {
    const html = renderToStaticMarkup(
      <QuestionAnswer userId="user-1" questionId="q-1" prompt="A prompt" initialAnswer={null} />
    )
    expect(html).toContain('Save response')
    expect(html).not.toContain('Send letter')
    expect(html).not.toContain('Publish answer')
    expect(html).not.toMatch(/>Send<\/button>/)
    expect(html).not.toContain('Submit')
  })

  it('renders "Back to my responses", never "Back to Minds"', () => {
    const html = renderToStaticMarkup(
      <QuestionAnswer userId="user-1" questionId="q-1" prompt="A prompt" initialAnswer={null} />
    )
    expect(html).toContain('Back to my responses')
    expect(html).toContain('href="/you/responses"')
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

  it('the "Back to my responses" exit is always present and enabled — a member can leave without saving', () => {
    const html = renderToStaticMarkup(
      <QuestionAnswer userId="user-1" questionId="q-1" prompt="A prompt" initialAnswer={null} />
    )
    expect(html).toMatch(/<a[^>]*href="\/you\/responses"[^>]*>Back to my responses<\/a>/)
  })

  it('shows no confirmation copy before any save has happened this visit', () => {
    const html = renderToStaticMarkup(
      <QuestionAnswer userId="user-1" questionId="q-1" prompt="A prompt" initialAnswer={null} />
    )
    expect(html).not.toContain('Response saved.')
    expect(html).not.toContain('This is now your primary response.')
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

// Final Question-invariant check: inactive Questions must never expose
// a loophole for starting a brand-new answer. The server/RPC boundary
// (publish_question_answer's `question_is_active` guard,
// docs/sql/2026-09-18-admin-operations-refinement.sql section 1b) is
// the real enforcement and is proven separately in lib/questions.test.ts's
// publish_question_answer simulation tests — these tests prove the
// direct-route UI never even offers the writable form in the first
// place ("do not rely on UI hiding" cuts both ways: the UI must also
// not dangle a control that can only ever fail).
describe('QuestionAnswer — inactive Question, no existing answer (direct-route invariant)', () => {
  it('shows a quiet "no longer open, you haven\'t answered it" state — never a writable textarea', () => {
    const html = renderToStaticMarkup(
      <QuestionAnswer userId="user-1" questionId="q-1" prompt="A prompt" initialAnswer={null} isActive={false} />
    )
    expect(html).toContain('This Question is no longer open')
    expect(html).toContain("you haven&#x27;t answered it")
    expect(html).not.toContain('<textarea')
    expect(html).not.toContain('Save response')
  })

  it('still offers a way back to My responses — never a dead end', () => {
    const html = renderToStaticMarkup(
      <QuestionAnswer userId="user-1" questionId="q-1" prompt="A prompt" initialAnswer={null} isActive={false} />
    )
    expect(html).toContain('href="/you/responses"')
  })
})

describe('QuestionAnswer — inactive Question, member already has an answer (historical access preserved)', () => {
  it('the historical answer is still readable — deactivation never erases a member\'s own record of it', () => {
    const html = renderToStaticMarkup(
      <QuestionAnswer
        userId="user-1"
        questionId="q-1"
        prompt="A prompt"
        initialAnswer="My historical answer."
        isActive={false}
      />
    )
    expect(html).toContain('My historical answer.')
    expect(html).toContain('This Question is no longer open')
  })
})

describe('QuestionAnswer — active Question, no existing answer (the one case that MUST allow writing)', () => {
  it('renders the writable textarea and Save response control', () => {
    const html = renderToStaticMarkup(
      <QuestionAnswer userId="user-1" questionId="q-1" prompt="A prompt" initialAnswer={null} isActive />
    )
    expect(html).toContain('<textarea')
    expect(html).toContain('Save response')
  })
})

describe('QuestionAnswer — view mode (already has a saved answer)', () => {
  it('renders "Edit response" and "Back to my responses", never any letter-composer text', () => {
    const html = renderToStaticMarkup(
      <QuestionAnswer userId="user-1" questionId="q-1" prompt="A prompt" initialAnswer="My existing answer." />
    )
    expect(html).toContain('Edit response')
    expect(html).toContain('Back to my responses')
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
        isFlagship
      />
    )
    expect(html).not.toContain('Response saved.')
    expect(html).not.toContain('now your primary response')
  })
})

// Onboarding & First-Use checkpoint (Checkpoint 2, Section A/B/C) — the
// `onboarding` prop, reached ONLY from app/profile/question/page.tsx's
// new required-first-Question step. The post-save completion branch
// itself requires a real save (setConfirmation is internal state,
// unreachable via props/SSR — same established limitation as every
// other click/effect-driven state in this codebase); it is instead
// proven via source-level inspection below, mirroring e.g.
// letterhead-postcard.test.tsx's own convention for exactly this
// situation.
describe('QuestionAnswer — onboarding mode: three-Question education (genuinely first save only)', () => {
  it('shows the three-Question education copy before a genuinely first save', () => {
    const html = renderToStaticMarkup(
      <QuestionAnswer userId="user-1" questionId="q-1" prompt="A prompt" initialAnswer={null} isFlagship onboarding />
    )
    expect(html).toContain('One last thing before you meet everyone')
    expect(html).toContain('Tempa gives you three Questions')
    expect(html).toContain('Your responses give people something real to discover')
    expect(html).toContain('Start with this one. The other two can wait.')
  })

  it('never shows the education copy when NOT in onboarding mode — this is onboarding-specific, not a general Question-writing explainer', () => {
    const html = renderToStaticMarkup(
      <QuestionAnswer userId="user-1" questionId="q-1" prompt="A prompt" initialAnswer={null} isFlagship />
    )
    expect(html).not.toContain('One last thing before you meet everyone')
  })

  it('never shows the education copy when re-editing an already-existing response, even via the onboarding route (edge case)', () => {
    const html = renderToStaticMarkup(
      <QuestionAnswer
        userId="user-1"
        questionId="q-1"
        prompt="A prompt"
        initialAnswer="Already answered."
        isFlagship
        onboarding
      />
    )
    // initialAnswer !== null starts the component in view mode, not
    // edit mode, so the education copy's own edit-mode branch never
    // renders in the first place.
    expect(html).not.toContain('One last thing before you meet everyone')
  })

  it('offers no "back" escape hatch during the required first-time onboarding save — explained as the final onboarding step, never a bypass', () => {
    const html = renderToStaticMarkup(
      <QuestionAnswer userId="user-1" questionId="q-1" prompt="A prompt" initialAnswer={null} isFlagship onboarding />
    )
    expect(html).not.toContain('Back to my responses')
    expect(html).toContain('Save response')
  })

  it('the ordinary (non-onboarding) edit mode still offers "Back to my responses" — nothing here removed that exit generally', () => {
    const html = renderToStaticMarkup(
      <QuestionAnswer userId="user-1" questionId="q-1" prompt="A prompt" initialAnswer={null} isFlagship />
    )
    expect(html).toContain('Back to my responses')
  })

  it('uses the italic, clay-accented quiet-editorial treatment ("Tempa is speaking"), the same visual language as TempaNote', () => {
    const html = renderToStaticMarkup(
      <QuestionAnswer userId="user-1" questionId="q-1" prompt="A prompt" initialAnswer={null} isFlagship onboarding />
    )
    expect(html).toMatch(/border-l-2 border-clay\/50/)
    expect(html).toMatch(/class="italic /)
  })

  it('never mentions audio — audio Moments are out of scope for this checkpoint', () => {
    const html = renderToStaticMarkup(
      <QuestionAnswer userId="user-1" questionId="q-1" prompt="A prompt" initialAnswer={null} isFlagship onboarding />
    )
    expect(html.toLowerCase()).not.toContain('audio')
  })
})

describe('QuestionAnswer — onboarding mode: post-first-save completion (source-level — setConfirmation is unreachable via SSR props)', () => {
  const source = readFileSync(new URL('./question-answer.tsx', import.meta.url), 'utf8')

  it('the completion branch is gated on onboarding AND a fresh confirmation, never shown on a later ordinary revisit', () => {
    expect(source).toContain("mode === 'view' && publishedBody && onboarding && confirmation ?")
  })

  it('shows the exact approved completion copy', () => {
    expect(source).toContain('That&rsquo;s your first response.')
    // Whitespace-tolerant (never an exact multi-line match) — the JSX
    // author is free to wrap this sentence differently without the
    // test being brittle to line-wrapping alone.
    const normalized = source.replace(/\s+/g, ' ')
    expect(normalized).toContain(
      "You can answer the other two whenever you feel like it. For now, there are people to meet."
    )
  })

  it('the primary CTA is "Meet some people", linking to /minds (People)', () => {
    expect(source).toContain('<Link href="/minds" className={primaryButtonClass}>')
    expect(source).toContain('Meet some people')
  })

  it('the secondary CTA "Answer another Question" uses the existing Question infrastructure — the same server-resolved nextQuestion prop the ordinary Next button already uses, never a second lookup', () => {
    const completionBranchStart = source.indexOf("mode === 'view' && publishedBody && onboarding && confirmation ?")
    const completionBranchEnd = source.indexOf(') : mode ===', completionBranchStart)
    const branch = source.slice(completionBranchStart, completionBranchEnd)
    expect(branch).toContain('{nextQuestion ? (')
    expect(branch).toContain('Answer another Question')
    expect(branch).toContain('/you/responses?tab=new')
  })
})
