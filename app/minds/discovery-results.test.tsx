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

const SECOND_RESPONSE: DiscoveryEntry = {
  userId: 'user-3',
  pseudonym: 'Maya Bennett',
  country: 'United States',
  genderDisplay: 'Woman',
  ageRange: '25-34',
  response: {
    id: 'answer-3',
    body: 'I notice the small things people do when nobody asks them to.',
    prompt: 'Tell a room of strangers something real about yourself.',
  },
}

const ENTRY_NO_RESPONSE: DiscoveryEntry = {
  userId: 'user-2',
  pseudonym: 'Quiet Harbor',
  country: 'Kenya',
  genderDisplay: null,
  ageRange: '35-44',
  response: null,
}

describe('DiscoveryResults — entries with a discovery response', () => {
  it('links identity to the public profile and carries the exact People return URL', () => {
    const html = renderToStaticMarkup(
      <DiscoveryResults entries={[ENTRY_WITH_RESPONSE]} returnTo="/minds?country=South+Africa&batch=1" />
    )
    expect(html).toContain('href="/minds/user-1?returnTo=')
    expect(html).toContain('%2Fminds%3Fcountry%3DSouth%2BAfrica%26batch%3D1')
  })

  it('opens full writing in-page rather than navigating the response-preview button away', () => {
    const html = renderToStaticMarkup(<DiscoveryResults entries={[ENTRY_WITH_RESPONSE]} />)
    expect(html).not.toContain('role="dialog"')
    expect(html).toContain('<button')
  })

  it('previews the response body inside the recessed writing surface', () => {
    const html = renderToStaticMarkup(<DiscoveryResults entries={[ENTRY_WITH_RESPONSE]} />)
    expect(html).toContain('A short answer about ordinary things.')
  })

  it('ships quiet previous/next reading controls and a close control for the opened reader', async () => {
    const source = await import('node:fs').then(({ readFileSync }) =>
      readFileSync(new URL('./discovery-results.tsx', import.meta.url), 'utf8')
    )
    expect(source).toContain('aria-label="Previous response"')
    expect(source).toContain('aria-label="Next response"')
    expect(source).toContain('aria-label="Close and return to People"')
    expect(source).toContain("e.key === 'ArrowLeft'")
    expect(source).toContain("e.key === 'ArrowRight'")
  })

  it('uses a conservative horizontal gesture threshold so vertical reading does not accidentally change people', async () => {
    const source = await import('node:fs').then(({ readFileSync }) =>
      readFileSync(new URL('./discovery-results.tsx', import.meta.url), 'utf8')
    )
    expect(source).toContain('Math.abs(dx) < 60')
    expect(source).toContain('Math.abs(dx) <= Math.abs(dy) * 1.25')
    expect(source).toContain('if (dx < 0) showNext()')
    expect(source).toContain('else showPrevious()')
  })

  it('can render multiple response-bearing people in one ordered reading set', () => {
    expect(() =>
      renderToStaticMarkup(<DiscoveryResults entries={[ENTRY_WITH_RESPONSE, SECOND_RESPONSE]} />)
    ).not.toThrow()
  })
})

describe('DiscoveryResults — a person with no discovery response', () => {
  it('still renders a card for the person, identity-only, linking to their profile', () => {
    const html = renderToStaticMarkup(<DiscoveryResults entries={[ENTRY_NO_RESPONSE]} />)
    expect(html).toContain('href="/minds/user-2?returnTo=%2Fminds"')
    expect(html).toContain('Quiet Harbor')
  })

  it('never invents response writing for a person who has none', () => {
    const html = renderToStaticMarkup(<DiscoveryResults entries={[ENTRY_NO_RESPONSE]} />)
    expect(html).not.toContain('<button')
    expect(html).not.toContain('role="dialog"')
  })
})

describe('DiscoveryResults', () => {
  it('renders no entries without throwing', () => {
    expect(() => renderToStaticMarkup(<DiscoveryResults entries={[]} />)).not.toThrow()
  })
})
