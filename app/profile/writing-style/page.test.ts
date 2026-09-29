import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))

import { resolveWritingStyleNext } from './page'

const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const youSource = readFileSync(path.join(__dirname, '..', '..', 'you', 'writing-style', 'page.tsx'), 'utf8')
const youHome = readFileSync(path.join(__dirname, '..', '..', 'you', 'page.tsx'), 'utf8')

describe('/profile/writing-style — next destination', () => {
  it('continues to a safe internal destination after the choice', () => {
    expect(resolveWritingStyleNext('/minds')).toBe('/minds')
    expect(resolveWritingStyleNext('/letters/abc?x=1')).toBe('/letters/abc?x=1')
  })

  it('never an external or protocol-relative URL, and never back to itself', () => {
    for (const bad of ['https://evil.test', '//evil.test', 'javascript:alert(1)', undefined, '', '/profile/writing-style', '/profile/writing-style?next=%2Fhome']) {
      expect(resolveWritingStyleNext(bad)).toBe('/home')
    }
  })
})

describe('/profile/writing-style — server guards (defense in depth behind proxy.ts)', () => {
  it('requires auth and a profile, and resumes earlier steps where they belong', () => {
    expect(source).toContain("redirect('/sign-in')")
    expect(source).toContain("redirect('/profile')")
    expect(source).toContain("profile.onboarding_stage === 'mark') redirect('/profile/mark')")
    expect(source).toContain("profile.onboarding_stage === 'question') redirect('/profile/question')")
  })

  it('is one-time: a member who already has a valid style is sent on, never shown it again', () => {
    expect(source).toContain('const current = await getMyWritingStyle(supabase, user.id)')
    expect(source).toContain('if (current) redirect(destination)')
  })

  it('previews the member’s own words and uses the restrained copy', () => {
    expect(source).toContain('getWritingSample(supabase, user.id)')
    expect(source).toContain('heading={WRITING_STYLE_HEADING}')
    expect(source).toContain("sampleIsOwn={sample.source !== 'fallback'}")
  })
})

describe('You → Writing style', () => {
  it('uses the same chooser, starting from the current style', () => {
    expect(youSource).toContain('<WritingStyleChooser')
    expect(youSource).toContain('mode="settings"')
    expect(youSource).toContain('initialStyleId={current}')
    expect(youSource).toMatch(/already sent keep the style they were sent in/)
  })

  it('is reachable from You alongside the other presence settings', () => {
    expect(youHome).toContain('href="/you/writing-style"')
    expect(youHome).toContain('<span>Writing style</span>')
  })
})
