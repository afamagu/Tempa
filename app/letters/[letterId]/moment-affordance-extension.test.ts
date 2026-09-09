import { describe, it, expect } from 'vitest'
import { canReuseMomentDecorations } from './moment-affordance-extension'

// Writing/composer essentials checkpoint — the fix for "selecting text
// (including a double-click) shouldn't churn the ⊕ widget DOM." This
// tests the actual decision logic in isolation, since mounting a real
// ProseMirror EditorView needs a DOM/jsdom environment this project's
// Vitest config deliberately doesn't use (see vitest.config.mts —
// environment: 'node', matching this whole codebase's renderToStatic
// Markup-only testing convention). Full browser confirmation that a
// double-click now selects the clicked word remains a live-test item.
describe('canReuseMomentDecorations', () => {
  const docA = { marker: 'doc-a' }
  const docB = { marker: 'doc-b' }

  it('reuses the previous DecorationSet when doc and activeIndex are both unchanged', () => {
    expect(canReuseMomentDecorations({ doc: docA, activeIndex: 2 }, docA, 2)).toBe(true)
  })

  it('does NOT reuse when the document reference changed (a real edit happened)', () => {
    expect(canReuseMomentDecorations({ doc: docA, activeIndex: 2 }, docB, 2)).toBe(false)
  })

  it('does NOT reuse when activeIndex changed (caret moved to a different paragraph)', () => {
    expect(canReuseMomentDecorations({ doc: docA, activeIndex: 2 }, docA, 3)).toBe(false)
  })

  it('does NOT reuse when there is no previous computation yet', () => {
    expect(canReuseMomentDecorations(null, docA, 0)).toBe(false)
  })

  it('a selection-only transaction (doc unchanged) within the SAME paragraph is exactly the case this must catch', () => {
    // Simulates: click 1 of a double-click sets the caret inside an
    // already-finished paragraph — doc is untouched, activeIndex stays
    // whatever paragraph that caret lands in. Click 2 (the native
    // word-selection) must not have had the widget DOM rebuilt out
    // from under it in between.
    const previous = { doc: docA, activeIndex: 1 }
    expect(canReuseMomentDecorations(previous, docA, 1)).toBe(true)
  })
})
