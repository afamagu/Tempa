import 'server-only'
import { parseFragment } from 'parse5'
import { parseFormattedText, stripRichBodyMarker } from '@/lib/letter-editor-doc'
import { splitParagraphs } from '@/lib/moments'
import type { TranslatedParagraph, TranslatedSegment } from '@/lib/translation/translated-content'

/**
 * Tempa's structured translation representation.
 *
 * OUTBOUND: member text is never sent as member HTML. The stored body is
 * parsed with the same utilities the readers use (stripRichBodyMarker →
 * splitParagraphs → parseFormattedText), and Tempa GENERATES a minimal
 * provider string from that parse: escaped text plus only <strong>, <em>
 * and <br>. One provider element per non-empty paragraph, so translated
 * paragraphs stay aligned with canonical paragraph indexes (Moments and
 * reading position keep working).
 *
 * INBOUND: provider output is untrusted. It is parsed with parse5 (a
 * maintained WHATWG-conformant HTML parser — never regex) and walked into
 * plain {text, bold, italic} segments. Only <strong>/<em>/<br> carry
 * meaning; no attribute is ever read; script/style-like elements are
 * dropped with their contents; every other element is unwrapped to its
 * text. The result is data, rendered by React as text nodes.
 */

/** Escapes text for an HTML text context. Not a sanitizer: it only ever
 * runs on member TEXT before Tempa wraps it in its own tags. */
export function escapeHtmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function segmentHtml(segment: TranslatedSegment): string {
  let html = escapeHtmlText(segment.text).replace(/\r?\n/g, '<br>')
  if (segment.italic) html = `<em>${html}</em>`
  if (segment.bold) html = `<strong>${html}</strong>`
  return html
}

/** One plain field (title, Reveal Line, Postcard back message). Never
 * interpreted as markup: an asterisk or underscore is just a character. */
export function textToProviderHtml(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  return segmentHtml({ text: trimmed, bold: false, italic: false })
}

/**
 * A stored Letter/Dispatch body → one provider string per canonical
 * paragraph (null for an empty paragraph, which is never sent). The
 * rich-body marker is checked ONCE on the whole raw body, exactly as the
 * readers do; a historical/plain body is taken literally so an old
 * underscore can never become formatting.
 */
export function bodyToProviderParagraphs(rawBody: string): (string | null)[] {
  const { isRich, body } = stripRichBodyMarker(rawBody)
  return splitParagraphs(body).map((paragraph) => {
    if (!paragraph.trim()) return null
    const segments = isRich ? parseFormattedText(paragraph) : [{ text: paragraph, bold: false, italic: false }]
    const html = segments.map(segmentHtml).join('')
    return html.length > 0 ? html : null
  })
}

// Elements whose CONTENT must never surface as reading text.
const DROP_WITH_CONTENT = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'textarea',
  'title',
  'xmp',
  'noembed',
  'noframes',
  'head',
  'select',
  'option',
])

type Parse5Node = {
  nodeName: string
  tagName?: string
  value?: string
  childNodes?: Parse5Node[]
}

/** Untrusted provider HTML → sanitized segments (adjacent same-style runs
 * merged). <br> becomes '\n', rendered by whitespace-pre-wrap exactly as an
 * original hard break is. */
export function providerHtmlToSegments(html: string): TranslatedParagraph {
  const fragment = parseFragment(html) as unknown as Parse5Node
  const segments: TranslatedSegment[] = []

  function push(text: string, bold: boolean, italic: boolean) {
    if (!text) return
    const last = segments[segments.length - 1]
    if (last && last.bold === bold && last.italic === italic) last.text += text
    else segments.push({ text, bold, italic })
  }

  function walk(node: Parse5Node, bold: boolean, italic: boolean) {
    if (node.nodeName === '#text') {
      push(node.value ?? '', bold, italic)
      return
    }
    if (node.nodeName === '#comment' || node.nodeName === '#documentType') return

    const tag = node.tagName?.toLowerCase()
    if (tag) {
      if (DROP_WITH_CONTENT.has(tag)) return
      if (tag === 'br') {
        push('\n', bold, italic)
        return
      }
    }
    const nextBold = bold || tag === 'strong'
    const nextItalic = italic || tag === 'em'
    for (const child of node.childNodes ?? []) walk(child, nextBold, nextItalic)
  }

  walk(fragment, false, false)
  return segments
}

/** Untrusted provider HTML for a plain field → plain text. */
export function providerHtmlToText(html: string): string {
  return providerHtmlToSegments(html)
    .map((segment) => segment.text)
    .join('')
    .trim()
}
