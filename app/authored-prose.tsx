import type { CSSProperties, ReactNode } from 'react'
import {
  normalizeWritingStyleId,
  proseTypographyVars,
  resolveProseTypography,
  type ReadingMode,
} from '@/lib/writing-style'

/**
 * The ONE place a member's Writing Style reaches the page. Wrap only a
 * person's own authored prose in this — never labels, metadata, buttons
 * or notices, which stay in Tempa's interface type.
 *
 * `styleId` may be anything read from storage: an unknown/null value
 * renders in Tempa's canonical prose (lib/writing-style.ts). Reader view
 * swaps ONLY the typography; the children are the same nodes either way.
 *
 * No hooks, so it serves Server and Client Components alike.
 */
export default function AuthoredProse({
  styleId,
  mode = 'original',
  opening = false,
  measure = false,
  size = 'reading',
  className = '',
  children,
}: {
  styleId: unknown
  mode?: ReadingMode
  /** Enable the style's opening treatment on the child marked `wp-opening`. */
  opening?: boolean
  /** Constrain to the style's own comfortable measure. */
  measure?: boolean
  size?: 'reading' | 'compact'
  className?: string
  children: ReactNode
}) {
  const id = normalizeWritingStyleId(styleId)
  const typography = resolveProseTypography(id, mode)
  const effective = mode === 'reader' ? null : id

  return (
    <div
      className={`authored-prose ${className}`.trim()}
      data-writing-style={effective ?? 'tempa'}
      data-opening={opening ? typography.opening.kind : 'none'}
      data-measure={measure ? '' : undefined}
      data-size={size === 'compact' ? 'compact' : undefined}
      style={proseTypographyVars(typography) as CSSProperties}
    >
      {children}
    </div>
  )
}
