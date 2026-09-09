import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Editor } from '@tiptap/react'
import WritingToolbar from './writing-toolbar'

// A minimal stand-in for a live Tiptap Editor — only `isActive` is
// ever called during a static render (chain()/focus()/toggleBold()
// etc. only run inside onClick handlers, which renderToStaticMarkup
// never executes), so only that needs stubbing. A REAL Editor needs a
// DOM (ProseMirror's EditorView), which this project's Vitest
// environment deliberately doesn't provide (environment: 'node' in
// vitest.config.mts, matching the whole codebase's renderToStaticMarkup-
// only convention) — full toolbar-click behavior remains a live-test item.
function fakeEditor(active: { bold?: boolean; italic?: boolean }): Editor {
  return {
    isActive: (name: string) => Boolean(active[name as 'bold' | 'italic']),
  } as unknown as Editor
}

describe('WritingToolbar', () => {
  it('has real, accessibly-named Bold and Italic buttons, plus the emoji trigger', () => {
    const html = renderToStaticMarkup(<WritingToolbar editor={fakeEditor({})} />)
    expect(html).toContain('aria-label="Bold"')
    expect(html).toContain('aria-label="Italic"')
    expect(html).toContain('aria-label="Insert emoji"')
  })

  it('exposes aria-pressed="false" when neither mark is active', () => {
    const html = renderToStaticMarkup(<WritingToolbar editor={fakeEditor({})} />)
    expect(html).toMatch(/aria-label="Bold"[^>]*aria-pressed="false"/)
    expect(html).toMatch(/aria-label="Italic"[^>]*aria-pressed="false"/)
  })

  it('exposes aria-pressed="true" on Bold when the caret/selection is inside bold text', () => {
    const html = renderToStaticMarkup(<WritingToolbar editor={fakeEditor({ bold: true })} />)
    expect(html).toMatch(/aria-label="Bold"[^>]*aria-pressed="true"/)
    expect(html).toMatch(/aria-label="Italic"[^>]*aria-pressed="false"/)
  })

  it('exposes aria-pressed="true" on Italic independently of Bold', () => {
    const html = renderToStaticMarkup(<WritingToolbar editor={fakeEditor({ italic: true })} />)
    expect(html).toMatch(/aria-label="Bold"[^>]*aria-pressed="false"/)
    expect(html).toMatch(/aria-label="Italic"[^>]*aria-pressed="true"/)
  })

  it('does not crash and disables its buttons when the editor is not yet available (null)', () => {
    const html = renderToStaticMarkup(<WritingToolbar editor={null} />)
    expect(html).toContain('disabled')
    expect(html).toMatch(/aria-label="Bold"[^>]*aria-pressed="false"/)
  })

  it('never adds controls beyond Bold, Italic, and Emoji — no underline, headings, links, or colors', () => {
    const html = renderToStaticMarkup(<WritingToolbar editor={fakeEditor({})} />)
    expect(html.toLowerCase()).not.toContain('underline')
    expect(html.toLowerCase()).not.toContain('heading')
    expect(html.toLowerCase()).not.toContain('link')
  })
})
