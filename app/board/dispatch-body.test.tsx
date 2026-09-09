import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import DispatchBody from './dispatch-body'
import { docToPlainBody } from '@/lib/letter-editor-doc'

describe('DispatchBody', () => {
  it('renders a plain (non-rich) body literally, even if it coincidentally looks like markup', () => {
    const html = renderToStaticMarkup(
      <DispatchBody body={'I *really* mean it, and my_username is unrelated.'} moments={[]} />
    )
    expect(html).toContain('I *really* mean it')
    expect(html).not.toContain('<strong>')
    expect(html).not.toContain('<em>')
  })

  it('renders a genuinely rich body\'s Bold/Italic marks as real elements', () => {
    const rich = docToPlainBody({
      type: 'doc',
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: 'bold text', marks: [{ type: 'bold' }] }] },
      ],
    })
    const html = renderToStaticMarkup(<DispatchBody body={rich} moments={[]} />)
    expect(html).toContain('<strong>bold text</strong>')
  })

  it('renders multiple paragraphs from a blank-line-separated body', () => {
    const html = renderToStaticMarkup(
      <DispatchBody body={'First paragraph.\n\nSecond paragraph.'} moments={[]} />
    )
    expect(html).toContain('First paragraph.')
    expect(html).toContain('Second paragraph.')
  })

  it('places a Moment\'s photo token at its own paragraph, not another one', () => {
    const html = renderToStaticMarkup(
      <DispatchBody
        body={'First paragraph.\n\nSecond paragraph.'}
        moments={[{ id: 'm-1', position: 1, imageUrl: 'https://example.com/a.jpg' }]}
      />
    )
    // The photo token renders inside the second paragraph's own <p>,
    // not the first — a crude but effective ordering check given this
    // component has no test ids.
    const secondParagraphIndex = html.indexOf('Second paragraph.')
    const imgIndex = html.indexOf('<img')
    expect(imgIndex).toBeGreaterThan(secondParagraphIndex)
  })

  it('never renders a Postcard — Postcards remain private-correspondence-only', () => {
    const html = renderToStaticMarkup(<DispatchBody body={'A Dispatch.'} moments={[]} />)
    expect(html.toLowerCase()).not.toContain('postcard')
  })
})
