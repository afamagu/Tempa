import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const read = (...parts: string[]) => readFileSync(path.join(__dirname, ...parts), 'utf8')
const postcardEditor = read('[letterId]', 'postcard-editor.tsx')
const letterPreview = read('[letterId]', 'letter-preview.tsx')
const momentDisplay = read('moment-display.tsx')
const letterhead = read('letterhead-postcard.tsx')
const globals = read('..', 'globals.css')

describe('mobile writing overlays', () => {
  it('keeps full-screen writing workspaces inside every device safe area', () => {
    expect(globals).toContain('.safe-fixed-screen')
    expect(postcardEditor).toContain('safe-fixed-screen fixed inset-0')
    expect(letterPreview).toContain('safe-fixed-screen fixed inset-0')
  })

  it('keeps expanded Moment and Postcard viewers clear of cutouts', () => {
    expect(globals).toContain('.safe-overlay-pad')
    expect(momentDisplay).toContain('safe-overlay-pad fixed inset-0')
    expect(letterhead).toContain('safe-overlay-pad fixed inset-0')
  })

  it('uses phone-sized close controls without changing desktop density', () => {
    expect(momentDisplay).toContain('h-11 w-11')
    expect(momentDisplay).toContain('sm:h-9 sm:w-9')
    expect(letterhead).toContain('h-11 w-11')
    expect(letterhead).toContain('sm:h-9 sm:w-9')
  })
})
