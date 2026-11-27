// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import FormattedText from './formatted-text'
import LetterBody from './[letterId]/letter-body'
import DispatchBody from '@/app/board/dispatch-body'
import { docToPlainBody } from '@/lib/letter-editor-doc'

function documentFor(html: string) { const doc = document.implementation.createHTMLDocument(); doc.body.innerHTML = html; return doc }

describe('clickable web links', () => {
  it.each([LetterBody, DispatchBody])('enables links in the full reader', (Reader) => {
    const doc = documentFor(renderToStaticMarkup(<Reader body="See https://example.com/path?q=one&next=two and www.example.org." moments={[]} />))
    const links = [...doc.querySelectorAll('a')]
    expect(links.map(a => a.href)).toEqual(['https://example.com/path?q=one&next=two', 'https://www.example.org/'])
    expect(links[1].textContent).toBe('www.example.org')
    expect(links.every(a => a.target === '_blank' && a.rel.includes('noopener') && a.rel.includes('noreferrer'))).toBe(true)
  })

  it('keeps preview surfaces free of nested links', () => {
    const doc = documentFor(renderToStaticMarkup(<FormattedText text="https://example.com" isRich={false} />))
    expect(doc.querySelector('a')).toBeNull()
  })

  it('preserves punctuation, balanced parentheses, line breaks, and literal markup', () => {
    const text = '**literal** (https://example.com/a_(b)).\nwww.example.org!'
    const doc = documentFor(renderToStaticMarkup(<FormattedText text={text} isRich={false} linkify />))
    expect(doc.body.textContent).toBe(text)
    expect(doc.querySelector('a')?.getAttribute('href')).toBe('https://example.com/a_(b)')
    expect(doc.querySelector('strong')).toBeNull()
  })

  it('preserves rich formatting and escaped underscores in addresses', () => {
    const body = docToPlainBody({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'https://example.com/a_b', marks: [{ type: 'bold' }] }] }] })
    const doc = documentFor(renderToStaticMarkup(<LetterBody body={body} moments={[]} />))
    expect(doc.querySelector('strong a')?.getAttribute('href')).toBe('https://example.com/a_b')
  })

  it('does not turn unsafe schemes, credentials, malformed addresses or HTML into links', () => {
    const text = 'javascript:alert(1) data:text/html,test https:// http:// https://user:pass@example.com <img src=x onerror=alert(1)>'
    const doc = documentFor(renderToStaticMarkup(<FormattedText text={text} isRich={false} linkify />))
    expect(doc.querySelector('a, img')).toBeNull()
    expect(doc.body.textContent).toBe(text)
  })
})
