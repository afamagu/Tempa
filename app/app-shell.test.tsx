import { describe, it, expect } from 'vitest'
import type { ReactNode } from 'react'
import { renderToStaticMarkup as renderRaw } from 'react-dom/server'
import { NextIntlClientProvider } from 'next-intl'
import en from '@/messages/en.json'
import AppShell from './app-shell'

// AppShell's labels come from the interface dictionary; these tests render
// it in English (localized renders: app/app-shell-localization.test.tsx).
const renderToStaticMarkup = (node: ReactNode) =>
  renderRaw(
    <NextIntlClientProvider locale="en" messages={en}>
      {node}
    </NextIntlClientProvider>
  )

const NAV_KEYS = ['home', 'letters', 'room', 'board', 'you'] as const
const NAV_HREFS: Record<(typeof NAV_KEYS)[number], string> = {
  home: '/home',
  letters: '/letters',
  room: '/room',
  board: '/board',
  you: '/you',
}

function mobileNavHtml(html: string): string {
  const start = html.indexOf('<nav class="fixed inset-x-0 bottom-0')
  expect(start).toBeGreaterThan(-1)
  return html.slice(start)
}

function desktopSidebarHtml(html: string): string {
  const start = html.indexOf('<nav class="hidden')
  const end = html.indexOf('<nav class="fixed inset-x-0 bottom-0')
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return html.slice(start, end)
}

describe('AppShell — compact sidebar branding', () => {
  it('renders the emblem asset alongside the existing italic "Tempa" wordmark in the desktop sidebar only', () => {
    const html = renderToStaticMarkup(<AppShell active="home" waitingLetterCount={0}>{null}</AppShell>)
    const sidebar = desktopSidebarHtml(html)
    expect(sidebar).toContain(`url=${encodeURIComponent('/brand/tempa-emblem.png')}`)
    expect(sidebar).toMatch(/font-serif[^"]*italic[^"]*"[^<]*>Tempa</)
  })

  it('never renders a tagline or the full master lockup in the sidebar', () => {
    const html = renderToStaticMarkup(<AppShell active="home" waitingLetterCount={0}>{null}</AppShell>)
    const sidebar = desktopSidebarHtml(html)
    expect(sidebar).not.toContain('A more human way to connect')
    expect(sidebar).not.toContain('tempa-logo-master.png')
  })

  it('the mobile bottom nav gets no emblem/wordmark forced into it — it stays exactly the 5-item tab bar', () => {
    const html = renderToStaticMarkup(<AppShell active="home" waitingLetterCount={0}>{null}</AppShell>)
    const mobile = mobileNavHtml(html)
    expect(mobile).not.toContain('tempa-emblem')
    expect(mobile).not.toContain('>Tempa<')
  })
})

describe('AppShell — canonical Room navigation', () => {
  it('uses the current member-facing labels and canonical routes', () => {
    const html = renderToStaticMarkup(
      <AppShell active="room" waitingLetterCount={0}>
        <div>content</div>
      </AppShell>
    )
    expect((html.match(/>Pen pals</g) ?? []).length).toBe(2)
    expect((html.match(/>The Room</g) ?? []).length).toBe(2)
    expect((html.match(/>The Board</g) ?? []).length).toBe(2)
    expect(html).toContain('href="/room"')
    expect(html).not.toContain('href="/minds"')
  })

  it('maps the temporary legacy minds active key to The Room', () => {
    const html = renderToStaticMarkup(
      <AppShell active="minds" waitingLetterCount={0}>
        <div>content</div>
      </AppShell>
    )
    const mobileNav = mobileNavHtml(html)
    const hrefIndex = mobileNav.indexOf('href="/room"')
    const tagStart = mobileNav.lastIndexOf('<a ', hrefIndex)
    const anchorEnd = mobileNav.indexOf('</a>', hrefIndex)
    const anchor = mobileNav.slice(tagStart, anchorEnd)
    expect(anchor).toContain('aria-current="page"')
    expect(anchor).toContain('bg-accent/10')
  })
})

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
      const tagStart = mobileNav.lastIndexOf('<a ', hrefIndex)
      const anchorEnd = mobileNav.indexOf('</a>', hrefIndex)
      const anchor = mobileNav.slice(tagStart, anchorEnd)

      if (key === activeKey) {
        expect(anchor).toContain('aria-current="page"')
        expect(anchor).toContain('bg-accent/10')
        expect(anchor).not.toContain('verdigris')
        expect(anchor).toContain('text-accent')
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

  it('preserves the canonical navigation hrefs', () => {
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
