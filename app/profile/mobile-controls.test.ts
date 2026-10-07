import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const ui = readFileSync(path.join(__dirname, 'ui.ts'), 'utf8')
const select = readFileSync(path.join(__dirname, 'searchable-select.tsx'), 'utf8')
const multi = readFileSync(path.join(__dirname, 'searchable-multi-select.tsx'), 'utf8')

describe('mobile control ergonomics', () => {
  it('keeps form inputs at 16px on phones so iOS does not focus-zoom them', () => {
    expect(ui).toContain('text-base sm:text-[15px]')
  })

  it('gives shared phone controls a 44px minimum tap target while preserving desktop density', () => {
    expect(ui).toContain('min-h-11')
    expect(ui).toContain('h-11 w-11')
    expect(ui).toContain('sm:h-9 sm:w-9')
    expect(ui).toContain('sm:min-h-0')
  })

  it('gives long country/language picker rows full mobile tap targets', () => {
    expect(select).toContain('min-h-11 w-full text-left')
    expect(multi).toContain('min-h-11 w-full text-left')
  })
})
