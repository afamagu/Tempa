import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const visibleSource = source.replace(/\/\*[\s\S]*?\*\//g, '')

describe('/you — owner archive entry point', () => {
  it('links to /you/archive, labeled Your archive', () => {
    expect(source).toContain('href="/you/archive"')
    expect(source).toContain('Your archive')
    expect(source).not.toContain('href="/you/responses"')
  })
})

describe('/you — correspondence settings', () => {
  it('reads the canonical writing rhythm and links to You → Correspondence', () => {
    expect(source).toContain('getMyWritingRhythm(supabase)')
    expect(source).toContain('writingRhythmLabel')
    expect(source).toContain('href="/you/correspondence"')
    expect(source).toContain('<span>Correspondence</span>')
  })

  it('gives existing members with no rhythm a clear, non-deadline prompt', () => {
    expect(source).toContain("rhythmLabel ?? 'Choose your rhythm'")
  })
})

describe('/you — member terminology', () => {
  it('shows Blocked members and never the retired Blocked minds label', () => {
    expect(source).toContain('<span>Blocked members</span>')
    expect(visibleSource).not.toContain('Blocked minds')
  })
})

describe('/you — Mark-aware identity with grandfathered fallback', () => {
  it('reads mark_id privately and resolves the opaque public Mark object', () => {
    expect(source).toContain(".select('pseudonym, mark_id')")
    expect(source).toContain("publicProfileMarkUrl(supabase, `${markId}.png`)")
  })

  it('shows a saved Mark prominently and keeps a neutral fallback for legacy profiles', () => {
    expect(source).toContain('<ProfileIdentityMark')
    expect(source).toContain("label={markUrl ? 'Your Mark' : undefined}")
    expect(source).toContain('size="xl"')
    expect(source).toContain('You have not created your Mark yet.')
    expect(source).toContain('href="/you/mark"')
  })
})


describe('/you — Credits visibility', () => {
  it('shows Credits directly under You with the current balance', () => {
    expect(source).toContain("getCreditBalance(supabase)")
    expect(source).toContain('href="/you/credits"')
    expect(source).toContain('<span className="font-semibold">Credits</span>')
    expect(source).toContain('{creditBalance.toLocaleString()} available')
  })
})
