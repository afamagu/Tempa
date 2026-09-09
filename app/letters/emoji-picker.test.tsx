import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import EmojiPicker from './emoji-picker'

// The picker's open/pick behavior is interactive (useState) and this
// codebase's Vitest convention is renderToStaticMarkup-only (no
// DOM-mounting library, no simulated clicks) — the same limitation
// already accepted for every other disclosure control here (Tooltip,
// LetterActionMenu, neither of which has a test for its open-state
// content either). What IS verifiable statically: the trigger's own
// accessibility, that the panel starts closed, and that a curated
// (not "enormous") set is defined.
describe('EmojiPicker', () => {
  it('renders a single, accessibly-named trigger button', () => {
    const html = renderToStaticMarkup(<EmojiPicker onSelect={() => {}} />)
    expect(html).toContain('aria-label="Insert emoji"')
    expect(html).toContain('aria-expanded="false"')
  })

  it('the emoji panel is not rendered until opened', () => {
    const html = renderToStaticMarkup(<EmojiPicker onSelect={() => {}} />)
    expect(html).not.toContain('role="menu"')
  })

  it('renders exactly one interactive element in its closed state (the trigger)', () => {
    const html = renderToStaticMarkup(<EmojiPicker onSelect={() => {}} />)
    expect((html.match(/<button/g) ?? []).length).toBe(1)
  })
})
