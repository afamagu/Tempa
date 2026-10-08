'use client'

import { iconButtonClass } from '@/app/profile/ui'
import Tooltip from '@/app/profile/tooltip'

function TrashIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M7 7l1 13h8l1-13" />
      <path d="M10 11v5M14 11v5" />
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

export default function ArchiveActions({
  selectionCount,
  onRequestRemove,
}: {
  selectionCount: number
  onRequestRemove: () => void
}) {
  const hasSelection = selectionCount > 0

  return (
    <div className="flex items-center gap-1">
      <Tooltip
        label={
          hasSelection
            ? `Remove ${selectionCount === 1 ? 'this letter' : 'these letters'} from your Letterbox.`
            : 'Select one or more letters to remove from your Letterbox.'
        }
      >
        <button
          type="button"
          className={iconButtonClass}
          disabled={!hasSelection}
          aria-label="Remove selected letters"
          onClick={onRequestRemove}
        >
          <TrashIcon />
        </button>
      </Tooltip>

      <Tooltip
        label={
          selectionCount === 1
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
