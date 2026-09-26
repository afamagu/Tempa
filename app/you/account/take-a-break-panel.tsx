'use client'

import { useEffect, useState, useTransition } from 'react'
import { primaryButtonClass, secondaryButtonClass, systemBodyClass } from '@/app/profile/ui'
import { DEACTIVATION_REASONS, type ExitFeedback } from '@/lib/account-lifecycle'
import { deactivateMyAccount } from './actions'
import ExitReasonFields from './exit-reason-fields'

/**
 * You → Account & privacy → Take a break. Reversible: nothing is deleted,
 * and the member returns whenever they like from /account-paused. A
 * reason is optional and never blocks the pause.
 */
export default function TakeABreakPanel({
  action = deactivateMyAccount,
}: {
  /** Injectable for tests; always the server action in the app. */
  action?: (feedback: ExitFeedback) => Promise<{ ok: false; error: string } | void>
}) {
  const [open, setOpen] = useState(false)
  const [feedback, setFeedback] = useState<ExitFeedback>({ reasonCode: null, reasonDetail: '' })
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !pending) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, pending])

  function submit() {
    if (pending) return
    setError(null)
    startTransition(async () => {
      const result = await action(feedback)
      if (result && !result.ok) setError(result.error)
    })
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={secondaryButtonClass}>
        Deactivate Tempa
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-8">
          <div className="absolute inset-0 bg-foreground/35" aria-hidden="true" onClick={() => !pending && setOpen(false)} />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="take-a-break-title"
            className="relative max-h-[88dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border border-foreground/10 bg-background p-5 shadow-xl sm:p-6"
          >
            <h2 id="take-a-break-title" className="font-serif text-xl text-foreground">
              Take a break from Tempa?
            </h2>
            <p className={systemBodyClass}>
              Your profile and Dispatches disappear from public Tempa and nobody new can write to you. Your letters,
              Keepsakes and settings wait for you — come back whenever you&rsquo;re ready.
            </p>

            <ExitReasonFields
              name="deactivation-reason"
              legend="What’s prompting the break?"
              reasons={DEACTIVATION_REASONS}
              value={feedback}
              onChange={setFeedback}
              disabled={pending}
            />

            {error && (
              <p role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
              <button type="button" onClick={() => setOpen(false)} disabled={pending} className={secondaryButtonClass}>
                Not now
              </button>
              <button type="button" onClick={submit} disabled={pending} className={primaryButtonClass}>
                {pending ? 'Pausing…' : 'Deactivate Tempa'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
