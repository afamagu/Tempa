'use client'

import { useEffect, useRef, useState } from 'react'
import { iconButtonClass } from '@/app/profile/ui'
import Tooltip from '@/app/profile/tooltip'
import RemoveFromLetterbox from '@/app/letters/remove-from-letterbox'
import BlockButton from '@/app/block-button'
import ReportButton from '@/app/report-button'
import type { BlockScope } from '@/lib/blocking'

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden="true">
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  )
}

const itemClass =
  'block w-full rounded-md px-3 py-2 text-left text-[14px] transition-colors hover:bg-foreground/[.06] disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent'

/**
 * A restrained per-letter overflow menu, comparable in interaction
 * discipline to Gmail — every entry here either does something real
 * (Remove from my Letterbox, Block, Report — pre-beta minimum safety
 * build) or is visibly, honestly disabled rather than half-built (Send a
 * physical copy, Translate). Reply lives as its own prominent action on
 * the page, not buried in this menu — see app/letters/[letterId]/page.tsx.
 */
export default function LetterActionMenu({
  letterId,
  correspondenceId,
  otherPartyId,
  otherPseudonym,
  initialBlockScope = null,
}: {
  letterId: string
  correspondenceId: string
  otherPartyId: string
  otherPseudonym: string
  initialBlockScope?: BlockScope | null
}) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: PointerEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  return (
    <div ref={wrapperRef} className="relative">
      <Tooltip label="More actions">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="More actions for this letter"
          aria-expanded={open}
          className={iconButtonClass}
        >
          <MenuIcon />
        </button>
      </Tooltip>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-72 rounded-md border border-foreground/10 bg-background p-1.5 shadow-md">
          <button type="button" disabled className={itemClass} title="Send a physical copy — not available yet">
            Send a physical copy
          </button>
          <button type="button" disabled className={itemClass} title="Translate — coming later">
            Translate
          </button>
          <ReportButton targetType="letter" targetId={letterId} triggerClassName={itemClass} />
          <RemoveFromLetterbox correspondenceIds={[correspondenceId]} triggerClassName={itemClass} />
          <div className="my-1 border-t border-foreground/10" />
          <BlockButton
            blockedId={otherPartyId}
            blockedPseudonym={otherPseudonym}
            triggerClassName={itemClass}
            initialScope={initialBlockScope}
          />
        </div>
      )}
    </div>
  )
}
