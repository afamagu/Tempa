'use client'

import { useState } from 'react'
import { proseBodyClass, metadataTextClass, iconButtonClass } from '@/app/profile/ui'
import QuestionInfoIcon from '@/app/question-info-icon'
import ReportButton from '@/app/report-button'

function FlagIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M5 3v18" />
      <path d="M5 4h13l-3 4 3 4H5" />
    </svg>
  )
}

// Heuristic only, for deciding whether "Read more" is offered at all —
// the actual visual truncation is CSS line-clamp-4 on the complete,
// untouched body (see PREVIEW_CLAMP_CLASS below), never a character
// slice of the stored answer. A rough proxy for "longer than
// line-clamp-4 would show" at proseBodyClass's reading size — exact
// wrapping still varies by viewport width, so this only decides
// whether the control appears, never what text is shown.
const LONG_ANSWER_THRESHOLD = 280
const PREVIEW_CLAMP_CLASS = 'line-clamp-4'

/** Pure: whether "Read more" should be offered at all — split out for
 * direct testing (this codebase's tests render static markup only, no
 * click simulation, so the expand/collapse toggle itself is verified
 * by inspection; this is the one real decision behind it). */
export function isLongAnswer(body: string): boolean {
  return body.length > LONG_ANSWER_THRESHOLD
}

/**
 * One published canonical answer on the public profile — writing
 * first, Question hidden until asked for (QuestionInfoIcon), long
 * writing previewed rather than dumped in full (Read more / Show
 * less). The two disclosures are independent: revealing the Question
 * never affects whether the answer is expanded, and vice versa.
 *
 * Admin Phase 2A-1: `id`/`showReport` let this same component serve
 * both the owner's own profile (no Report action on your own writing)
 * and everyone else's, without a second component — `showReport` is
 * simply `!isSelf`, decided by the caller.
 */
export default function ProfileAnswer({
  id,
  prompt,
  body,
  isCurrent,
  showReport,
}: {
  id: string
  prompt: string
  body: string
  isCurrent: boolean
  showReport: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const isLong = isLongAnswer(body)

  return (
    <div className="rounded-md border border-foreground/10 p-4">
      <div className="flex items-center justify-end gap-1">
        {showReport && (
          <div className="relative">
            <ReportButton
              targetType="question_answer"
              targetId={id}
              triggerClassName={iconButtonClass}
              triggerLabel={<FlagIcon />}
              triggerAriaLabel="Report this answer"
              panelClassName="absolute right-0 top-full z-20 mt-1 w-72 rounded-md border border-foreground/10 bg-background p-3 shadow-md"
            />
          </div>
        )}
        <QuestionInfoIcon prompt={prompt} />
      </div>

      <div className="-mt-2 rounded-md bg-surface-shell p-4">
        <p className={`whitespace-pre-wrap ${proseBodyClass} ${expanded ? '' : PREVIEW_CLAMP_CLASS}`}>
          {body}
        </p>
        {isLong && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-expanded={expanded}
            className="mt-2 text-[13px] font-medium text-accent hover:underline"
          >
            {expanded ? 'Show less' : 'Read more'}
          </button>
        )}
      </div>

      {isCurrent && <p className={`mt-2 ${metadataTextClass}`}>Shown in Minds</p>}
    </div>
  )
}
