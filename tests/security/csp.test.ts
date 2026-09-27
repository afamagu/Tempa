import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { NextRequest } from 'next/server'
import { buildCsp, generateNonce, originOf, CSP_REPORT_PATH, TURNSTILE_ORIGIN } from '@/lib/security/csp'
import { summarizeCspReports, CSP_REPORT_MAX_BYTES } from '@/lib/security/csp-report'
import { POST as cspReport } from '@/app/api/csp-report/route'
import { proxy, config, isProtectedPath, PROTECTED_MATCHERS } from '@/proxy'

// Pre-beta security F-02 — nonce-based Content-Security-Policy.

const root = path.resolve(import.meta.dirname, '..', '..')
const directives = (csp: string) =>
  Object.fromEntries(csp.split(';').map((d) => d.trim().split(/\s+/)).map(([name, ...values]) => [name, values]))

describe('buildCsp', () => {
  const prod = directives(buildCsp({ nonce: 'abc', supabaseOrigins: ['https://x.supabase.co'], isDev: false }))

  it('scripts: nonce + strict-dynamic, never unsafe-inline or (in production) unsafe-eval', () => {
    expect(prod['script-src']).toEqual(expect.arrayContaining(["'nonce-abc'", "'strict-dynamic'", TURNSTILE_ORIGIN]))
    expect(prod['script-src']).not.toContain("'unsafe-inline'")
    expect(prod['script-src']).not.toContain("'unsafe-eval'")
    expect(prod['style-src']).not.toContain("'unsafe-inline'")
  })

  it('locks down plugins, base URI, form targets and framing, and reports violations', () => {
    expect(prod['object-src']).toEqual(["'none'"])
    expect(prod['base-uri']).toEqual(["'self'"])
    expect(prod['form-action']).toEqual(["'self'"])
    expect(prod['frame-ancestors']).toEqual(["'self'"])
    expect(prod['default-src']).toEqual(["'self'"])
    expect(prod['report-uri']).toEqual([CSP_REPORT_PATH])
  })

  it('allows exactly Supabase and Turnstile beyond self for network, images and frames', () => {
    expect(prod['connect-src']).toEqual(["'self'", 'https://x.supabase.co', TURNSTILE_ORIGIN])
    expect(prod['frame-src']).toEqual([TURNSTILE_ORIGIN])
    expect(prod['img-src']).toContain('https://x.supabase.co')
    expect(Object.values(prod).flat()).not.toContain('*')
  })

  it('upgrade-insecure-requests only when enforced outside development', () => {
    expect(buildCsp({ nonce: 'n', supabaseOrigins: [], isDev: false })).not.toContain('upgrade-insecure-requests')
    expect(buildCsp({ nonce: 'n', supabaseOrigins: [], isDev: false, enforce: true })).toContain('upgrade-insecure-requests')
    expect(buildCsp({ nonce: 'n', supabaseOrigins: [], isDev: true, enforce: true })).not.toContain('upgrade-insecure-requests')
  })

  it('dev-only relaxations stay dev-only', () => {
    const dev = directives(buildCsp({ nonce: 'n', supabaseOrigins: [], isDev: true }))
    expect(dev['script-src']).toContain("'unsafe-eval'")
    expect(dev['connect-src']).toContain('ws:')
  })

  it('originOf accepts only http(s) URLs', () => {
    expect(originOf('https://x.supabase.co/rest/v1')).toBe('https://x.supabase.co')
    expect(originOf('javascript:alert(1)')).toBeNull()
    expect(originOf('not a url')).toBeNull()
    expect(originOf(undefined)).toBeNull()
  })

  it('nonces are 128-bit and unique', () => {
    const nonces = new Set(Array.from({ length: 200 }, generateNonce))
    expect(nonces.size).toBe(200)
    for (const n of nonces) expect(atob(n)).toHaveLength(16)
  })
})

describe('proxy CSP wiring', () => {
  it('a public page gets the Report-Only policy on response and request, with a fresh nonce each time', async () => {
    const a = await proxy(new NextRequest('https://jointempa.com/terms'))
    const b = await proxy(new NextRequest('https://jointempa.com/terms'))
    const csp = a.headers.get('content-security-policy-report-only')
    expect(csp).toMatch(/script-src [^;]*'nonce-[A-Za-z0-9+/=]+'/)
    expect(a.headers.get('x-middleware-request-content-security-policy-report-only')).toBe(csp)
    expect(a.headers.get('x-middleware-request-x-nonce')).toBeTruthy()
    expect(csp).not.toBe(b.headers.get('content-security-policy-report-only'))
  })

  it('every redirect the proxy issues carries the policy', () => {
    const source = readFileSync(path.join(root, 'proxy.ts'), 'utf8')
    const redirects = source.match(/NextResponse\.redirect\(/g) ?? []
    const wrapped = source.match(/withCsp\(NextResponse\.redirect\(/g) ?? []
    expect(redirects.length).toBeGreaterThan(0)
    expect(wrapped.length).toBe(redirects.length)
  })

  it('the matcher covers every HTML route but skips API routes and static files', () => {
    const matcher = new RegExp(`^${config.matcher[0]}$`)
    for (const p of ['/', '/sign-in', '/terms', '/home', '/letters/abc', '/letters/a.b', '/d/token', '/admin']) {
      expect(matcher.test(p), p).toBe(true)
    }
    for (const p of ['/api/safety/evaluate', '/_next/static/x.js', '/icons/icon-192.png', '/robots.txt', '/sitemap.xml', '/.well-known/security.txt', '/manifest.webmanifest']) {
      expect(matcher.test(p), p).toBe(false)
    }
  })

  it('the auth gate still covers every originally protected route', () => {
    expect([...PROTECTED_MATCHERS]).toEqual([
      '/', '/admin/:path*', '/announcement/:path*', '/board/:path*', '/home/:path*', '/letters/:path*',
      '/minds/:path*', '/profile/:path*', '/question/:path*', '/write/:path*', '/you/:path*',
    ])
    expect(isProtectedPath('/admin/moderation')).toBe(true)
    expect(isProtectedPath('/letters')).toBe(true)
    expect(isProtectedPath('/lettersx')).toBe(false)
    expect(isProtectedPath('/sign-in')).toBe(false)
  })
})

describe('CSP report endpoint', () => {
  it('logs only directive, blocked origin and document path — never query strings', () => {
    const [summary] = summarizeCspReports({
      'csp-report': {
        'document-uri': 'https://jointempa.com/letters/1?token=secret',
        'blocked-uri': 'https://evil.example/x.js?session=abc',
        'effective-directive': 'script-src-elem',
      },
    })
    expect(summary).toEqual({ directive: 'script-src-elem', blocked: 'https://evil.example', path: '/letters/1' })
    expect(JSON.stringify(summary)).not.toMatch(/secret|session/)
  })

  it('always answers 204, including oversize and malformed bodies', async () => {
    const post = (body: string, headers: Record<string, string> = {}) =>
      cspReport(new Request('https://jointempa.com/api/csp-report', { method: 'POST', body, headers }))
    expect((await post('{not json')).status).toBe(204)
    expect((await post('{}', { 'content-length': String(CSP_REPORT_MAX_BYTES + 1) })).status).toBe(204)
  })
})
