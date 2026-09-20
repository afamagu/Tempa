import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const letterComposer = readFileSync(path.join(__dirname, 'moments-composer.tsx'), 'utf8')
const dispatchComposer = readFileSync(path.join(__dirname, '..', '..', 'board', 'dispatch-composer.tsx'), 'utf8')
const picker = readFileSync(path.join(__dirname, 'postcard-picker.tsx'), 'utf8')

describe('Postcard picker mobile viewport shell', () => {
  it.each([
    ['Letter', letterComposer],
    ['Dispatch', dispatchComposer],
  ])('%s uses a full-viewport, independently scrollable and overscroll-contained layer', (_surface, source) => {
    expect(source).toContain('fixed inset-0 z-50 overflow-y-auto overscroll-contain')
    expect(source).toContain('touch-pan-y')
    expect(source).not.toContain('fixed inset-x-0 bottom-0 z-50 bg-background p-4 shadow-lg')
  })

  it('locks and restores document scrolling for the lifetime of the picker', () => {
    expect(picker).toContain("document.body.style.overflow = 'hidden'")
    expect(picker).toContain('document.body.style.overflow = previousOverflow')
  })

  it('does not display the internal Living label', () => {
    expect(picker).not.toMatch(/>\s*Living\s*</)
  })
})
