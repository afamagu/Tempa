import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { TranslatedBody, TranslatedInline, TranslatedTitle } from './translated-prose'
import { proseHeadingClass } from './profile/ui'

const paragraphs = [
  [
    { text: 'Hola ', bold: false, italic: false },
    { text: 'mundo', bold: true, italic: false },
    { text: ' querido', bold: false, italic: true },
  ],
  [{ text: '<script>alert(1)</script> & <strong>no</strong>', bold: false, italic: false }],
]

describe('Translated prose — Tempa’s canonical reading typography', () => {
  it('always renders in Tempa’s own prose, never a member Writing Style', () => {
    const html = renderToStaticMarkup(<TranslatedBody paragraphs={paragraphs} language="es" />)
    expect(html).toContain('data-writing-style="tempa"')
    const source = readFileSync(path.join(__dirname, 'translated-prose.tsx'), 'utf8')
    expect(source).toContain('<AuthoredProse styleId={null}')
    // There is no prop through which an author's style could be passed.
    expect(source).not.toMatch(/writingStyleId|styleId=\{(?!null)/)
  })

  it('keeps bold/italic and one <p> per canonical paragraph', () => {
    const html = renderToStaticMarkup(<TranslatedBody paragraphs={paragraphs} language="es" />)
    expect(html.match(/<p /g)).toHaveLength(2)
    expect(html).toContain('<strong>mundo</strong>')
    expect(html).toContain('<em> querido</em>')
  })

  it('translated text is inert: literal tags render escaped', () => {
    const html = renderToStaticMarkup(<TranslatedBody paragraphs={paragraphs} language="es" />)
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt; &amp; &lt;strong&gt;no&lt;/strong&gt;')
    expect(html).not.toContain('<script>')
  })

  it('sets lang, and dir="rtl" only on the translated surface for RTL languages', () => {
    expect(renderToStaticMarkup(<TranslatedBody paragraphs={paragraphs} language="ar" />)).toMatch(/^<div lang="ar" dir="rtl">/)
    expect(renderToStaticMarkup(<TranslatedBody paragraphs={paragraphs} language="es" />)).toMatch(/^<div lang="es" dir="ltr">/)
    expect(renderToStaticMarkup(<TranslatedTitle text="שלום" language="he" />)).toMatch(/^<h1 lang="he" dir="rtl" class="font-serif/)
    expect(renderToStaticMarkup(<TranslatedInline text="مرحبا" language="fa" />)).toContain('dir="rtl"')
  })

  it('keeps canonical paragraph positions for reading-progress attributes and Moments', () => {
    const html = renderToStaticMarkup(
      <TranslatedBody
        paragraphs={paragraphs}
        language="es"
        paragraphAttrs={(i) => ({ 'data-paragraph-index': i })}
        afterParagraph={(i) => (i === 1 ? <span data-moment="m1" /> : null)}
      />
    )
    expect(html).toMatch(/data-paragraph-index="0"[\s\S]*data-paragraph-index="1"[\s\S]*data-moment="m1"/)
  })

  it('titles use Tempa’s canonical authored heading typography', () => {
    expect(renderToStaticMarkup(<TranslatedTitle text="Una mañana" language="es" />)).toContain(`class="${proseHeadingClass}"`)
  })
})
