'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { setArrivalEmailSendingEnabled } from '@/lib/admin'
import { secondaryButtonClass, destructiveButtonClass, helperTextClass } from '@/app/profile/ui'

/** The global kill switch. Confirm-before-flip either direction — same
 * two-step shape as account-status-actions.tsx — because turning
 * sending ON affects every member with the preference on, and turning
 * it OFF is the emergency stop this whole feature exists to have
 * available. */
export default function SendingToggle({ enabled }: { enabled: boolean }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    setBusy(true)
    setError(null)
    const { error: toggleError } = await setArrivalEmailSendingEnabled(createClient(), !enabled)
    setBusy(false)
    if (toggleError) {
      setError('Could not update sending right now. Please try again.')
      return
    }
    setConfirming(false)
    router.refresh()
  }

  if (confirming) {
    return (
      <div className="space-y-3 rounded-md border border-foreground/10 p-3">
        <p className="text-[15px] font-medium text-foreground">
          {enabled ? 'Turn arrival email sending OFF for every member?' : 'Turn arrival email sending ON for every member?'}
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setConfirming(false)
              setError(null)
            }}
            disabled={busy}
            className={secondaryButtonClass}
          >
            Cancel
          </button>
          <button type="button" onClick={handleConfirm} disabled={busy} className={destructiveButtonClass}>
            {busy ? 'Working…' : enabled ? 'Turn off' : 'Turn on'}
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-md border border-foreground/10 px-4 py-3">
      <div>
        <p className="text-[15px] font-medium text-foreground">Sending is {enabled ? 'ON' : 'OFF'}</p>
        <p className={helperTextClass}>
          {enabled
            ? 'The scheduler sends arrival emails as jobs come due.'
            : 'Jobs still enqueue as letters arrive, but nothing sends until this is turned on.'}
        </p>
      </div>
      <button type="button" onClick={() => setConfirming(true)} className={enabled ? destructiveButtonClass : secondaryButtonClass}>
        {enabled ? 'Turn off' : 'Turn on'}
      </button>
    </div>
  )
}
