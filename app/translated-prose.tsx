import type { ReactNode } from 'react'
import AuthoredProse from '@/app/authored-prose'
import { proseHeadingClass } from '@/app/profile/ui'
import { languageDirection } from '@/lib/reading-languages'
import type { TranslatedParagraph } from '@/lib/translation/translated-content'

/**
 * Translated reading — a reader accommodation, not the author's identity.
 *
 * - Always Tempa's CANONICAL reading typography: AuthoredProse is given
 *   styleId={null}, deliberately with no way to pass an author's Writing
 *   Style through. The original keeps whatever presentation it has.
 * - `lang` and `dir` are set on this surface only, so an Arabic or Hebrew
 *   translation reads right-to-left without flipping Tempa's interface.
 * - Content is sanitized data (lib/translation/provider-html.ts) rendered
 *   as React text nodes plus <strong>/<em>; never HTML strings.
 * - Paragraph i here is paragraph i of the original, so callers place
 *   Moments and reading-position attributes by the same canonical index.
 *
 * No hooks: usable from Server and Client Components.
 */

function Segments({ paragraph }: { paragraph: TranslatedParagraph }) {
  return (
    <>
      {paragraph.map((segment, i) => {
        if (segment.bold && segment.italic) {
          return (
            <strong key={i}>
              <em>{segment.text}</em>
            </strong>
          )
        }
        if (segment.bold) return <strong key={i}>{segment.text}</strong>
        if (segment.italic) return <em key={i}>{segment.text}</em>
        return <span key={i}>{segment.text}</span>
      })}
    </>
  )
}

export function TranslatedBody({
  paragraphs,
  language,
  paragraphAttrs,
  afterParagraph,
  className = '',
}: {
  paragraphs: TranslatedParagraph[]
  /** The target (reading) language code. */
  language: string
  paragraphAttrs?: (index: number) => Record<string, string | number>
  /** Interface content that belongs at a canonical paragraph, e.g. a Moment. */
  afterParagraph?: (index: number) => ReactNode
  className?: string
}) {
  return (
    <div lang={language} dir={languageDirection(language)}>
      <AuthoredProse styleId={null} measure className={className}>
        {paragraphs.map((paragraph, index) => (
          <p key={index} className="wp-block whitespace-pre-wrap" {...(paragraphAttrs?.(index) ?? {})}>
            <Segments paragraph={paragraph} />
            {afterParagraph?.(index)}
          </p>
        ))}
      </AuthoredProse>
    </div>
  )
}

export function TranslatedTitle({
  text,
  language,
  as: Tag = 'h1',
  className = proseHeadingClass,
}: {
  text: string
  language: string
  as?: 'h1' | 'h2' | 'p'
  className?: string
}) {
  return (
    <Tag lang={language} dir={languageDirection(language)} className={className}>
      {text}
    </Tag>
  )
}

/** A short translated line inside another object (e.g. a Postcard's Reveal
 * Line or back message) — keeps the host's own classes, adds lang/dir. */
export function TranslatedInline({ text, language, className }: { text: string; language: string; className?: string }) {
  return (
    <span lang={language} dir={languageDirection(language)} className={className}>
      {text}
    </span>
  )
}
