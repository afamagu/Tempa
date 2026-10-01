import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('/you — owner archive entry point', () => {
  it('links to /you/archive, labeled "Your archive"', () => {
    expect(source).toContain('href="/you/archive"')
    expect(source).toContain('Your archive')
    expect(source).not.toContain('href="/you/responses"')
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
