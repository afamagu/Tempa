import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import FormattedText from './formatted-text'

describe('FormattedText — isRich=true (a body confirmed to come from the rich encoder)', () => {
  it('renders a bold run as a real <strong> element', () => {
    const html = renderToStaticMarkup(<FormattedText text="**Hello**" isRich />)
    expect(html).toBe('<strong>Hello</strong>')
  })

  it('renders an italic run as a real <em> element', () => {
    const html = renderToStaticMarkup(<FormattedText text="_Hello_" isRich />)
    expect(html).toBe('<em>Hello</em>')
  })

  it('renders a bold+italic run as nested <strong><em>', () => {
    const html = renderToStaticMarkup(<FormattedText text="**_Hello_**" isRich />)
    expect(html).toBe('<strong><em>Hello</em></strong>')
  })

  it('renders plain text with no wrapping mark elements', () => {
    const html = renderToStaticMarkup(<FormattedText text="Just words." isRich />)
    expect(html).not.toContain('<strong>')
    expect(html).not.toContain('<em>')
    expect(html).toContain('Just words.')
  })

  it('renders mixed plain/bold/italic runs in order', () => {
    const html = renderToStaticMarkup(<FormattedText text="Plain **bold** and _italic_." isRich />)
    expect(html).toContain('Plain ')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain(' and ')
    expect(html).toContain('<em>italic</em>')
  })

  it('never renders raw markup delimiters literally when marks are present', () => {
    const html = renderToStaticMarkup(<FormattedText text="**bold** and _italic_" isRich />)
    expect(html).not.toContain('**')
    expect(html).not.toMatch(/(?<!\w)_(?!\w)/)
  })

  it('a literal escaped asterisk renders as a plain character, never as bold', () => {
    // JSX plain-quoted attributes are raw text (no JS escape
    // processing) — an expression container is required here so the
    // JS string literal's "\\*" actually produces a single backslash
    // followed by an asterisk, matching docToPlainBody's own escaping.
    const html = renderToStaticMarkup(<FormattedText text={'2 \\* 2 = 4'} isRich />)
    expect(html).toContain('2 * 2 = 4')
    expect(html).not.toContain('<strong>')
  })

  it('never uses dangerouslySetInnerHTML-style raw HTML injection — output is built from real elements only', () => {
    // A hostile-looking body is treated as plain text content, never
    // parsed as markup beyond this app's own **/_ tokens.
    const html = renderToStaticMarkup(<FormattedText text="<img src=x onerror=alert(1)>" isRich />)
    expect(html).toContain('&lt;img')
    expect(html).not.toContain('<img src=x')
  })

  it('renders nothing for an empty string', () => {
    const html = renderToStaticMarkup(<FormattedText text="" isRich />)
    expect(html).toBe('')
  })
})

// Final compatibility audit (2026-09-05) — a historical letter (or any
// letter using no formatting at all) must render 100% literally,
// however coincidentally markup-like its actual characters are. This
// is the core guarantee isRich exists to provide: when false,
// parseFormattedText is never even called.
describe('FormattedText — isRich=false (historical or plain-unformatted body)', () => {
  it('a coincidental "**word**" pair renders literally, never as bold', () => {
    const html = renderToStaticMarkup(<FormattedText text="**not originally bold**" isRich={false} />)
    expect(html).toBe('**not originally bold**')
    expect(html).not.toContain('<strong>')
  })

  it('a single stray underscore renders literally and does not italicize the rest of the text', () => {
    const html = renderToStaticMarkup(<FormattedText text="my_username" isRich={false} />)
    expect(html).toBe('my_username')
    expect(html).not.toContain('<em>')
  })

  it('a snake_case-style word with two underscores renders literally, not with the middle italicized', () => {
    const html = renderToStaticMarkup(<FormattedText text="one_two_three" isRich={false} />)
    expect(html).toBe('one_two_three')
    expect(html).not.toContain('<em>')
  })

  it('single asterisks used as ordinary emphasis punctuation render literally', () => {
    const html = renderToStaticMarkup(<FormattedText text="I *really* mean it" isRich={false} />)
    expect(html).toBe('I *really* mean it')
    expect(html).not.toContain('<em>')
    expect(html).not.toContain('<strong>')
  })

  it('a literal backslash renders literally, with no escape-decoding applied', () => {
    // Expression container required — JSX plain-quoted attributes are
    // raw text with no JS escape processing (same gotcha as the
    // isRich=true escaped-asterisk test above).
    const html = renderToStaticMarkup(<FormattedText text={'C:\\Users\\name'} isRich={false} />)
    expect(html).toBe('C:\\Users\\name')
  })
})
