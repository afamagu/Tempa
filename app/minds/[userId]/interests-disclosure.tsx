'use client'

import { useState } from 'react'

const INITIAL_VISIBLE_COUNT = 6

/** Pure: which items are visible for a given expanded state — split out
 * so the collapsed/expanded slicing logic is directly testable without
 * simulating a click (this codebase's tests render static markup only,
 * no interaction simulation). */
export function visibleInterests(
  items: string[],
  expanded: boolean,
  initialCount: number = INITIAL_VISIBLE_COUNT
): string[] {
  return expanded ? items : items.slice(0, initialCount)
}

/**
 * Compact + expandable presentation of a member's selected interests
 * (today's `intent` field — "What brings you here?" — the current
 * stand-in for what will eventually become a richer conversation-
 * territory system; see docs/tempa-build-guide.md). Shows a restrained
 * initial subset rather than the full list at once, with a quiet
 * "Show all" disclosure and a matching "Show less" to collapse again.
 * Works by tap — no hover dependency. The heading/categorization is
 * owned by the caller (app/minds/[userId]/page.tsx) precisely so it
 * can change independently of this component when that future system
 * lands.
 */
export default function InterestsDisclosure({ items }: { items: string[] }) {
  const [expanded, setExpanded] = useState(false)

  if (items.length === 0) return null

  const hiddenCount = items.length - INITIAL_VISIBLE_COUNT
  const visible = visibleInterests(items, expanded)

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1.5">
      {visible.map((label) => (
        <span
          key={label}
          className="rounded-full border border-foreground/15 px-2.5 py-0.5 text-[12px] text-foreground/70"
        >
          {label}
        </span>
      ))}
      {hiddenCount > 0 && (
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          className="text-[12px] text-foreground/60 underline decoration-foreground/25 underline-offset-2 transition-colors hover:text-foreground"
        >
          {expanded ? 'Show less' : `Show all (+${hiddenCount})`}
        </button>
      )}
    </div>
  )
}
