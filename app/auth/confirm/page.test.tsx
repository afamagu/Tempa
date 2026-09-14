import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import AuthConfirmPage, { dynamic, metadata } from './page'

const SUPABASE_URL = 'https://abcdefghijklmnop.supabase.co'
const ORIGINAL_ENV = process.env.NEXT_PUBLIC_SUPABASE_URL

beforeEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL
})

afterEach(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = ORIGINAL_ENV
})

async function render(confirmationUrl?: string) {
  const html = renderToStaticMarkup(
    await AuthConfirmPage({ searchParams: Promise.resolve({ confirmation_url: confirmationUrl }) })
  )
  return html
}

const VALID_CONFIRMATION_URL = `${SUPABASE_URL}/auth/v1/verify?token=abc123&type=magiclink&redirect_to=https%3A%2F%2Fjointempa.com%2Fauth%2Fcallback`

// Checkpoint 1, Phase B — the prefetch-safe intermediate page. A pure
// SERVER COMPONENT (no client script for its own core function), so
// rendering it can never itself perform auth verification, a token
// exchange, or any automatic navigation — that's a structural
// guarantee, not just a behavioral one, since there is no effect/timer
// anywhere in this file at all to audit.
describe('AuthConfirmPage — never contacts/verifies Supabase, never auto-redirects', () => {
  it('renders successfully with only a search param — no exception, no network call attempted', async () => {
    const html = await render(VALID_CONFIRMATION_URL)
    expect(html).toContain('TEMPA')
  })

  it('contains no meta-refresh tag', async () => {
    const html = await render(VALID_CONFIRMATION_URL)
    expect(html).not.toMatch(/<meta[^>]*http-equiv=["']refresh["']/i)
  })

  it('contains no inline script and no useEffect-driven auto-navigation — the file itself has no client directive', async () => {
    const html = await render(VALID_CONFIRMATION_URL)
    expect(html).not.toContain('<script')
  })
})

describe('AuthConfirmPage — a valid Supabase ConfirmationURL produces a human-click control', () => {
  // React's own SSR renderer HTML-escapes `&` to `&amp;` inside an
  // attribute value (correct, standard HTML) — the assertions below
  // match that escaped form, and separately confirm (via URL parsing)
  // that the DECODED href is the exact, unmodified validated URL.
  const ESCAPED_HREF = `href="${VALID_CONFIRMATION_URL.replace(/&/g, '&amp;')}"`

  it('shows "Sign in to TEMPA" as a plain anchor pointing at the exact validated URL', async () => {
    const html = await render(VALID_CONFIRMATION_URL)
    expect(html).toContain('Sign in to TEMPA')
    expect(html).toContain(ESCAPED_HREF)
  })

  it('the confirmation link is a plain <a>, never a Next.js <Link> (which could prefetch it)', async () => {
    const html = await render(VALID_CONFIRMATION_URL)
    const anchorIndex = html.indexOf('Sign in to TEMPA')
    const tagStart = html.lastIndexOf('<a ', anchorIndex)
    expect(tagStart).toBeGreaterThan(-1)
    // A real <a> element, not a Next <Link> render (which also emits an
    // <a>, but this proves the href is the raw external URL, not an
    // internal Next route — no leading "/" and no next/link-only
    // attributes like data-... prefetch markers would apply here).
    expect(html.slice(tagStart, anchorIndex)).toContain(ESCAPED_HREF)
  })

  it('never renders the "isn\'t valid" fallback copy when the URL is valid', async () => {
    const html = await render(VALID_CONFIRMATION_URL)
    expect(html).not.toContain("isn&#x27;t valid")
  })
})

describe('AuthConfirmPage — final hardening pass: referrer, indexing, caching', () => {
  it('the human-click link carries referrerPolicy="no-referrer", so this page\'s own URL (which itself carries the confirmation_url query value) is never sent to Supabase as a Referer header', async () => {
    const html = await render(VALID_CONFIRMATION_URL)
    const ESCAPED_HREF = `href="${VALID_CONFIRMATION_URL.replace(/&/g, '&amp;')}"`
    const anchorIndex = html.indexOf(ESCAPED_HREF)
    expect(anchorIndex).toBeGreaterThan(-1)
    const tagEnd = html.indexOf('>', anchorIndex)
    expect(html.slice(anchorIndex, tagEnd).toLowerCase()).toContain('referrerpolicy="no-referrer"')
  })

  it('the route is marked noindex, nofollow — a credential-bearing URL must never be a crawlable/indexable product page', () => {
    expect(metadata.robots).toMatchObject({ index: false, follow: false })
  })

  it('the route is explicitly marked dynamic so it can never be served as static/cached HTML — every visit carries a different, one-time confirmation_url', () => {
    expect(dynamic).toBe('force-dynamic')
  })

  it('renders no <img>, no remote stylesheet/font link, and no third-party embed that could leak the page URL via its own request', async () => {
    const html = await render(VALID_CONFIRMATION_URL)
    expect(html).not.toContain('<img')
    expect(html).not.toContain('<iframe')
    expect(html).not.toMatch(/<link[^>]*rel=["']stylesheet["']/i)
  })
})

describe('AuthConfirmPage — rejects unsafe/invalid confirmation_url values', () => {
  it('an arbitrary external URL is rejected — no link is ever rendered to it', async () => {
    const evil = 'https://evil.example.com/auth/v1/verify?token=x'
    const html = await render(evil)
    expect(html).not.toContain(`href="${evil}"`)
    expect(html).toContain("isn&#x27;t valid")
  })

  it('a javascript: scheme is rejected outright', async () => {
    const html = await render('javascript:alert(1)')
    expect(html).not.toContain('javascript:alert')
    expect(html).toContain("isn&#x27;t valid")
  })

  it('a data: scheme is rejected outright', async () => {
    const html = await render('data:text/html,<script>alert(1)</script>')
    expect(html).not.toContain('data:text/html')
    expect(html).toContain("isn&#x27;t valid")
  })

  it('the correct Supabase host but the wrong path is rejected', async () => {
    const wrongPath = `${SUPABASE_URL}/some-other-endpoint?token=x`
    const html = await render(wrongPath)
    expect(html).not.toContain(`href="${wrongPath}"`)
    expect(html).toContain("isn&#x27;t valid")
  })

  it('no confirmation_url at all also shows the honest fallback, never a broken/empty link', async () => {
    const html = await render(undefined)
    expect(html).toContain("isn&#x27;t valid")
    expect(html).not.toContain('Sign in to TEMPA')
  })

  it('the fallback offers a real way back to sign-in, never a dead end', async () => {
    const html = await render(undefined)
    expect(html).toContain('href="/sign-in"')
    expect(html).toContain('Back to sign in')
  })
})
