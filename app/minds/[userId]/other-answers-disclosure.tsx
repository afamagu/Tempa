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
}: {
  answers: MyQuestionAnswer[]
  showReport: boolean
}) {
  const [expanded, setExpanded] = useState(false)

  if (answers.length === 0) return null

  return (
    <div className="space-y-4 border-t border-foreground/10 pt-6">
      <button
        type="button"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
        className={quietLinkClass}
      >
        {expanded ? 'Show fewer answers' : `Read more answers (${answers.length})`}
      </button>

      {expanded && (
        <div className="space-y-6">
          <p className={sectionLabelClass}>Other answers</p>
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
