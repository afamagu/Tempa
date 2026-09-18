import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('/profile/mark server guards', () => {
  it('requires auth and a profile, renders only at mark, and forwards later stages', () => {
    expect(source).toContain("redirect('/sign-in')")
    expect(source).toContain("redirect('/profile')")
    expect(source).toContain("profile.onboarding_stage === 'question'")
    expect(source).toContain("redirect('/profile/question')")
    expect(source).toContain("profile.onboarding_stage === 'complete'")
    expect(source).toContain("redirect('/home')")
    expect(source).toContain('<YourMarkStep />')
  })
})
