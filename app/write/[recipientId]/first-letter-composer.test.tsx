import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

// Post-onboarding corrections checkpoint (Section E) — a live smoke test
// found the first-contact Sent screen still said "Back to Minds" after
// the People rename. Client component with Tiptap's useEditor and a
// network-driven `sent` state that can't be reached via
// renderToStaticMarkup (same "not directly render-tested" convention as
// every other stateful client composer in this codebase) — proven via
// source inspection instead.
const source = readFileSync(path.join(__dirname, 'first-letter-composer.tsx'), 'utf8')

describe('FirstLetterComposer — "Minds" renamed to "People" in user-visible copy (Section E)', () => {
  it('never shows "Back to Minds" anywhere — neither the pre-send composer nor the post-send Sent screen', () => {
    expect(source).not.toContain('Back to Minds')
  })

  it('both "Back" links say "Back to People", still pointing at the unchanged /minds route', () => {
    const matches = source.match(/Back to People/g) ?? []
    expect(matches.length).toBe(2)
    // The internal route itself is deliberately unchanged — only the
    // user-visible label moved.
    expect(source).toContain('href="/minds"')
    expect((source.match(/href="\/minds"/g) ?? []).length).toBe(2)
  })

  it('the Sent screen (rendered when sent === true) is the one with "Back to People", not just the pre-send toolbar', () => {
    const sentBlockStart = source.indexOf('if (sent) {')
    const sentBlockEnd = source.indexOf('\n  }\n', sentBlockStart)
    expect(source.slice(sentBlockStart, sentBlockEnd)).toContain('Back to People')
  })
})
