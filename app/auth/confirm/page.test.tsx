import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import AuthConfirmPage, { dynamic, metadata } from './page'

const pageSource = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

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
// anywhere in this file at all to audit. Parsing the already-validated
// URL (extractMagicLinkVerificationParams/extractSanitizedNext...) is
// pure string parsing — no network call, no Supabase contact, no
// token consumption.
describe('AuthConfirmPage — never contacts/verifies Supabase, never auto-redirects', () => {
  it('renders successfully with only a search param — no exception, no network call attempted', async () => {
    const html = await render(VALID_CONFIRMATION_URL)
    expect(html).toContain('TEMPA')
  })

  it('contains no meta-refresh tag', async () => {
    const html = await render(VALID_CONFIRMATION_URL)
    expect(html).not.toMatch(/<meta[^>]*http-equiv=["']refresh["']/i)
  })

  it('the page itself has no client directive and defines no effect/timer of its own — the only script present is React 19\'s own generic form-action progressive-enhancement listener, which merely intercepts a REAL browser submit event, never auto-triggers one', async () => {
    expect(pageSource).not.toContain("'use client'")
    // Checking for the actual call shape (with the opening paren) avoids
    // a false positive on this file's own doc comments, which
    // deliberately discuss useEffect/meta-refresh/timers in prose to
    // explain why none of them are used.
    expect(pageSource).not.toContain('useEffect(')
    expect(pageSource).not.toContain('setTimeout(')
    expect(pageSource).not.toContain('setInterval(')

    const html = await render(VALID_CONFIRMATION_URL)
    // React's own injected script (present because the form uses a
    // function `action`) only ever runs in response to a genuine
    // `submit` event — it contains no auto-invocation of any kind.
    expect(html).not.toMatch(/window\.onload|DOMContentLoaded|autofocus|requestSubmit\(\)/i)
  })
})

describe('AuthConfirmPage — a valid Supabase ConfirmationURL produces a human-click control', () => {
  it('shows "Sign in to TEMPA" as an explicit submit button inside a <form>, never a plain link to the raw Supabase URL', async () => {
    const html = await render(VALID_CONFIRMATION_URL)
    expect(html).toContain('Sign in to TEMPA')
    expect(html).toContain('type="submit"')
    // The raw Supabase ConfirmationURL is never rendered anywhere in the
    // page's own HTML — the browser is never navigated there.
    expect(html).not.toContain(SUPABASE_URL)
    expect(html).not.toContain('auth/v1/verify')
  })

  it('the submit control lives inside a real <form>, not a bare <button> with an onClick handler (there is no client script here to attach one)', async () => {
    const html = await render(VALID_CONFIRMATION_URL)
    const formIndex = html.indexOf('<form')
    const buttonIndex = html.indexOf('Sign in to TEMPA')
    expect(formIndex).toBeGreaterThan(-1)
    expect(buttonIndex).toBeGreaterThan(formIndex)
  })

  it('never renders an <a> tag pointing at the Supabase host at all', async () => {
    const html = await render(VALID_CONFIRMATION_URL)
    expect(html).not.toMatch(new RegExp(`<a[^>]*href="${SUPABASE_URL}`))
  })

  it('never renders the "isn\'t valid" fallback copy when the URL is valid', async () => {
    const html = await render(VALID_CONFIRMATION_URL)
    expect(html).not.toContain("isn&#x27;t valid")
  })
})

describe('AuthConfirmPage — final hardening pass: indexing, caching', () => {
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

describe('AuthConfirmPage — rejects unsafe/invalid confirmation_url values, and unverifiable token/type shapes', () => {
  it('an arbitrary external URL is rejected — no form is ever rendered for it', async () => {
    const evil = 'https://evil.example.com/auth/v1/verify?token=x&type=magiclink'
    const html = await render(evil)
    expect(html).not.toContain('Sign in to TEMPA')
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
    expect(html).not.toContain('Sign in to TEMPA')
    expect(html).toContain("isn&#x27;t valid")
  })

  it('a same-origin/same-path URL missing a token is rejected — no form is rendered', async () => {
    const url = `${SUPABASE_URL}/auth/v1/verify?type=magiclink`
    const html = await render(url)
    expect(html).not.toContain('Sign in to TEMPA')
    expect(html).toContain("isn&#x27;t valid")
  })

  it('a same-origin/same-path URL with an unsupported type (e.g. recovery) is rejected — no form is rendered', async () => {
    const url = `${SUPABASE_URL}/auth/v1/verify?token=abc123&type=recovery`
    const html = await render(url)
    expect(html).not.toContain('Sign in to TEMPA')
    expect(html).toContain("isn&#x27;t valid")
  })

  it('no confirmation_url at all also shows the honest fallback, never a broken/empty form', async () => {
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
