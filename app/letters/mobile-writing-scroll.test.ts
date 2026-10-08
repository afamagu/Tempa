import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { visualKeyboardInset } from './use-editor-visual-viewport'

const here = __dirname
const read = (relative: string) =>
  readFileSync(path.join(here, relative), 'utf8')

describe('mobile writing scroll contract', () => {
  it('computes keyboard reserve from layout vs visual viewport geometry', () => {
    expect(visualKeyboardInset(844, 500, 0)).toBe(344)
    expect(visualKeyboardInset(844, 500, 40)).toBe(304)
    expect(visualKeyboardInset(844, 844, 0)).toBe(0)
    expect(visualKeyboardInset(600, 650, 0)).toBe(0)
  })

  it('never script-scrolls the page to the caret', () => {
    const source = read('use-editor-visual-viewport.ts')
    expect(source).not.toContain('window.scrollBy')
    expect(source).not.toContain("viewport.addEventListener('scroll'")
    expect(source).not.toContain("document.addEventListener('selectionchange'")
    expect(source).toContain("viewport.addEventListener('resize'")
    expect(source).toContain("document.addEventListener('touchstart'")
  })

  it('all long-form Tempa writing surfaces share the same native-scroll viewport behavior', () => {
    for (const relative of [
      '../write/[recipientId]/first-letter-composer.tsx',
      '[letterId]/first-contact-response.tsx',
      '[letterId]/moments-composer.tsx',
      '../board/dispatch-composer.tsx',
    ]) {
      expect(read(relative)).toContain('useEditorVisualViewport')
    }
  })

  it('top-anchors first-contact and follow-up composition on phones', () => {
    const source = read('../write/[recipientId]/first-letter-composer.tsx')
    expect(source).toContain('min-h-[100dvh] flex items-start justify-center p-4')
    expect(source).toContain('sm:items-center')
    expect(source).not.toContain(
      'ref={composerRootRef} className="min-h-screen flex items-center justify-center p-6"'
    )
  })

  it('asks supporting browsers to resize layout for the on-screen keyboard', () => {
    const layout = read('../layout.tsx')
    expect(layout).toContain('interactiveWidget: "resizes-content"')
  })
})
