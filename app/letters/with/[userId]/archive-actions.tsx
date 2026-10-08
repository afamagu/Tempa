'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { removeLettersFromMyArchive } from '@/lib/letters'
import { helperTextClass, iconButtonClass, primaryButtonClass, secondaryButtonClass, quietLinkClass } from '@/app/profile/ui'
import Tooltip from '@/app/profile/tooltip'

function PrintedCopyIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4" aria-hidden="true">
      <path d="M7 8V3h10v5M7 17H5a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M7 14h10v7H7z" />
      <path d="M17.5 11h.01" />
    </svg>
  )
}

export default function ArchiveActions({ letterIds, onRemoved }: { letterIds: string[]; onRemoved: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setBusy(true)
    setError(null)
    const result = await removeLettersFromMyArchive(createClient(), letterIds)
    setBusy(false)
    if (result.error) {
      setError('Could not remove the selected letters. Please try again.')
      return
    }
    setConfirming(false)
    onRemoved()
    window.location.reload()
  }

  if (confirming)
    return (
      <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/25 p-3 sm:items-center sm:p-6">
        <section
          role="dialog"
          aria-modal="true"
          aria-labelledby="remove-selected-title"
          className="w-full max-w-md space-y-4 rounded-xl border border-foreground/10 bg-background p-5 shadow-xl"
        >
          <div className="space-y-2">
            <h2 id="remove-selected-title" className="text-[17px] font-medium text-foreground">
              Remove {letterIds.length === 1 ? 'this letter' : `these ${letterIds.length} letters`}?
            </h2>
            <p className={helperTextClass}>
              This changes your Letterbox only. Nothing is deleted for the other person.
            </p>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </button>
            <button type="button" className={primaryButtonClass} disabled={busy} onClick={remove}>
              {busy ? 'Removing…' : 'Remove'}
            </button>
          </div>
        </section>
      </div>
    )

  return (
    <div className="flex items-center gap-2">
      {letterIds.length > 0 && (
        <button
          type="button"
          className={quietLinkClass}
          aria-label="Remove selected letters"
          onClick={() => setConfirming(true)}
        >
          Remove selected
        </button>
      )}
      <Tooltip
        label={
          letterIds.length === 1
            ? 'Order a beautifully printed copy, delivered to you. Coming soon.'
            : 'Select one letter to order a printed copy. Coming soon.'
        }
      >
        <button type="button" className={iconButtonClass} disabled aria-label="Order a printed copy — coming soon">
          <PrintedCopyIcon />
        </button>
      </Tooltip>
    </div>
  )
}
