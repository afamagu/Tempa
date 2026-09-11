import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ProfileAnswer, { isLongAnswer } from './profile-answer'

const PROMPT = 'What is something ordinary that means more to you than most people would expect?'
const SHORT_BODY = 'A short answer.'
const LONG_BODY =
  'A much longer answer that goes on for quite a while, describing in careful detail the kind of ' +
  'ordinary object that carries far more weight than its size would suggest, wandering through several ' +
  'connected memories before finally arriving at why it still matters today, well past the length a ' +
  'four-line preview could ever hope to contain in full.'

describe('isLongAnswer (pure)', () => {
  it('a short answer is not long', () => {
    expect(isLongAnswer(SHORT_BODY)).toBe(false)
  })

  it('a long answer is long', () => {
    expect(isLongAnswer(LONG_BODY)).toBe(true)
  })
})

describe('ProfileAnswer', () => {
  it('the Question is not permanently/visibly displayed — no popover content rendered until activated', () => {
    const html = renderToStaticMarkup(<ProfileAnswer id="a-1" prompt={PROMPT} body={SHORT_BODY} showReport={false} />)
    // Tooltip only renders its visible role="tooltip" content once its
    // internal `visible` state is true — untouched (collapsed) on
    // initial render, so the prompt is not shown as a heading/paragraph
    // the way it used to be printed above every answer.
    expect(html).not.toContain('role="tooltip"')
  })

  it('the info control still carries an accessible label naming the Question — present for assistive tech even while visually collapsed', () => {
    const html = renderToStaticMarkup(<ProfileAnswer id="a-1" prompt={PROMPT} body={SHORT_BODY} showReport={false} />)
    expect(html).toContain(`aria-label="The Question: ${PROMPT}"`)
  })

  it('a short answer shows in full with no Read more control', () => {
    const html = renderToStaticMarkup(<ProfileAnswer id="a-1" prompt={PROMPT} body={SHORT_BODY} showReport={false} />)
    expect(html).toContain(SHORT_BODY)
    expect(html).not.toContain('Read more')
  })

  it('a long answer is clamped and offers Read more, but the full text is still present in the DOM (CSS-clamped, never sliced)', () => {
    const html = renderToStaticMarkup(<ProfileAnswer id="a-1" prompt={PROMPT} body={LONG_BODY} showReport={false} />)
    expect(html).toContain('line-clamp-4')
    expect(html).toContain(LONG_BODY)
    expect(html).toContain('Read more')
    expect(html).toContain('aria-expanded="false"')
  })

  it('shows "Primary Minds answer" only when isPrimary is true', () => {
    const primary = renderToStaticMarkup(
      <ProfileAnswer id="a-1" prompt={PROMPT} body={SHORT_BODY} isPrimary showReport={false} />
    )
    expect(primary).toContain('Primary Minds answer')

    const notPrimary = renderToStaticMarkup(
      <ProfileAnswer id="a-1" prompt={PROMPT} body={SHORT_BODY} showReport={false} />
    )
    expect(notPrimary).not.toContain('Primary Minds answer')
  })
})

// Admin Command Center Phase 2A-1 — question_answer became a reportable
// target; ProfileAnswer is the one place a member reads someone ELSE's
// canonical answer with full context, so it gained the Report action —
// but only ever for someone else's writing, never your own.
describe('ProfileAnswer — Report action (Admin Phase 2A-1)', () => {
  it('renders a Report control when showReport is true (viewing someone else\'s answer)', () => {
    const html = renderToStaticMarkup(
      <ProfileAnswer id="a-1" prompt={PROMPT} body={SHORT_BODY} showReport />
    )
    expect(html).toContain('Report this answer')
  })

  it('renders no Report control when showReport is false (viewing your own answer)', () => {
    const html = renderToStaticMarkup(
      <ProfileAnswer id="a-1" prompt={PROMPT} body={SHORT_BODY} showReport={false} />
    )
    expect(html).not.toContain('Report this answer')
  })
})
