'use client'

import { useState, useTransition } from 'react'
import { primaryButtonClass } from '@/app/profile/ui'
import { reactivateMyAccount } from '@/app/you/account/actions'

/** The ONLY way a break ends: an explicit choice to come back. */
export default function ReturnToTempaButton({
  action = reactivateMyAccount,
}: {
  /** Injectable for tests; always the server action in the app. */
  action?: () => Promise<{ ok: false; error: string } | void>
}) {
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="space-y-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setError(null)
            const result = await action()
            if (result && !result.ok) setError(result.error)
          })
        }
        className={primaryButtonClass}
      >
        {pending ? 'Opening Tempa…' : 'Return to Tempa'}
      </button>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
    </div>
  )
}
