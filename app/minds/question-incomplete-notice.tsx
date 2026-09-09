'use client'

import { useState } from 'react'
import Link from 'next/link'
import { helperTextClass, primaryButtonClass } from '@/app/profile/ui'
import SystemMessage from '@/app/system-message'

/**
 * The non-blocking replacement for the old forced Question redirect —
 * a quiet, closeable notice, never a modal, never repeated once
 * dismissed for this visit (local component state only; no
 * acknowledgement row, no "seen it" tracking — it simply reflects
 * whether a canonical answer exists, so it stops appearing on its own
 * once one is published, and can reappear on a later visit without
 * that being treated as nagging). Pairs with the small dot on the
 * "Answer a Question" tab (see MindsTabs, app/minds/page.tsx) — closing
 * this notice doesn't hide that dot, which is the intentionally
 * persistent, quiet signal. Presented through the shared SystemMessage
 * primitive (app/system-message.tsx, `notice` variant) — Tempa
 * speaking to the member, never correspondence content — so this same
 * component reads consistently wherever it's shown (Minds, Home).
 */
export default function QuestionIncompleteNotice() {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  return (
    <SystemMessage
      variant="notice"
      title="Share your answer when you're ready."
      action={
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/minds?view=answer" className={primaryButtonClass}>
            Answer a Question
          </Link>
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className={`${helperTextClass} underline decoration-foreground/30 underline-offset-4 hover:text-foreground`}
          >
            Not now
          </button>
        </div>
      }
    >
      It helps other minds discover you.
    </SystemMessage>
  )
}
