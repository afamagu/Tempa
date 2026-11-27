import type { ReactNode } from 'react'
import { parseFormattedText } from '@/lib/letter-editor-doc'

/**
 * Renders a paragraph/preview string that may contain this app's own
 * bold/italic markup (**bold**, _italic_ — see lib/letter-editor-doc.ts)
 * as real `<strong>`/`<em>` elements. Never HTML parsing, never
 * `dangerouslySetInnerHTML`: parseFormattedText is a plain tokenizer
 * over a plain string, so this constructs React elements directly —
 * there is no injection surface regardless of what a member types.
 *
 * `isRich` is REQUIRED, not inferred from `text` itself — final
 * compatibility audit (2026-09-05) found that a historical letter (or
 * any letter using no formatting) can coincidentally contain sequences
 * like "**word**" or a stray "_" that would be misread as marks if this
 * component ever guessed. The caller must determine `isRich` ONCE
 * against the letter's whole, untouched body (lib/letters.ts's
 * isRichBody / lib/letter-editor-doc.ts's stripRichBodyMarker) —
 * never per-paragraph, since the marker that makes this determination
 * safe only ever appears at the very start of the whole body, not on
 * every paragraph independently. When `isRich` is false, `text` is
 * rendered completely literally — parseFormattedText is never called
 * at all, so it is structurally impossible for such text to be
 * reinterpreted as formatting regardless of its characters.
 *
 * Web links are opt-in for full readers; preview cards may already
 * be wrapped in a navigation link and must not contain nested anchors.
 *
 * Used everywhere a letter's own words are shown as plain text today:
 * the reader (letter-body.tsx), and both Letterbox preview surfaces
 * (people-grid.tsx, archive-list.tsx) and Home's Arrivals preview.
 */

/** Recognize web addresses without interpreting member text as HTML. */
function linkedText(text: string): ReactNode {
  const parts: ReactNode[] = []
  const addresses = /(^|[\s([{>])((?:https?:\/\/|www\.)[^\s<>"'“”‘’]+)/gi
  let cursor = 0
  for (const match of text.matchAll(addresses)) {
    const start = match.index! + match[1].length
    let label = match[2].replace(/[.,!?:;]+$/, '')
    // Keep balanced parentheses in paths, but leave prose punctuation outside.
    for (const [open, close] of [['(', ')'], ['[', ']'], ['{', '}']]) {
      while (label.endsWith(close) && label.split(close).length > label.split(open).length) {
        label = label.slice(0, -1).replace(/[.,!?:;]+$/, '')
      }
    }
    let url: URL
    try {
      url = new URL(/^www\./i.test(label) ? 'https://' + label : label)
    } catch {
      continue
    }
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) continue
    parts.push(text.slice(cursor, start))
    parts.push(
      <a key={start} href={url.href} target="_blank" rel="noopener noreferrer ugc nofollow"
        className="break-all underline underline-offset-2 hover:opacity-80 focus-visible:outline-2 focus-visible:outline-offset-2">
        {label}
      </a>
    )
    cursor = start + label.length
  }
  if (cursor === 0) return text
  parts.push(text.slice(cursor))
  return parts
}

export default function FormattedText({ text, isRich, linkify = false }: { text: string; isRich: boolean; linkify?: boolean }) {
  if (!isRich) return <>{linkify ? linkedText(text) : text}</>

  const segments = parseFormattedText(text)

  return (
    <>
      {segments.map((segment, i) => {
        const content = linkify ? linkedText(segment.text) : segment.text
        if (segment.bold && segment.italic) {
          return (
            <strong key={i}>
              <em>{content}</em>
            </strong>
          )
        }
        if (segment.bold) return <strong key={i}>{content}</strong>
        if (segment.italic) return <em key={i}>{content}</em>
        // A bare string needs no key — only React elements in an array
        // do — and avoids an unnecessary wrapper element for the
        // common case of an entirely unformatted paragraph.
        return content
      })}
    </>
  )
}
