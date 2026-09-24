'use client'

import { useEffect } from 'react'
import { primaryButtonClass } from '@/app/profile/ui'
import { SAFETY_NOTE_TITLE, SAFETY_FINANCIAL_BODY, SAFETY_FINANCIAL_ACTION } from '@/lib/safety/send-with-safety'

/**
 * Phase 1 — the calm interruption shown when a message is confirmed to
 * ask another member for money or financial help. Financial solicitation
 * is not allowed on Tempa, so unlike SafetyWarningDialog there is NO
 * "send anyway" — the single action returns the member to what they were
 * writing (their draft is untouched underneath).
 *
 * Wording is fixed by Tempa's policy copy (lib/safety/send-with-safety.ts):
 * never mentions risk bands, reason codes, scams or accusations. Same
 * overlay conventions as SafetyWarningDialog: role="dialog" aria-modal,
 * Escape and backdrop-click return to the letter, body-scroll lock.
 */
export default function SafetyBlockedDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-5">
      <div className="absolute inset-0 bg-foreground/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="safety-blocked-title"
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-md space-y-4 rounded-lg border border-foreground/10 bg-background p-6 shadow-lg"
      >
        <h2 id="safety-blocked-title" className="text-[17px] font-medium text-foreground">
          {SAFETY_NOTE_TITLE}
        </h2>
        {SAFETY_FINANCIAL_BODY.map((paragraph) => (
          <p key={paragraph} className="text-[15px] leading-relaxed text-foreground/80">
            {paragraph}
          </p>
        ))}
        <div className="flex flex-wrap gap-3 pt-2">
          <button type="button" onClick={onClose} autoFocus className={primaryButtonClass}>
            {SAFETY_FINANCIAL_ACTION}
          </button>
        </div>
      </div>
    </div>
  )
}
