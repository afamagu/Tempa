'use client'

import { useState } from 'react'
import { quietLinkClass, sectionLabelClass } from '@/app/profile/ui'
import ProfileAnswer from './profile-answer'
import type { MyQuestionAnswer } from '@/lib/questions'

/**
 * Question Slots checkpoint (Section A4) — the profile's primary
 * answer (Question #1) is always shown in full above this; everything
 * else this member has ever answered lives behind this restrained
 * "Read more answers" disclosure, collapsed by default so the primary
 * identity answer stays the clear focus of the profile. Nothing here
 * is destroyed or hidden permanently — it's one tap away.
 */
export default function OtherAnswersDisclosure({
  answers,
  showReport,
  ownerPseudonym,
  isSelf = false,
}: {
  answers: MyQuestionAnswer[]
  showReport: boolean
  /** Onboarding & First-Use checkpoint (Section I) — personalizes the
   * disclosure label ("Read Maya's other responses") when the owner's
   * pseudonym is already available at the caller's own boundary (it
   * always is here — app/minds/[userId]/page.tsx already fetches the
   * profile being viewed) — never fetched specially for this copy
   * alone. Optional purely so this component stays independently
   * testable without forcing every call site to supply it. */
  ownerPseudonym?: string
  /** True on a member's own profile — "Read your other responses"
   * rather than a third-person pseudonym. */
  isSelf?: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  if (answers.length === 0) return null

  const collapsedLabel = isSelf
    ? `Read your other responses (${answers.length})`
    : ownerPseudonym
      ? `Read ${ownerPseudonym}'s other responses (${answers.length})`
      : `Read other responses (${answers.length})`

  return (
    <div className="space-y-4 border-t border-foreground/10 pt-6">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className={quietLinkClass}
      >
        {expanded ? 'Show fewer responses' : collapsedLabel}
      </button>

      {expanded && (
        <div className="space-y-6">
          <p className={sectionLabelClass}>Other responses</p>
          {answers.map((a) =>
            a.moderationStatus === 'hidden' ? (
              <div key={a.id} className="rounded-md border border-foreground/10 p-4">
                <p className="text-[13px] text-muted">Hidden by TEMPA.</p>
              </div>
            ) : (
              <ProfileAnswer key={a.id} id={a.id} prompt={a.prompt} body={a.body} showReport={showReport} />
            )
          )}
        </div>
      )}
    </div>
  )
}
