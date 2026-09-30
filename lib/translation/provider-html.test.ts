import { describe, it, expect } from 'vitest'
import { RICH_BODY_MARKER, docToPlainBody, type LetterDocJSON } from '@/lib/letter-editor-doc'
import { splitParagraphs } from '@/lib/moments'
import {
  bodyToProviderParagraphs,
  escapeHtmlText,
  providerHtmlToSegments,
  providerHtmlToText,
  textToProviderHtml,
} from './provider-html'

const plain = (text: string) => ({ text, bold: false, italic: false })

describe('outbound: Tempa generates the provider HTML from its own parse', () => {
  it('a plain (historical) body: one element per paragraph, words intact, underscores literal', () => {
    const body = 'First line of snake_case talk.\nSame paragraph.\n\nSecond **paragraph** here.'
    expect(bodyToProviderParagraphs(body)).toEqual([
      'First line of snake_case talk.<br>Same paragraph.',
      'Second **paragraph** here.',
    ])
  })

  it('bold, italic, bold+italic and paragraph structure survive (rich body)', () => {
    const doc: LetterDocJSON = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Plain ' },
            { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
            { type: 'text', text: ' and ' },
            { type: 'text', text: 'italic', marks: [{ type: 'italic' }] },
          ],
        },
        { type: 'paragraph', content: [{ type: 'text', text: 'both', marks: [{ type: 'bold' }, { type: 'italic' }] }] },
      ],
    }
    const body = docToPlainBody(doc)
    expect(body.startsWith(RICH_BODY_MARKER)).toBe(true)
    expect(bodyToProviderParagraphs(body)).toEqual([
      'Plain <strong>bold</strong> and <em>italic</em>',
      '<strong><em>both</em></strong>',
    ])
  })

  it('literal HTML typed by a member is escaped — never becomes markup', () => {
    const body = '<script>alert(1)</script> and <strong>not bold</strong> & more'
    const [unit] = bodyToProviderParagraphs(body)
    expect(unit).toBe('&lt;script&gt;alert(1)&lt;/script&gt; and &lt;strong&gt;not bold&lt;/strong&gt; &amp; more')
    expect(textToProviderHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;')
    // Round trip: the literal text comes back as text, with no bold.
    expect(providerHtmlToSegments(unit!)).toEqual([plain(body)])
  })

  it('keeps canonical paragraph indexes, sending nothing for an empty paragraph', () => {
    for (const body of ['One\n\n   \n\nThree', 'Solo', '', '  \n\n  ', 'A\n\nB\n\nC']) {
      const units = bodyToProviderParagraphs(body)
      const paragraphs = splitParagraphs(body)
      expect(units, JSON.stringify(body)).toHaveLength(paragraphs.length)
      paragraphs.forEach((paragraph, i) => expect(units[i] === null).toBe(!paragraph.trim()))
    }
    expect(bodyToProviderParagraphs('')).toEqual([null])
  })

  it('escapes exactly &, < and >', () => {
    expect(escapeHtmlText(`a & b < c > d "e" 'f'`)).toBe(`a &amp; b &lt; c &gt; d "e" 'f'`)
  })
})

describe('inbound: provider HTML is untrusted and sanitized with parse5', () => {
  it('only strong/em/br carry meaning; every attribute is ignored', () => {
    expect(
      providerHtmlToSegments('<strong onclick="steal()">Hola</strong> <em style="x">mundo</em><br>adiós')
    ).toEqual([
      { text: 'Hola', bold: true, italic: false },
      plain(' '),
      { text: 'mundo', bold: false, italic: true },
      plain('\nadiós'),
    ])
  })

  it('script/style/iframe/svg are dropped with their contents; other tags unwrap to text', () => {
    const html =
      '<p>Uno<script>alert(1)</script><style>*{}</style><iframe src="javascript:x">y</iframe>' +
      '<svg onload="x"><text>z</text></svg> <a href="javascript:alert(1)">dos</a> <img src=x onerror=alert(1)><b>tres</b></p>'
    expect(providerHtmlToSegments(html)).toEqual([plain('Uno dos tres')])
  })

  it('entities decode to text; comments vanish', () => {
    expect(providerHtmlToText('Tom &amp; Jerry &lt;3 <!-- hidden -->')).toBe('Tom & Jerry <3')
  })

  it('unbalanced/malformed markup still yields text only', () => {
    expect(providerHtmlToSegments('<strong>abierto <em>anidado')).toEqual([
      { text: 'abierto ', bold: true, italic: false },
      { text: 'anidado', bold: true, italic: true },
    ])
  })

  it('segments are plain data: nothing but text/bold/italic keys', () => {
    for (const segment of providerHtmlToSegments('<strong x=1>a</strong><em>b</em>c')) {
      expect(Object.keys(segment).sort()).toEqual(['bold', 'italic', 'text'])
    }
  })
})
