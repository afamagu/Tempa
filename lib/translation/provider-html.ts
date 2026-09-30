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
 * splitParagraphs → parseFormattedText) into segments, and Tempa GENERATES
 * a minimal provider string from those segments: escaped text plus only
 * <strong>, <em> and <br>. Each canonical paragraph is one provider unit —
 * or, only when a single paragraph is itself larger than one Azure request
 * allows, several independently valid units split at the SEGMENT/TEXT layer
 * (never by slicing generated HTML) and reassembled into that one paragraph
 * afterwards. Either way, translated paragraph i is original paragraph i,
 * so Moments and reading position keep canonical indexes.
 *
 * INBOUND: provider output is untrusted. It is parsed with parse5 (a
 * maintained WHATWG-conformant HTML parser — never regex) and walked into
 * plain {text, bold, italic} segments. Only <strong>/<em>/<br> carry
 * meaning; no attribute is ever read; script/style-like elements are
 * dropped with their contents; every other element is unwrapped to its
 * text. The result is data, rendered by React as text nodes.
 */

/** Azure Translator v3 accepts at most this many characters per request,
 * so no single provider unit may exceed it. */
export const MAX_PROVIDER_UNIT_CHARACTERS = 50_000

/** Unicode code points — how Tempa counts provider characters everywhere. */
export function providerCharacterCount(text: string): number {
  return Array.from(text).length
}

/** Escapes text for an HTML text context. Not a sanitizer: it only ever
 * runs on member TEXT before Tempa wraps it in its own tags. */
export function escapeHtmlText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapedTextHtml(text: string): string {
  return escapeHtmlText(text).replace(/\r?\n/g, '<br>')
}

function segmentHtml(segment: TranslatedSegment): string {
  let html = escapedTextHtml(segment.text)
  if (segment.italic) html = `<em>${html}</em>`
  if (segment.bold) html = `<strong>${html}</strong>`
  return html
}

/** Tempa's generated HTML for a run of segments. */
export function segmentsToProviderHtml(segments: readonly TranslatedSegment[]): string {
  return segments.map(segmentHtml).join('')
}

/** One plain field (title, Reveal Line, Postcard back message) as segments.
 * Never interpreted as markup: an asterisk or underscore is a character. */
export function textToProviderSegments(text: string): TranslatedSegment[] | null {
  const trimmed = text.trim()
  return trimmed ? [{ text: trimmed, bold: false, italic: false }] : null
}

export function textToProviderHtml(text: string): string | null {
  const segments = textToProviderSegments(text)
  return segments ? segmentsToProviderHtml(segments) : null
}

/**
 * A stored Letter/Dispatch body → segments per canonical paragraph (null for
 * an empty paragraph, which is never sent). The rich-body marker is checked
 * ONCE on the whole raw body, exactly as the readers do; a historical/plain
 * body is taken literally so an old underscore can never become formatting.
 */
export function bodyToProviderSegments(rawBody: string): (TranslatedSegment[] | null)[] {
  const { isRich, body } = stripRichBodyMarker(rawBody)
  return splitParagraphs(body).map((paragraph) => {
    if (!paragraph.trim()) return null
    const segments = isRich ? parseFormattedText(paragraph) : [{ text: paragraph, bold: false, italic: false }]
    return segments.length > 0 ? segments : null
  })
}

/** The canonical (unchunked) provider HTML per paragraph — the source
 * identity that cache fingerprints are computed from. */
export function bodyToProviderParagraphs(rawBody: string): (string | null)[] {
  return bodyToProviderSegments(rawBody).map((segments) => (segments ? segmentsToProviderHtml(segments) : null))
}

// ------------------------------------------------------------
// Transport chunking for a single oversized paragraph
// ------------------------------------------------------------

export type ProviderChunk = {
  /** Independently valid Tempa-generated HTML, ≤ the unit limit. */
  html: string
  /** The source text at the end of this chunk was whitespace (so the
   * reassembled translation keeps a word gap there). */
  endsWithWhitespace: boolean
}

function tagOverhead(bold: boolean, italic: boolean) {
  return (bold ? '<strong></strong>'.length : 0) + (italic ? '<em></em>'.length : 0)
}

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
const words = new Intl.Segmenter(undefined, { granularity: 'word' })
const sentences = new Intl.Segmenter(undefined, { granularity: 'sentence' })

/**
 * Split text into pieces whose escaped HTML cost is ≤ `budget`, preferring
 * the most natural boundary available: whole sentences, then words, then
 * grapheme clusters (never a surrogate half or a detached combining mark).
 */
function textAtoms(text: string, budget: number): string[] {
  const cost = (piece: string) => providerCharacterCount(escapedTextHtml(piece))
  if (cost(text) <= budget) return [text]

  const out: string[] = []
  for (const segmenter of [sentences, words, graphemes]) {
    const parts = Array.from(segmenter.segment(text), (s) => s.segment)
    if (parts.length > 1 || segmenter === graphemes) {
      for (const part of parts) {
        if (cost(part) <= budget) out.push(part)
        else if (segmenter === graphemes) out.push(part) // one grapheme can't be split further
        else out.push(...textAtoms(part, budget))
      }
      return out
    }
  }
  return [text]
}

/**
 * One canonical paragraph → one or more provider chunks. A paragraph whose
 * HTML fits in one request stays exactly one chunk (identical to
 * segmentsToProviderHtml), so ordinary writing is never fragmented. Only an
 * oversized paragraph is packed greedily into the fewest chunks, each
 * re-wrapping the bold/italic state of the text it carries.
 */
export function chunkParagraphSegments(
  segments: readonly TranslatedSegment[],
  limit: number = MAX_PROVIDER_UNIT_CHARACTERS
): ProviderChunk[] {
  const whole = segmentsToProviderHtml(segments)
  const lastText = segments[segments.length - 1]?.text ?? ''
  if (providerCharacterCount(whole) <= limit) {
    return [{ html: whole, endsWithWhitespace: /\s$/u.test(lastText) }]
  }

  const chunks: TranslatedSegment[][] = []
  let current: TranslatedSegment[] = []
  let currentCost = 0

  const flush = () => {
    if (current.length > 0) chunks.push(current)
    current = []
    currentCost = 0
  }

  for (const segment of segments) {
    const overhead = tagOverhead(segment.bold, segment.italic)
    for (const atom of textAtoms(segment.text, limit - overhead)) {
      const atomCost = providerCharacterCount(escapedTextHtml(atom))
      const last = current[current.length - 1]
      const extends_ = last !== undefined && last.bold === segment.bold && last.italic === segment.italic
      let delta = atomCost + (extends_ ? 0 : overhead)
      if (currentCost + delta > limit) {
        flush()
        delta = atomCost + overhead
      }
      const tail = current[current.length - 1]
      if (tail && tail.bold === segment.bold && tail.italic === segment.italic) tail.text += atom
      else current.push({ text: atom, bold: segment.bold, italic: segment.italic })
      currentCost += delta
    }
  }
  flush()

  return chunks.map((chunk) => {
    const html = segmentsToProviderHtml(chunk)
    if (providerCharacterCount(html) > limit) throw new Error('Translation chunking exceeded the provider unit limit.')
    return { html, endsWithWhitespace: /\s$/u.test(chunk[chunk.length - 1].text) }
  })
}

// ------------------------------------------------------------
// Inbound: untrusted provider HTML → sanitized segments
// ------------------------------------------------------------

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

function pushSegment(segments: TranslatedSegment[], text: string, bold: boolean, italic: boolean) {
  if (!text) return
  const last = segments[segments.length - 1]
  if (last && last.bold === bold && last.italic === italic) last.text += text
  else segments.push({ text, bold, italic })
}

/** Untrusted provider HTML → sanitized segments (adjacent same-style runs
 * merged). <br> becomes '\n', rendered by whitespace-pre-wrap exactly as an
 * original hard break is. */
export function providerHtmlToSegments(html: string): TranslatedParagraph {
  const fragment = parseFragment(html) as unknown as Parse5Node
  const segments: TranslatedSegment[] = []

  function walk(node: Parse5Node, bold: boolean, italic: boolean) {
    if (node.nodeName === '#text') {
      pushSegment(segments, node.value ?? '', bold, italic)
      return
    }
    if (node.nodeName === '#comment' || node.nodeName === '#documentType') return

    const tag = node.tagName?.toLowerCase()
    if (tag) {
      if (DROP_WITH_CONTENT.has(tag)) return
      if (tag === 'br') {
        pushSegment(segments, '\n', bold, italic)
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

/**
 * Reassemble the translations of one paragraph's chunks (in order) into a
 * single sanitized paragraph. Where the SOURCE had whitespace at a chunk
 * boundary and the translation lost it, one space is restored; scripts that
 * don't separate words with spaces (no whitespace in the source) get none.
 */
export function reassembleTranslatedChunks(
  chunks: readonly ProviderChunk[],
  translatedHtml: readonly string[]
): TranslatedParagraph {
  const segments: TranslatedSegment[] = []
  translatedHtml.forEach((html, index) => {
    const part = providerHtmlToSegments(html)
    const previous = segments[segments.length - 1]
    const first = part[0]
    if (
      index > 0 &&
      chunks[index - 1]?.endsWithWhitespace &&
      previous &&
      first &&
      !/\s$/u.test(previous.text) &&
      !/^\s/u.test(first.text)
    ) {
      pushSegment(segments, ' ', previous.bold, previous.italic)
    }
    for (const segment of part) pushSegment(segments, segment.text, segment.bold, segment.italic)
  })
  return segments
}

/** Untrusted provider HTML for a plain field → plain text. */
export function providerHtmlToText(html: string): string {
  return providerHtmlToSegments(html)
    .map((segment) => segment.text)
    .join('')
    .trim()
}
