import { parseFormattedText, stripRichBodyMarker } from '@/lib/letter-editor-doc'

/**
 * Convert Tempa's restrained stored rich-body encoding to the exact words a
 * member sees before machine translation. Translation output is intentionally
 * plain reading text in v1; the canonical original retains Bold/Italic and the
 * reader always offers View original.
 *
 * Historical/plain bodies (no RICH_BODY_MARKER) are returned byte-for-byte so
 * an old underscore or markdown-looking run is never reinterpreted as markup.
 */
export function bodyTextForTranslation(rawBody: string): string {
  const stripped = stripRichBodyMarker(rawBody)
  if (!stripped.isRich) return stripped.body

  return stripped.body
    .split('\n')
    .map((line) => parseFormattedText(line).map((segment) => segment.text).join(''))
    .join('\n')
}
