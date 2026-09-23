'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { transitionSafetyCase, type CaseStatus, type CaseTransitionTarget } from '@/lib/admin-safety'
import { secondaryButtonClass } from '@/app/profile/ui'

const NEXT_ACTIONS: Record<CaseStatus, { target: CaseTransitionTarget; label: string }[]> = {
  open: [
    { target: 'reviewing', label: 'Start reviewing' },
    { target: 'no_action', label: 'No action needed' },
    { target: 'resolved', label: 'Resolve' },
  ],
  reviewing: [
    { target: 'no_action', label: 'No action needed' },
    { target: 'resolved', label: 'Resolve' },
  ],
  no_action: [],
  resolved: [],
}

/**
 * Safety 2, Checkpoint 7 — the narrow review-only workflow this
 * checkpoint owns: open -> reviewing; open/reviewing -> no_action;
 * open/reviewing -> resolved. Never restriction/suspension/ban/a member
 * Safety warning — those stay Checkpoint 8's alone, and no button here
 * can produce them. Mirrors app/admin/mark-reviewed-button.tsx's own
 * client-action shape exactly (busy/error state, router.refresh() on
 * success, never a client-direct table write).
 *
 * Passes its own already-loaded `status` back as p_expected_status
 * (optimistic concurrency) — if another Admin tab already moved this
 * case since this page loaded, admin_transition_safety_case rejects the
 * stale attempt outright rather than silently overwriting newer state;
 * that failure surfaces here as an ordinary error message asking the
 * reviewer to refresh.
 */
export default function CaseTransitionActions({ caseId, status }: { caseId: string; status: CaseStatus }) {
  const router = useRouter()
  const [busy, setBusy] = useState<CaseTransitionTarget | null>(null)
  const [error, setError] = useState<string | null>(null)

  const actions = NEXT_ACTIONS[status]
  if (actions.length === 0) return null

  async function handleClick(target: CaseTransitionTarget) {
    if (busy) return
    setBusy(target)
    setError(null)
    const { error: transitionError } = await transitionSafetyCase(createClient(), caseId, status, target)
    setBusy(null)
    if (transitionError) {
      setError(
        transitionError.message === 'This case has changed since you loaded it. Please refresh and try again.'
          ? transitionError.message
          : 'Could not update this case. Please try again.'
      )
      return
    }
    router.refresh()
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {actions.map((a) => (
          <button
            key={a.target}
            type="button"
            onClick={() => handleClick(a.target)}
            disabled={busy !== null}
            className={secondaryButtonClass}
          >
            {busy === a.target ? 'Updating…' : a.label}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
