import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Post-onboarding corrections checkpoint (Section F) — a live smoke test
// found the Board guide replay's CTA ("See what's on the Board") stayed
// on /you/guide instead of actually going to the Board. The root cause
// (ReplayFeatureIntroduction's × and CTA sharing one callback) is fixed
// and covered separately (./replay-feature-introduction.test.tsx); this
// file pins the correct destinationHref for every one of the four
// lightweight guide replay pages, so a label/destination mismatch like
// the Board one can't silently return. Async Server Components with a
// Supabase auth dependency, same "not directly render-tested" convention
// as every other page like this in this codebase — proven via source
// inspection instead.
function read(...parts: string[]) {
  return readFileSync(path.join(__dirname, ...parts), 'utf8')
}

describe('Guide replay CTA destinations agree with their labels (Section F)', () => {
  it('People — "Start exploring" goes to /minds, the People directory itself', () => {
    const source = read('people', 'page.tsx')
    expect(source).toContain('ctaLabel="Start exploring"')
    expect(source).toContain('destinationHref="/minds"')
  })

  it('Board — "See what\'s on the Board" goes to /board (the confirmed smoke-test bug)', () => {
    const source = read('board', 'page.tsx')
    expect(source).toContain('ctaLabel="See what\'s on the Board"')
    expect(source).toContain('destinationHref="/board"')
  })

  it('Dispatch composer — "Start writing" goes to /board/write, the actual Dispatch creation surface', () => {
    const source = read('dispatch-composer', 'page.tsx')
    expect(source).toContain('ctaLabel="Start writing"')
    expect(source).toContain('destinationHref="/board/write"')
  })

  it('Postcard — "Choose a postcard" goes to /board/write, a genuine Postcard-capable surface (no standalone picker exists outside a live composer)', () => {
    const source = read('postcard', 'page.tsx')
    expect(source).toContain('ctaLabel="Choose a postcard"')
    expect(source).toContain('destinationHref="/board/write"')
  })

  // Q2 — the first-read Dispatch introduction's replay entry, added
  // alongside the other four.
  it('Reading a Dispatch — "Start reading" goes to /board, a genuine reading-capable surface (no single "the" Dispatch to reopen from a replay)', () => {
    const source = read('dispatch-reading', 'page.tsx')
    expect(source).toContain('ctaLabel="Start reading"')
    expect(source).toContain('destinationHref="/board"')
  })
})
