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
 * Used everywhere a letter's own words are shown as plain text today:
 * the reader (letter-body.tsx), and both Letterbox preview surfaces
 * (people-grid.tsx, archive-list.tsx) and Home's Arrivals preview.
 */
export default function FormattedText({ text, isRich }: { text: string; isRich: boolean }) {
  if (!isRich) return <>{text}</>

  const segments = parseFormattedText(text)

  return (
    <>
      {segments.map((segment, i) => {
        if (segment.bold && segment.italic) {
          return (
            <strong key={i}>
              <em>{segment.text}</em>
            </strong>
          )
        }
        if (segment.bold) return <strong key={i}>{segment.text}</strong>
        if (segment.italic) return <em key={i}>{segment.text}</em>
        // A bare string needs no key — only React elements in an array
        // do — and avoids an unnecessary wrapper element for the
        // common case of an entirely unformatted paragraph.
        return segment.text
      })}
    </>
  )
}
