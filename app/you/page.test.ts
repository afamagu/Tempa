import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Onboarding & First-Use checkpoint — People Information Architecture
// (Section F): response management now has an entry point here.
const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('/you — links to the new response-management route', () => {
  it('links to /you/responses, labeled "Your responses"', () => {
    expect(source).toContain('href="/you/responses"')
    expect(source).toContain('Your responses')
  })
})

describe('/you — Mark-aware identity with grandfathered fallback', () => {
  it('reads mark_id privately and resolves the opaque public Mark object', () => {
    expect(source).toContain(".select('pseudonym, mark_id')")
    expect(source).toContain("publicProfileMarkUrl(supabase, `${markId}.png`)")
  })

  it('shows a saved Mark prominently and retains Mindform for legacy profiles', () => {
    expect(source).toContain('<ProfileIdentityMark')
    expect(source).toContain("label={markUrl ? 'Your Mark' : undefined}")
    expect(source).toContain('size="xl"')
    expect(source).toContain('You have not created your Mark yet.')
    expect(source).toContain('href="/you/mark"')
  })
})
