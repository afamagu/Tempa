'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { destructiveButtonClass, helperTextClass, inputClass, secondaryButtonClass, systemBodyClass } from '@/app/profile/ui'
import { DELETION_REASONS, type ExitFeedback } from '@/lib/account-lifecycle'
import { deleteMyAccount } from './actions'
import ExitReasonFields from './exit-reason-fields'

const CONFIRMATION = 'DELETE'

/**
 * You → Account → Delete account. Two deliberate steps: open the
 * explanation, then type DELETE before "Delete my account" enables. The
 * server action re-checks the confirmation and derives the member from
 * their own session — nothing here can name another account.
 */
export default function DeleteAccountPanel({
  action = deleteMyAccount,
  takeBreakHref,
}: {
  /** Injectable for tests; always the server action in the app. */
  action?: (confirmation: string, feedback: ExitFeedback) => Promise<{ ok: false; error: string } | void>
  /** Where "Take a break instead" points (omitted when already on a break). */
  takeBreakHref?: string
}) {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [feedback, setFeedback] = useState<ExitFeedback>({ reasonCode: null, reasonDetail: '' })
  const [pending, startTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)
  const confirmed = typed === CONFIRMATION

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !pending) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, pending])

  function close() {
    if (pending) return
    setOpen(false)
    setTyped('')
    setError(null)
  }

  function submit() {
    if (!confirmed || pending) return
    setError(null)
    startTransition(async () => {
      // On success the action redirects (the browser leaves this page);
      // it only ever returns when nothing was deleted.
      const result = await action(typed, feedback)
      if (result && !result.ok) setError(result.error)
    })
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={destructiveButtonClass}>
        Delete account
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-8">
          <div className="absolute inset-0 bg-foreground/35" aria-hidden="true" onClick={close} />
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-account-title"
            className="relative max-h-[88dvh] w-full max-w-lg space-y-4 overflow-y-auto rounded-xl border border-foreground/10 bg-background p-5 shadow-xl sm:p-6"
          >
            <h2 id="delete-account-title" className="font-serif text-xl text-foreground">
              Delete your Tempa account?
            </h2>
            <ul className={`list-disc space-y-2 pl-5 ${systemBodyClass}`}>
              <li>This is permanent. You will lose access to your Tempa account.</li>
              <li>Your profile, Mark and responses are removed, and you will no longer appear in People or be introduced to anyone.</li>
              <li>Your Dispatches are taken down.</li>
              <li>Letters you have already sent stay in the recipient’s mailbox, shown without your profile.</li>
              <li>
                Some limited records are kept where needed for safety, preventing fraud and abuse, legal compliance or audit
                integrity — for example reports, safety decisions and your acceptance of Tempa’s terms.
              </li>
            </ul>

            {takeBreakHref && (
              <p className={helperTextClass}>
                Want to step away without losing anything?{' '}
                <a href={takeBreakHref} onClick={close} className="underline underline-offset-4">
                  Take a break instead
                </a>
                .
              </p>
            )}

            <ExitReasonFields
              name="deletion-reason"
              legend="Why are you leaving?"
              reasons={DELETION_REASONS}
              value={feedback}
              onChange={setFeedback}
              disabled={pending}
            />

            <label className="block space-y-1.5">
              <span className={helperTextClass}>
                Type <strong className="font-semibold text-foreground">{CONFIRMATION}</strong> to confirm
              </span>
              <input
                ref={inputRef}
                className={inputClass}
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                aria-describedby={error ? 'delete-account-error' : undefined}
                disabled={pending}
              />
            </label>

            {error && (
              <p id="delete-account-error" role="alert" className="text-sm text-red-600">
                {error}
              </p>
            )}

            <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
              <button type="button" onClick={close} disabled={pending} className={secondaryButtonClass}>
                Keep my account
              </button>
              <button type="button" onClick={submit} disabled={!confirmed || pending}
                className={`${destructiveButtonClass} disabled:cursor-not-allowed disabled:opacity-40`}
              >
                {pending ? 'Deleting…' : 'Delete my account'}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
