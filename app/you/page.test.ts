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
    expect(source).toContain("publicProfileMarkUrl(supabase, `${profile.mark_id}.png`)")
  })

  it('shows a saved Mark prominently and retains Mindform for legacy profiles', () => {
    expect(source).toContain('aria-label="Your Mark"')
    expect(source).toContain('<Mindform identifier={user.id} size="lg" />')
    expect(source).toContain('Your Mark has not been created yet.')
  })
})
