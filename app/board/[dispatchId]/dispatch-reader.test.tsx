import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import DispatchReader from './dispatch-reader'

const source = readFileSync(path.join(__dirname, 'dispatch-reader.tsx'), 'utf8')

vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({ from: () => ({}) }) }))

describe('DispatchReader — automatic resume, no bookmark workflow', () => {
  it('renders the body without swipe/carousel/next-Dispatch affordances', () => {
    const html = renderToStaticMarkup(
      <DispatchReader
        viewerId="viewer-1"
        dispatchId="dispatch-1"
        body={'First paragraph.\n\nSecond paragraph.'}
        moments={[]}
        initialPosition={0}
      />
    )
    const lower = html.toLowerCase()
    expect(lower).not.toContain('swipe')
    expect(lower).not.toContain('up next')
    expect(lower).not.toContain('next dispatch')
    expect(lower).not.toContain('carousel')
  })

  it('tags paragraphs for the existing dispatch_views resume tracker', () => {
    const html = renderToStaticMarkup(
      <DispatchReader
        viewerId="viewer-1"
        dispatchId="dispatch-1"
        body={'First paragraph.\n\nSecond paragraph.'}
        moments={[]}
        initialPosition={0}
      />
    )
    expect(html).toContain('data-paragraph-index="0"')
    expect(html).toContain('data-paragraph-index="1"')
  })

  it('has no deliberate Save my place / ribbon UI and does not use reading_places', () => {
    expect(source).not.toContain('Save my place')
    expect(source).not.toContain('SavedPlaceControls')
    expect(source).not.toContain('SavedPlaceRibbon')
    expect(source).not.toContain('reading-places')
    expect(source).not.toContain('reading_places')
  })

  it('continues to restore and persist through dispatch_views', () => {
    expect(source).toContain('recordDispatchProgress')
    expect(source).toContain('target?.scrollIntoView')
    expect(source).toContain('initialPosition')
  })
})
