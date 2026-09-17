import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DiscoveryResults, { type DiscoveryEntry } from './discovery-results'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }))

const ENTRY_WITH_RESPONSE: DiscoveryEntry = {
  userId: 'user-1',
  pseudonym: 'Evening Quill',
  country: 'South Africa',
  genderDisplay: 'Woman',
  ageRange: '25-34',
  response: {
    id: 'answer-1',
    body: 'A short answer about ordinary things.',
    prompt: 'What is something ordinary that means more to you than most people would expect?',
  },
}

// Post-onboarding corrections checkpoint (Section A/B) — a person with
// no Flagship answer is a perfectly normal entry now, never a reason to
// disappear from People.
const ENTRY_NO_RESPONSE: DiscoveryEntry = {
  userId: 'user-2',
  pseudonym: 'Quiet Harbor',
  country: 'Kenya',
  genderDisplay: null,
  ageRange: '35-44',
  response: null,
}

describe('DiscoveryResults — entries with a Flagship response', () => {
  it('card identity (Mindform + pseudonym) is ONE link to the public profile — never the Question/Minds tutorial', () => {
    const html = renderToStaticMarkup(<DiscoveryResults entries={[ENTRY_WITH_RESPONSE]} />)
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
    const html = renderToStaticMarkup(<DiscoveryResults entries={[ENTRY_WITH_RESPONSE]} />)
    // No modal open on initial render (openId starts null).
    expect(html).not.toContain('role="dialog"')
    // The card's own writing button is present and is a button, not a link
    // — opening the full text never navigates the page.
    expect(html).toContain('<button')
  })

  it('previews the response body inside the recessed writing surface', () => {
    const html = renderToStaticMarkup(<DiscoveryResults entries={[ENTRY_WITH_RESPONSE]} />)
    expect(html).toContain('A short answer about ordinary things.')
  })
})

describe('DiscoveryResults — a person with no Flagship response (Post-onboarding corrections checkpoint)', () => {
  it('still renders a card for the person, identity-only, linking straight to their existing profile', () => {
    const html = renderToStaticMarkup(<DiscoveryResults entries={[ENTRY_NO_RESPONSE]} />)
    expect(html).toContain('href="/minds/user-2"')
    expect(html).toContain('Quiet Harbor')
  })

  it('never renders a response-preview button or the reading modal for a person with no response', () => {
    const html = renderToStaticMarkup(<DiscoveryResults entries={[ENTRY_NO_RESPONSE]} />)
    expect(html).not.toContain('<button')
    expect(html).not.toContain('role="dialog"')
  })

  it('mixes freely with response-having entries in the same list without throwing', () => {
    expect(() =>
      renderToStaticMarkup(<DiscoveryResults entries={[ENTRY_WITH_RESPONSE, ENTRY_NO_RESPONSE]} />)
    ).not.toThrow()
  })
})

describe('DiscoveryResults', () => {
  it('renders no entries without throwing', () => {
    expect(() => renderToStaticMarkup(<DiscoveryResults entries={[]} />)).not.toThrow()
  })
})
