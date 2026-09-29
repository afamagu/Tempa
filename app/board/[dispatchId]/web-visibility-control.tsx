'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { helperTextClass, quietLinkClass } from '@/app/profile/ui'
import { publicDispatchPath, setDispatchWebPublic, WEB_PUBLIC_COPY, type DispatchWebState } from '@/lib/public-dispatches'

/**
 * Public Dispatch web pages — the author's standing control on their own
 * Dispatch (always available, unlike the edit window). Members only ↔
 * Public on the web. Making it public is a deliberate two-step choice
 * with the plain-language consequence shown; making it members-only is a
 * single step and takes effect immediately (the page, sitemap entry and
 * anonymous photo access stop at once — enforced by the database).
 */
export default function WebVisibilityControl({ dispatchId, initial }: { dispatchId: string; initial: DispatchWebState }) {
  const router = useRouter()
  const [state, setState] = useState(initial)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function apply(next: boolean) {
    setBusy(true)
    setError('')
    const result = await setDispatchWebPublic(createClient(), dispatchId, next)
    setBusy(false)
    setConfirming(false)
    if (!result.ok) {
      setError(result.message)
      return
    }
    setState({ webPublic: result.webPublic, webSlug: result.webSlug })
    router.refresh()
  }

  return (
    <div className="space-y-1.5" data-testid="web-visibility-control">
      {state.webPublic && state.webSlug ? (
        <p className={helperTextClass}>
          Public on the web ·{' '}
          <Link href={publicDispatchPath(state.webSlug)} className={quietLinkClass}>
            View web page
          </Link>{' '}
          ·{' '}
          <button type="button" onClick={() => apply(false)} disabled={busy} className={quietLinkClass}>
            {busy ? 'Updating…' : 'Make members only'}
          </button>
        </p>
      ) : confirming ? (
        <div className="space-y-1.5 rounded-md border border-foreground/12 p-3">
          <p className={helperTextClass}>{WEB_PUBLIC_COPY.on}</p>
          <div className="flex gap-3">
            <button type="button" onClick={() => apply(true)} disabled={busy} className={quietLinkClass}>
              {busy ? 'Updating…' : 'Make public on the web'}
            </button>
            <button type="button" onClick={() => setConfirming(false)} disabled={busy} className={quietLinkClass}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <p className={helperTextClass}>
          Members only ·{' '}
          <button type="button" onClick={() => setConfirming(true)} className={quietLinkClass}>
            Make public on the web
          </button>
        </p>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-red-700">
          {error}
        </p>
      )}
    </div>
  )
}
