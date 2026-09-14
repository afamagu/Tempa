import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ClosureStatusNotice from './closure-status-notice'

// Release Polish Pass — the closure status now reads as quiet
// correspondence metadata (a narrow accent rule + envelope glyph),
// never a bright/alarming warning treatment and never another
// content card indistinguishable from the letter itself.
describe('ClosureStatusNotice', () => {
  it('shows the given title and detail', () => {
    const html = renderToStaticMarkup(
      <ClosureStatusNotice title="This letter went unanswered" detail="Melons wasn't able to reply within the reply window." />
    )
    expect(html).toContain('This letter went unanswered')
    expect(html).toContain('Melons')
    expect(html).toContain('reply within the reply window.')
  })

  it('uses the restrained clay accent, never a bright warning/error color', () => {
    const html = renderToStaticMarkup(<ClosureStatusNotice title="Title" detail="Detail" />)
    expect(html).toMatch(/border-clay/)
    expect(html).not.toMatch(/text-red|bg-red|border-red|amber|yellow/)
  })

  it('renders a small static envelope glyph, not the in-transit (motion) icon', () => {
    const html = renderToStaticMarkup(<ClosureStatusNotice title="Title" detail="Detail" />)
    expect(html).toContain('<svg')
  })

  it('is a narrow accent-rule treatment, not a filled/bordered card', () => {
    const html = renderToStaticMarkup(<ClosureStatusNotice title="Title" detail="Detail" />)
    expect(html).not.toMatch(/rounded-md border(?!-l)/)
  })
})
