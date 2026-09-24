import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import LetterReader from './letter-reader'

const source = readFileSync(path.join(__dirname, 'letter-reader.tsx'), 'utf8')

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: () => ({}) }) }))

describe('LetterReader — automatic resume only', () => {
  it('tags each paragraph with a stable data-paragraph-index for automatic resume', () => {
    const html = renderToStaticMarkup(
      <LetterReader viewerId="viewer-1" letterId="letter-1" body={'First paragraph.\n\nSecond paragraph.'} moments={[]} />
    )
    expect(html).toContain('data-paragraph-index="0"')
    expect(html).toContain('data-paragraph-index="1"')
  })

  it('has no deliberate Save my place / ribbon UI', () => {
    const html = renderToStaticMarkup(
      <LetterReader viewerId="viewer-1" letterId="letter-1" body={'First paragraph.\n\nSecond paragraph.'} moments={[]} />
    )
    expect(html).not.toContain('Save my place')
    expect(html).not.toContain('Move my place')
    expect(html).not.toContain('Saved place')
    expect(source).not.toContain('SavedPlaceRibbon')
    expect(source).not.toContain('saveReadingPlace')
    expect(source).not.toContain('removeSavedReadingPlace')
  })

  it('restores and records the automatic resume position', () => {
    expect(source).toContain('getReadingPlaceState')
    expect(source).toContain('scrollToAnchor(container, scrollRoot, state.resumeParagraphIndex, state.resumeCharOffset')
    expect(source).toContain('recordReadingProgress')
    expect(source).toContain('getCurrentReadingAnchor(container, scrollRoot)')
  })
})
