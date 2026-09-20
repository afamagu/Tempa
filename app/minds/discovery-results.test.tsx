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
  markUrl: null,
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
  markUrl: 'https://example.test/profile-marks/mark.png',
  response: {
    id: 'answer-3',
    body: 'I notice the small things people do when nobody asks them to.',
    prompt: 'Tell a room of strangers something real about yourself.',
  },
}

describe('DiscoveryResults — discovery opens writing first', () => {
  it('does not make the People card identity a profile link', () => {
    const html = renderToStaticMarkup(<DiscoveryResults entries={[ENTRY_WITH_RESPONSE]} />)
    expect(html).not.toContain('href="/minds/user-1')
    expect(html).toContain("Read Evening Quill&#x27;s response")
  })

  it('previews the response and exposes a button that opens the reader', () => {
    const html = renderToStaticMarkup(<DiscoveryResults entries={[ENTRY_WITH_RESPONSE]} />)
    expect(html).toContain('A short answer about ordinary things.')
    expect(html).toContain("Open Evening Quill&#x27;s response")
    expect(html).not.toContain('role="dialog"')
  })

  it('shows a saved Mark and keeps the legacy Mindform fallback', () => {
    const marked = renderToStaticMarkup(<DiscoveryResults entries={[SECOND_RESPONSE]} />)
    expect(marked).toContain("Maya Bennett&#x27;s Mark")
    expect(marked).toContain('profile-marks/mark.png')
    const legacy = renderToStaticMarkup(<DiscoveryResults entries={[ENTRY_WITH_RESPONSE]} />)
    expect(legacy).not.toContain("Evening Quill&#x27;s Mark")
  })

  it('ships previous/next, keyboard, close, and conservative horizontal swipe navigation', async () => {
    const source = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('./discovery-results.tsx', import.meta.url), 'utf8'))
    expect(source).toContain('aria-label="Previous response"')
    expect(source).toContain('aria-label="Next response"')
    expect(source).toContain('aria-label="Close and return to People"')
    expect(source).toContain("e.key === 'ArrowLeft'")
    expect(source).toContain("e.key === 'ArrowRight'")
    expect(source).toContain('Math.abs(dx) < 60')
    expect(source).toContain('Math.abs(dx) <= Math.abs(dy) * 1.25')
  })

  it('keeps profile viewing as a secondary action inside the reader', async () => {
    const source = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('./discovery-results.tsx', import.meta.url), 'utf8'))
    expect(source).toContain('View {openEntry.pseudonym}&rsquo;s profile')
    expect(source).toContain('profileHref(openEntry.userId, returnTo)')
  })

  it('uses the person name in the correspondence action', async () => {
    const source = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('./discovery-results.tsx', import.meta.url), 'utf8'))
    expect(source).toContain('Write to {openEntry.pseudonym}')
  })

  it('can render multiple people in one ordered reading set', () => {
    expect(() => renderToStaticMarkup(<DiscoveryResults entries={[ENTRY_WITH_RESPONSE, SECOND_RESPONSE]} />)).not.toThrow()
  })

  it('renders no entries without throwing', () => {
    expect(() => renderToStaticMarkup(<DiscoveryResults entries={[]} />)).not.toThrow()
  })
})
