'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { removeLettersFromMyArchive } from '@/lib/letters'
import { helperTextClass, iconButtonClass, primaryButtonClass, secondaryButtonClass } from '@/app/profile/ui'
import Tooltip from '@/app/profile/tooltip'

function RemoveIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-4 w-4" aria-hidden="true">
      <path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13M10 11v5M14 11v5" />
    </svg>
  )
}

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
      <div className="absolute inset-x-0 top-full z-30 border-b border-foreground/10 bg-background p-3 shadow-sm">
        <p className="text-sm font-medium">
          Remove {letterIds.length === 1 ? 'this letter' : `these ${letterIds.length} letters`} from your Letterbox?
        </p>
        <p className={helperTextClass}>This changes your archive only. Nothing is deleted for the other person.</p>
        {error && <p className="mt-1 text-sm text-red-600">{error}</p>}
        <div className="mt-3 flex gap-2">
          <button type="button" className={secondaryButtonClass} disabled={busy} onClick={() => setConfirming(false)}>
            Cancel
          </button>
          <button type="button" className={primaryButtonClass} disabled={busy} onClick={remove}>
            {busy ? 'Removing…' : 'Remove'}
          </button>
        </div>
      </div>
    )

  return (
    <div className="flex items-center gap-1">
      <Tooltip
        label={
          letterIds.length === 0
            ? 'Select one or more letters to remove from your Letterbox.'
            : 'Remove the selected letters from your Letterbox only.'
        }
      >
        <button
          type="button"
          className={iconButtonClass}
          disabled={letterIds.length === 0}
          aria-label="Remove selected letters"
          onClick={() => setConfirming(true)}
        >
          <RemoveIcon />
        </button>
      </Tooltip>
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
