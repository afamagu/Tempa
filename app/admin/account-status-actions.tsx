'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { setAccountStatus, type AccountStatus } from '@/lib/admin'
import { helperTextClass, secondaryButtonClass, destructiveButtonClass, inputClass, fieldLabelClass } from '@/app/profile/ui'

const ACTIONS: { status: AccountStatus; label: string; destructive: boolean }[] = [
  { status: 'active', label: 'Restore', destructive: false },
  { status: 'restricted', label: 'Restrict', destructive: true },
  { status: 'suspended', label: 'Suspend', destructive: true },
  { status: 'banned', label: 'Ban', destructive: true },
]

/**
 * Restore / Restrict / Suspend / Ban — the entire admin-side account-
 * status surface. Every action requires a reason (admin_set_account_
 * status itself rejects a blank one; this UI just makes that step
 * visible rather than a silent server error) — no destructive one-click
 * action, per the checkpoint's own requirement. `currentStatus` is
 * disabled in the choice list since re-applying the same status is a
 * no-op that would only pollute the audit trail with an identical
 * "changed to the status it already was" entry.
 */
export default function AccountStatusActions({
  userId,
  currentStatus,
}: {
  userId: string
  currentStatus: AccountStatus
}) {
  const router = useRouter()
  const [pending, setPending] = useState<AccountStatus | null>(null)
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

    const { error: statusError } = await setAccountStatus(createClient(), userId, pending, reason)

    setBusy(false)

    if (statusError) {
      setError('Could not update this account. Please try again.')
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
          <label className={fieldLabelClass} htmlFor="admin-status-reason">
            Reason (required)
          </label>
          <textarea
            id="admin-status-reason"
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
      <p className={helperTextClass}>Current status: {currentStatus}</p>
      <div className="flex flex-wrap gap-2">
        {ACTIONS.filter((a) => a.status !== currentStatus).map((a) => (
          <button
            key={a.status}
            type="button"
            onClick={() => setPending(a.status)}
            className={a.destructive ? destructiveButtonClass : secondaryButtonClass}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  )
}
