import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import en from '@/messages/en.json'

const source = readFileSync(path.join(__dirname, 'your-mark-step.tsx'), 'utf8')

describe('production Your Mark experience', () => {
  it('uses only the approved V2 generator and contains no rejected-family product language', () => {
    expect(source).toContain("import { generateMarkV2, type MarkResult } from '@/lib/mark/mark-engine'")
    expect(source).toContain('await generateMarkV2(file)')
    expect(source).not.toMatch(/generateMark(?:V3|Cut|Glass|Wash|Weave|Contour|Glyph)/)
    expect(source).not.toMatch(/family picker|structure mode|regenerate/i)
  })

  it('keeps the source photograph browser-local and persists only the generated PNG Blob', () => {
    expect(source).toContain('const result = await generateMarkV2(file)')
    expect(source).toContain('persistGeneratedMark(supabase, generated?.blob ?? null, reservation)')
    expect(source).not.toMatch(/persistGeneratedMark\([^\n]*file/)
    expect(source).not.toMatch(/\.upload\([^\n]*file/)
    expect(source).not.toMatch(/localStorage|sessionStorage|indexedDB|fetch\(/)
  })

  it('keeps the approved one-Mark reveal copy in the canonical English dictionary', () => {
    expect(en.MarkOnboarding).toMatchObject({
      heading: 'Choose a photograph that means something to you.',
      intro: 'It can be you, a place, an object — anything.',
      privacy: 'Your photograph never leaves this device.',
      finding: 'Finding your Mark…',
      revealHeading: 'This is your Mark.',
      revealBody: 'It began with your photograph. Others will see only what remains.',
      revealClosing: 'Every Mark you meet began the same way.',
      continue: 'Continue',
      chooseAnother: 'Choose another photograph',
    })
    expect(source).toContain("useTranslations('MarkOnboarding')")
    expect(source).not.toContain('Choose the one')
  })

  it('makes the first introduction of YOUR MARK materially more prominent without turning it into a competing hero heading', () => {
    expect(source).toContain('text-sm font-medium italic uppercase tracking-[0.22em]')
    expect(source).toContain('sm:text-[15px]')
    expect(source).not.toContain('font-serif text-xs italic uppercase tracking-[0.2em] text-muted')
  })

  it('provides an accessible single image chooser, live status, reveal focus, translated alt text and responsive sizing', () => {
    expect(source).toContain('type="file"')
    expect(source).toContain('accept="image/*"')
    expect(source).not.toContain('multiple')
    expect(source).toContain('htmlFor="your-mark-photograph"')
    expect(source).toContain('aria-live="polite"')
    expect(source).toContain('revealHeadingRef.current?.focus()')
    expect(source).toContain("alt={t('imageAlt')}")
    expect(source).toContain('max-w-[20rem]')
    expect(source).toContain('sm:max-w-[22.5rem]')
  })
})
