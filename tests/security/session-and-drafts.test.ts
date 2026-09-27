import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { serverCookieOptions, browserCookieOptions } from '@/lib/supabase/cookie-options'
import { clearTempaLocalDrafts, SIGNED_OUT_PARAM, TEMPA_DRAFT_KEY } from '@/lib/local-drafts'

const root = path.resolve(import.meta.dirname, '..', '..')
const read = (p: string) => readFileSync(path.join(root, p), 'utf8')

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

// Pre-beta security F-03 — Secure auth cookies, without breaking
// @supabase/ssr (which must read the session cookie in the browser, so
// HttpOnly is deliberately not set).
describe('auth cookie options', () => {
  it('server cookies are Secure in production and not in local development', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(serverCookieOptions()).toEqual({ secure: true })
    vi.stubEnv('NODE_ENV', 'development')
    expect(serverCookieOptions()).toEqual({ secure: false })
  })

  it('browser cookies are Secure on https', () => {
    vi.stubGlobal('window', { location: { protocol: 'https:' } })
    expect(browserCookieOptions()).toEqual({ secure: true })
    vi.stubGlobal('window', { location: { protocol: 'http:' } })
    expect(browserCookieOptions()).toEqual({ secure: false })
  })

  it('never sets httpOnly (the browser Supabase client must read the session)', () => {
    vi.stubEnv('NODE_ENV', 'production')
    expect(serverCookieOptions()).not.toHaveProperty('httpOnly')
  })

  it('every Supabase SSR client passes the hardened options', () => {
    expect(read('lib/supabase/server.ts')).toContain('cookieOptions: serverCookieOptions()')
    expect(read('lib/supabase/client.ts')).toContain('cookieOptions: browserCookieOptions()')
    expect(read('proxy.ts')).toContain('cookieOptions: serverCookieOptions()')
  })
})

// Pre-beta security F-15 — private drafts do not outlive the session.
describe('local draft cleanup', () => {
  function memoryStorage(entries: Record<string, string>): Storage {
    const map = new Map(Object.entries(entries))
    return {
      get length() {
        return map.size
      },
      key: (i: number) => [...map.keys()][i] ?? null,
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
      removeItem: (k: string) => void map.delete(k),
      clear: () => map.clear(),
    }
  }

  it('removes every Tempa draft namespace and nothing else', () => {
    const storage = memoryStorage({
      'tempa-letter-draft:a': '1',
      'tempa-letter-editor-draft:b': '1',
      'tempa-letter-postcard-draft:c': '1',
      'tempa-first-letter-editor-draft:d': '1',
      'tempa-dispatch-draft:e': '1',
      'tempa-dispatch-postcard-draft:f': '1',
      'tempa-question-draft:g': '1',
      'tempa-reading-place': 'keep',
      theme: 'keep',
    })
    expect(clearTempaLocalDrafts(storage)).toBe(7)
    expect(storage.length).toBe(2)
    expect(storage.getItem('theme')).toBe('keep')
    expect(storage.getItem('tempa-reading-place')).toBe('keep')
  })

  it('never throws when storage is unavailable', () => {
    const broken = { get length(): number { throw new Error('denied') } } as unknown as Storage
    expect(clearTempaLocalDrafts(broken)).toBe(0)
    expect(clearTempaLocalDrafts(null)).toBe(0)
  })

  it('every draft key written in the app uses the cleared namespace', () => {
    for (const file of ['lib/letter-draft.ts', 'lib/letter-editor-draft.ts', 'app/question/question-answer.tsx']) {
      const prefixes = read(file).match(/['`]tempa-[a-z-]+-draft:/g) ?? []
      expect(prefixes.length, file).toBeGreaterThan(0)
      for (const p of prefixes) expect(TEMPA_DRAFT_KEY.test(p.slice(1)), p).toBe(true)
    }
  })

  it('both sign-out actions mark the redirect, and the pages that end a session clear drafts', () => {
    const marker = `redirect('/sign-in?${SIGNED_OUT_PARAM}=1')`
    expect(read('app/begin/sign-out-action.ts')).toContain(marker)
    expect(read('app/you/page.tsx')).toContain(marker)
    expect(read('app/sign-in/page.tsx')).toMatch(/signedOut && <ClearLocalDrafts \/>/)
    expect(read('app/account-deleted/page.tsx')).toContain('<ClearLocalDrafts />')
  })
})
