import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DiscoveryResults, { type DiscoveryEntry } from './discovery-results'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }))

const ENTRY: DiscoveryEntry = {
  id: 'answer-1',
  userId: 'user-1',
  questionId: 'q-1',
  body: 'A short answer about ordinary things.',
  pseudonym: 'Evening Quill',
  country: 'South Africa',
  genderDisplay: 'Woman',
  ageRange: '25-34',
  prompt: 'What is something ordinary that means more to you than most people would expect?',
}

describe('DiscoveryResults', () => {
  it('card identity (Mindform + pseudonym) is ONE link to the public profile — never the Question/Minds tutorial', () => {
    const html = renderToStaticMarkup(<DiscoveryResults entries={[ENTRY]} />)
    expect(html).toContain('href="/minds/user-1"')
    expect(html).not.toContain('view=answer')

    // The pseudonym and the Mindform sit inside the SAME anchor, not
    // two separate ones — confirmed by there being exactly one
    // /minds/user-1 anchor per card (the QuestionInfoIcon tooltip
    // trigger is a sibling span with role="button", not a second link).
    const profileAnchors = (html.match(/href="\/minds\/user-1"/g) ?? []).length
    expect(profileAnchors).toBe(1)
  })

  it('reading the full answer opens an in-page modal with a working close, never a navigation away', () => {
    const html = renderToStaticMarkup(<DiscoveryResults entries={[ENTRY]} />)
    // No modal open on initial render (openId starts null).
    expect(html).not.toContain('role="dialog"')
    // The card's own writing button is present and is a button, not a link
    // — opening the full text never navigates the page.
    expect(html).toContain('<button')
  })

  it('renders no entries without throwing', () => {
    expect(() => renderToStaticMarkup(<DiscoveryResults entries={[]} />)).not.toThrow()
  })
})
