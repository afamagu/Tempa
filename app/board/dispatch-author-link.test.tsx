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

  it('renders the country name instead of a flag asset when a country is recorded', () => {
    const html = renderToStaticMarkup(
      <DispatchAuthorLink authorId="author-1" authorPseudonym="Evening Quill" authorCountry="France" />
    )
    expect(html).toContain('France')
    expect(html).toContain('aria-label="Country: France"')
    expect(html).not.toContain('/flags/')
  })

  it('renders a saved Mark without an avatar crop and otherwise keeps the Mindform fallback', () => {
    const markHtml = renderToStaticMarkup(
      <DispatchAuthorLink
        authorId="author-1"
        authorPseudonym="Evening Quill"
        authorCountry={null}
        authorMarkUrl="https://example.test/mark.png"
      />
    )
    expect(markHtml).toContain('src="https://example.test/mark.png"')
    expect(markHtml).toContain('object-contain')
    expect(markHtml).not.toContain('object-cover')

    const legacyHtml = renderToStaticMarkup(
      <DispatchAuthorLink authorId="author-1" authorPseudonym="Evening Quill" authorCountry={null} />
    )
    expect(legacyHtml).toContain('rounded-full')
  })
})
