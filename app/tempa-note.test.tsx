import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import TempaNote from './tempa-note'

describe('TempaNote — the shared "Tempa is speaking" primitive', () => {
  it('renders the tiny uppercase "Tempa Note" label', () => {
    const html = renderToStaticMarkup(<TempaNote>A short explanation.</TempaNote>)
    expect(html).toContain('Tempa Note')
    expect(html).toMatch(/uppercase/)
  })

  it('uses the restrained clay left rule, not a bordered/filled card', () => {
    const html = renderToStaticMarkup(<TempaNote>A short explanation.</TempaNote>)
    expect(html).toMatch(/border-l-2 border-clay\/50/)
    expect(html).not.toMatch(/rounded-md border(?!-l)/)
  })

  it('renders the given explanatory copy', () => {
    const html = renderToStaticMarkup(<TempaNote>A short explanation of a Tempa feature.</TempaNote>)
    expect(html).toContain('A short explanation of a Tempa feature.')
  })

  it('supports an optional dismiss control with a real accessible name', () => {
    const withDismiss = renderToStaticMarkup(
      <TempaNote onDismiss={() => {}} dismissLabel="Dismiss this note">
        Copy.
      </TempaNote>
    )
    expect(withDismiss).toMatch(/aria-label="Dismiss this note"/)
    expect((withDismiss.match(/<button/g) ?? []).length).toBe(1)
  })

  it('renders no dismiss button at all when onDismiss is omitted', () => {
    const html = renderToStaticMarkup(<TempaNote>Copy.</TempaNote>)
    expect(html).not.toContain('<button')
  })

  it('is never a modal/dialog and never large alert-card chrome', () => {
    const html = renderToStaticMarkup(<TempaNote>Copy.</TempaNote>)
    expect(html).not.toMatch(/role="dialog"/)
    expect(html).not.toContain('fixed inset-0')
    expect(html.toLowerCase()).not.toContain('modal')
  })
})
