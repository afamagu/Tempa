// Pre-beta security regression — F-01 (open redirect via `next`).
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { sanitizeInternalPath } from '@/lib/safe-redirect'

const ROOT = path.join(__dirname, '..', '..')
const APP_ORIGIN = 'https://jointempa.com'

// How a browser treats the sanitized value when used bare (redirect / href).
const resolvesTo = (value: string) => new URL(value, APP_ORIGIN).origin

describe('sanitizeInternalPath — only same-origin paths survive', () => {
  it.each([
    ['/home', '/home'],
    ['/letters/abc?x=1#y', '/letters/abc?x=1#y'],
    ['/%2F%2Fevil.example', '/%2F%2Fevil.example'],
    ['/%5Cevil.example', '/%5Cevil.example'],
    ['/https://evil.example', '/https://evil.example'],
    ['/@evil.example', '/@evil.example'],
    ['/./%2Fevil.example', '/%2Fevil.example'],
  ])('keeps internal path %s', (input, expected) => {
    expect(sanitizeInternalPath(input)).toBe(expected)
    expect(resolvesTo(expected)).toBe(APP_ORIGIN)
  })

  it.each([
    'https://evil.example',
    'http://evil.example',
    '//evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '/\r/evil.example',
    'https://user:pass@evil.example',
    'javascript:alert(1)',
    'data:text/html,hi',
    // F-01: dot-segment normalisation must not yield a protocol-relative path
    '/.//evil.example',
    '/..//evil.example',
    '/a/..//evil.example',
    '/%2e//evil.example',
    '/%2E%2E//evil.example',
    '/./\\evil.example',
    '/a/../\\evil.example',
    '/' + 'a'.repeat(3000),
    '',
    'home',
  ])('rejects %j', (input) => {
    expect(sanitizeInternalPath(input)).toBeNull()
  })

  it('rejects null / undefined', () => {
    expect(sanitizeInternalPath(null)).toBeNull()
    expect(sanitizeInternalPath(undefined)).toBeNull()
  })

  it('whatever it returns is always same-origin when used bare', () => {
    const fuzz = ['/', '/x/./y', '/x/../y', '/%2e%2e/%2e%2e/z', '/.%2F/evil', '/x/..%2F..%2F/evil', '/;//evil', '/?//evil', '/#//evil', '/x//evil', '/..%5C..%5Cevil']
    for (const input of fuzz) {
      const out = sanitizeInternalPath(input)
      if (out !== null) expect(resolvesTo(out), input).toBe(APP_ORIGIN)
    }
  })
})

describe('every consumer runs `next`/`returnTo` through the sanitizer server-side', () => {
  const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8')
  it('auth callback: sanitizes and prefixes its own origin', () => {
    const src = read('app/auth/callback/route.ts')
    expect(src).toContain("sanitizeInternalPath(searchParams.get('next'))")
    expect(src).toContain('NextResponse.redirect(`${origin}${destination}`)')
  })
  it('magic-link confirm, /begin, sign-in and the People back-link use the sanitizer', () => {
    expect(read('app/auth/confirm/verify-magic-link-action.ts')).toContain('sanitizeInternalPath(next)')
    expect(read('app/begin/page.tsx')).toContain('sanitizeInternalPath(')
    expect(read('app/sign-in/page.tsx')).toContain("sanitizeInternalPath(searchParams.get('next'))")
    expect(read('app/minds/[userId]/people-profile-back.tsx')).toContain('sanitizeInternalPath(returnTo)')
  })
})
