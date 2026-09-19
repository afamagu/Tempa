import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const stepSource = readFileSync(path.join(__dirname, '..', '..', 'profile', 'mark', 'your-mark-step.tsx'), 'utf8')

describe('/you/mark — voluntary Mark management', () => {
  it('keeps incomplete new members in onboarding but never sends complete legacy members back through it', () => {
    expect(source).toContain("if (profile.onboarding_stage === 'mark') redirect('/profile/mark')")
    expect(source).toContain("if (profile.onboarding_stage === 'question') redirect('/profile/question')")
    expect(source).not.toMatch(/onboarding_stage\s*===\s*['"]complete['"]\).*redirect/)
  })

  it('allows a first voluntary Mark and requires a deliberate replacement confirmation', () => {
    expect(source).toContain('if (!markUrl || (replace === \'1\' && status.canChange))')
    expect(source).toContain('A Mark can be changed only once every 30 days.')
    expect(source).toContain('href="/you/mark?replace=1"')
    expect(source).toContain('destination="/you"')
  })

  it('shows the server-provided next-change date when replacement is locked', () => {
    expect(source).toContain('status.nextChangeAt')
    expect(source).toContain('formatDatePlain(status.nextChangeAt)')
  })

  it('reuses the browser-local V2 flow and routes back to You after persistence', () => {
    expect(stepSource).toContain('generateMarkV2(file)')
    expect(stepSource).toContain('await persistGeneratedMark')
    expect(stepSource).toContain('router.push(destination)')
    expect(stepSource).not.toMatch(/fetch\s*\([^)]*file/)
  })
})
