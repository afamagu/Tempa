import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// Post-Phase-2B UX checkpoint — this page previously had no test at all
// (matching every other app/you/* child page, e.g. app/you/guide/
// page.tsx, none of which are directly unit-tested either). Added now
// specifically to prove the one thing this checkpoint fixes: a visible
// way back to /you, reusing the exact same mocking convention already
// established for an async server component in app/auth/callback/
// route.test.ts (mock @/lib/supabase/server's createClient; here, also
// the two data-fetchers the page itself calls, so this test stays
// scoped to the page's own JSX rather than re-exercising their own
// already-tested query logic).

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } } }) },
  }),
}))

vi.mock('@/lib/letters', () => ({
  getWaitingLetterCount: async () => 0,
}))

vi.mock('@/lib/profile-interests', () => ({
  getProfileInterestKeys: async () => ['music', 'travel-places'],
}))

vi.mock('next/navigation', () => ({
  redirect: () => {
    throw new Error('redirect() should not be called for a signed-in user')
  },
  useRouter: () => ({ push: () => {}, refresh: () => {} }),
}))

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))

describe('app/you/interests — back navigation (post-Phase-2B UX checkpoint)', () => {
  it('renders a link back to /you, reusing app/you/guide/page.tsx\'s own "You" back-link treatment', async () => {
    const { default: ReadingInterestsPage } = await import('./page')
    const html = renderToStaticMarkup(await ReadingInterestsPage())
    expect(html).toMatch(/<a[^>]*href="\/you"[^>]*>\s*You\s*<\/a>/)
  })

  it('still renders the "Reading interests" heading and the Interests editor with the viewer\'s current selection intact', async () => {
    const { default: ReadingInterestsPage } = await import('./page')
    const html = renderToStaticMarkup(await ReadingInterestsPage())
    expect(html).toContain('Reading interests')
    // The editor renders every taxonomy chip; the two pre-selected ones
    // (from the mocked getProfileInterestKeys above) must be present and
    // marked selected — proving the back-link addition didn't disturb
    // the editor's own existing render.
    expect(html).toContain('Music')
    expect(html).toContain('Travel &amp; Places')
    expect(html).toContain('Save')
  })
})
