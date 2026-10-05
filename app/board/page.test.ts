import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const source = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')

describe('Board page — finite Phase 11 composition', () => {
  it('keeps first-use guidance and the public-writing framing', () => {
    expect(source).toContain("hasCompletedGuide(supabase, user.id, 'board')")
    expect(source).toContain('<FeatureIntroduction guideKey="board"')
    expect(source).toContain('Writing meant to be stumbled upon.')
  })

  it('uses the finite Board composition instead of passive pagination', () => {
    expect(source).toContain('getFiniteBoardComposition(')
    expect(source).not.toContain('<BoardFeed')
    expect(source).not.toContain('More from the Board')
    expect(source).not.toContain('Refresh the Board')
  })

  it('renders the three bounded editorial sections in the agreed order', () => {
    const crossed = source.indexOf('From people you’ve crossed paths with')
    const kept = source.indexOf('From people you Keep in Mind')
    const unexpected = source.indexOf('Something unexpected')
    expect(crossed).toBeGreaterThan(-1)
    expect(kept).toBeGreaterThan(crossed)
    expect(unexpected).toBeGreaterThan(kept)
  })

  it('ends passive browsing explicitly', () => {
    expect(source).toContain('That’s the Board for now.')
    expect(source).toContain('Search if you’re looking for something particular, or come back another time.')
  })

  it('keeps intentional Search separate and clearable', () => {
    expect(source).toContain('searchDispatches(supabase, query)')
    expect(source).toContain('<DispatchSearch')
    expect(source).toContain('Clear search')
  })

  it('records crossed-path presentation only through the visibility wrapper', () => {
    expect(source).toContain('<BoardCrossedPathImpression')
    expect(source).toContain('candidateId={dispatch.authorId}')
  })
})
