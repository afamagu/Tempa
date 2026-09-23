import { describe, it, expect } from 'vitest'
import nextConfig from './next.config'

// Safety 2 — Checkpoint 9 launch hardening. next.config.ts previously had
// no headers() function at all and no middleware.ts — a genuine, concrete
// gap. These are structural assertions (this repo's usual convention for
// config-level claims), not a runtime server test.
describe('next.config.ts — security headers (Checkpoint 9)', () => {
  it('defines a headers() function', () => {
    expect(typeof nextConfig.headers).toBe('function')
  })

  it('applies a baseline security header set to every route', async () => {
    const rules = await nextConfig.headers!()
    expect(rules).toHaveLength(1)
    expect(rules[0].source).toBe('/:path*')

    const byKey = Object.fromEntries(rules[0].headers.map((h) => [h.key, h.value]))
    expect(byKey['X-Content-Type-Options']).toBe('nosniff')
    expect(byKey['Referrer-Policy']).toBeTruthy()
    expect(byKey['Permissions-Policy']).toBeTruthy()
    // Frame protection — clickjacking defense without a full CSP.
    expect(byKey['X-Frame-Options']).toBe('SAMEORIGIN')
    expect(byKey['Strict-Transport-Security']).toMatch(/max-age=\d+/)
  })

  it('does not add a Content-Security-Policy — deliberately deferred to backlog, not silently forgotten', async () => {
    const rules = await nextConfig.headers!()
    const keys = rules[0].headers.map((h) => h.key.toLowerCase())
    expect(keys).not.toContain('content-security-policy')
  })

  it('still preserves the existing admin/reports redirects', async () => {
    expect(typeof nextConfig.redirects).toBe('function')
    const redirects = await nextConfig.redirects!()
    expect(redirects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: '/admin/reports', destination: '/admin/moderation/reports' }),
        expect.objectContaining({ source: '/admin/reports/:id', destination: '/admin/moderation/reports/:id' }),
      ])
    )
  })
})
