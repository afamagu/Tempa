'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { applySafetyCaseIntervention, type CaseStatus, type CaseInterventionStatus } from '@/lib/admin-safety'
import type { AccountStatus } from '@/lib/admin'
import { helperTextClass, secondaryButtonClass, destructiveButtonClass, inputClass, fieldLabelClass } from '@/app/profile/ui'

const ACTIONS: { status: CaseInterventionStatus; label: string }[] = [
  { status: 'restricted', label: 'Restrict' },
  { status: 'suspended', label: 'Suspend' },
  { status: 'banned', label: 'Ban' },
]

/**
 * Safety 2, Checkpoint 8 — the one case-aware graduated-intervention
 * surface, deliberately mirroring app/admin/account-status-actions.tsx's
 * own shape (select -> required reason -> Cancel/Confirm) rather than
 * inventing a new interaction pattern. Every action uses the SAME
 * destructiveButtonClass with no size/color escalation toward Ban —
 * "do not make the highest-risk button the visually irresistible/
 * default action." This component never reads or references a risk
 * band: risk band is evidence context for the reviewer, never a
 * recommendation this UI makes on the reviewer's behalf.
 *
 * Deliberately does NOT offer "Restore" — restoring an account already
 * under this kind of enforcement continues through the ordinary member-
 * workspace AccountStatusActions (item 4's own instruction), not this
 * case-linked surface.
 *
 * Calls applySafetyCaseIntervention (the ONE transactional path), never
 * the two-call `setAccountStatus(); transitionSafetyCase();` split —
 * that split is explicitly forbidden (item 9): the first could succeed
 * and the second fail, leaving the account and the case inconsistent.
 *
 * The caller (the case-detail page) is responsible for only rendering
 * this component while the case is still open/reviewing — once a case
 * reaches a terminal outcome, the page shows what happened instead of
 * this action set (item 8's own "once terminal, show the outcome"
 * requirement).
 */
export default function CaseAccountInterventionActions({
  caseId,
  caseStatus,
  accountStatus,
}: {
  caseId: string
  caseStatus: CaseStatus
  accountStatus: AccountStatus
}) {
  const router = useRouter()
  const [pending, setPending] = useState<CaseInterventionStatus | null>(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    if (busy || !pending) return
    if (reason.trim().length === 0) {
      setError('A reason is required.')
      return
    }
    setBusy(true)
    setError(null)

    const { error: interventionError } = await applySafetyCaseIntervention(createClient(), {
      caseId,
      expectedCaseStatus: caseStatus,
      expectedAccountStatus: accountStatus,
      newStatus: pending,
      reason,
    })

    setBusy(false)

    if (interventionError) {
      setError(
        interventionError.message.includes('changed since you loaded it')
          ? interventionError.message
          : 'Could not apply this action. Please try again.'
      )
      return
    }

    setPending(null)
    setReason('')
    router.refresh()
  }

  if (pending) {
    return (
      <div className="space-y-3 rounded-md border border-foreground/10 p-3">
        <p className="text-[14px] font-medium text-foreground">
          {ACTIONS.find((a) => a.status === pending)?.label} this member?
        </p>
        <div>
          <label className={fieldLabelClass} htmlFor="case-intervention-reason">
            Reason (required)
          </label>
          <textarea
            id="case-intervention-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value.slice(0, 500))}
            maxLength={500}
            rows={3}
            className={`mt-2 ${inputClass}`}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setPending(null)
              setReason('')
              setError(null)
            }}
            disabled={busy}
            className={secondaryButtonClass}
          >
            Cancel
          </button>
          <button type="button" onClick={handleConfirm} disabled={busy} className={destructiveButtonClass}>
            {busy ? 'Working…' : 'Confirm'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <p className={helperTextClass}>Current account status: {accountStatus}</p>
      <div className="flex flex-wrap gap-2">
        {ACTIONS.map((a) => (
          <button key={a.status} type="button" onClick={() => setPending(a.status)} className={destructiveButtonClass}>
            {a.label}
          </button>
        ))}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
