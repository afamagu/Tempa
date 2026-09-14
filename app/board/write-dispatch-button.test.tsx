import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import WriteDispatchButton from './write-dispatch-button'

// Release Polish Pass — The Board's writing CTA now carries the same
// quill mark used elsewhere (app/quill-icon.tsx) rather than a bare
// text button, and the text label stays accessibly available (never
// icon-only).
describe('WriteDispatchButton', () => {
  it('links to the Dispatch composer', () => {
    const html = renderToStaticMarkup(<WriteDispatchButton />)
    expect(html).toContain('href="/board/write"')
  })

  it('carries the quill icon alongside a visible, accessible text label', () => {
    const html = renderToStaticMarkup(<WriteDispatchButton />)
    expect(html).toContain('<svg')
    expect(html).toContain('Write a Dispatch')
  })

  it('is exactly one control — no duplicate/second writing action rendered alongside it', () => {
    const html = renderToStaticMarkup(<WriteDispatchButton />)
    expect((html.match(/href="\/board\/write"/g) ?? []).length).toBe(1)
  })
})
