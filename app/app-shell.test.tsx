import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import AppShell from './app-shell'

const NAV_KEYS = ['home', 'letters', 'minds', 'board', 'you'] as const
const NAV_HREFS: Record<(typeof NAV_KEYS)[number], string> = {
  home: '/home',
  letters: '/letters',
  minds: '/minds',
  board: '/board',
  you: '/you',
}

// Home Phase 1B — the mobile bottom nav's active-location treatment.
// Only the mobile bar (`sm:hidden`) is targeted by this pass; the
// desktop sidebar already had its own `bg-accent/10 font-medium`
// active styling from before and is deliberately left untouched here.
// Isolates the mobile `<nav>` block specifically (rather than matching
// against the whole document) since the SAME NavIcon/label pair — and
// the SAME href — also appears once in the desktop sidebar, which would
// otherwise produce two matches per nav item and make "exactly one
// active" assertions ambiguous.
function mobileNavHtml(html: string): string {
  const start = html.indexOf('<nav class="fixed inset-x-0 bottom-0')
  expect(start).toBeGreaterThan(-1)
  return html.slice(start)
}

describe('AppShell — mobile bottom nav active-location treatment', () => {
  it.each(NAV_KEYS)('marks exactly the %s nav item active when that key is the active prop', (activeKey) => {
    const html = renderToStaticMarkup(
      <AppShell active={activeKey} waitingLetterCount={0}>
        <div>content</div>
      </AppShell>
    )
    const mobileNav = mobileNavHtml(html)

    for (const key of NAV_KEYS) {
      const hrefIndex = mobileNav.indexOf(`href="${NAV_HREFS[key]}"`)
      expect(hrefIndex).toBeGreaterThan(-1)
      // React's SSR serializer does NOT preserve JSX attribute
      // declaration order (it renders aria-current before class before
      // href here) — so the full tag must be captured from its own
      // opening `<a`, never merely from the href attribute onward.
      const tagStart = mobileNav.lastIndexOf('<a ', hrefIndex)
      const anchorEnd = mobileNav.indexOf('</a>', hrefIndex)
      const anchor = mobileNav.slice(tagStart, anchorEnd)

      if (key === activeKey) {
        expect(anchor).toContain('aria-current="page"')
        // The soft olive lozenge (accent, never verdigris).
        expect(anchor).toContain('bg-accent/10')
        expect(anchor).not.toContain('verdigris')
        // The icon itself reads stronger olive.
        expect(anchor).toContain('text-accent')
        // The label gets modest emphasis — weight, not a new color.
        expect(anchor).toContain('font-medium')
      } else {
        expect(anchor).not.toContain('aria-current')
        expect(anchor).not.toContain('bg-accent/10')
        expect(anchor).not.toContain('font-medium')
      }
    }
  })

  it('uses a short 150ms transition, never a bounce/pulse/scale animation', () => {
    const html = renderToStaticMarkup(
      <AppShell active="home" waitingLetterCount={0}>
        <div>content</div>
      </AppShell>
    )
    const mobileNav = mobileNavHtml(html)
    expect(mobileNav).toContain('duration-150')
    expect(mobileNav).not.toMatch(/animate-|scale-|bounce|pulse/)
  })

  it('preserves the existing navigation hrefs unchanged', () => {
    const html = renderToStaticMarkup(
      <AppShell active="board" waitingLetterCount={0}>
        <div>content</div>
      </AppShell>
    )
    const mobileNav = mobileNavHtml(html)
    for (const key of NAV_KEYS) {
      expect(mobileNav).toContain(`href="${NAV_HREFS[key]}"`)
    }
  })

  it('still renders the unread-Letters badge dot on the Letters icon regardless of active state', () => {
    const html = renderToStaticMarkup(
      <AppShell active="home" waitingLetterCount={3}>
        <div>content</div>
      </AppShell>
    )
    const mobileNav = mobileNavHtml(html)
    const lettersStart = mobileNav.indexOf('href="/letters"')
    const lettersEnd = mobileNav.indexOf('</a>', lettersStart)
    const lettersAnchor = mobileNav.slice(lettersStart, lettersEnd)
    expect(lettersAnchor).toContain('bg-accent')
    expect(lettersAnchor).toMatch(/rounded-full/)
  })

  it('preserves the touch target — the flex-1 py-2.5 tab container is unchanged by the lozenge treatment', () => {
    const html = renderToStaticMarkup(
      <AppShell active="home" waitingLetterCount={0}>
        <div>content</div>
      </AppShell>
    )
    const mobileNav = mobileNavHtml(html)
    expect(mobileNav).toContain('flex-1 flex-col items-center gap-0.5 py-2.5')
  })
})
