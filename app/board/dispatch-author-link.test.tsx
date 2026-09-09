import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DispatchAuthorLink from './dispatch-author-link'

describe('DispatchAuthorLink — the shared identity link every Dispatch card reuses', () => {
  it('links to the profile route for this exact author', () => {
    const html = renderToStaticMarkup(
      <DispatchAuthorLink authorId="author-1" authorPseudonym="Evening Quill" authorCountry={null} />
    )
    expect(html).toMatch(/<a[^>]*href="\/minds\/author-1"/)
  })

  it('renders the pseudonym as visible text inside the link', () => {
    const html = renderToStaticMarkup(
      <DispatchAuthorLink authorId="author-1" authorPseudonym="Evening Quill" authorCountry={null} />
    )
    expect(html).toContain('Evening Quill')
  })

  it('renders a country flag inside the link when a country is recorded', () => {
    const html = renderToStaticMarkup(
      <DispatchAuthorLink authorId="author-1" authorPseudonym="Evening Quill" authorCountry="France" />
    )
    expect(html).toContain('src="/flags/FR.svg"')
  })
})
