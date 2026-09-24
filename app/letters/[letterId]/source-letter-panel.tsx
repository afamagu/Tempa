'use client'

import { useEffect } from 'react'
import type { Moment } from '@/lib/moments'
import type { PhotoConsentStatus } from '@/lib/letters'
import LetterReader from './letter-reader'

/**
 * The reply composer's "View [pseudonym]'s letter" reference panel —
 * the SOURCE letter being replied to, opened above the composer
 * without navigating away, unmounting it, or losing the draft (see
 * first-contact-response.tsx: this panel is a sibling in the JSX tree,
 * never a replacement of the composer's own subtree, so the Tiptap
 * editor instance underneath is never touched by opening/closing it).
 *
 * Desktop: a generous centered reading panel. Mobile: a near-full-
 * height sheet, rising from the bottom with rounded top corners —
 * `mt-10`/`rounded-t-2xl` on the base (mobile) styles, overridden by
 * `sm:` for the centered desktop dialog. Same dialog conventions as
 * every other overlay in this app (app/minds/discovery-results.tsx,
 * app/minds/[userId]/profile-mark-viewer.tsx): `role="dialog"
 * aria-modal`, backdrop click + Escape + the explicit × all close it,
 * body-scroll lock while open.
 *
 * Renders the SAME LetterBody-based reading surface (via LetterReader)
 * as the normal Letter reader page, sharing that exact letter's
 * reading-position state (lib/reading-places.ts) — stopping halfway
 * through this letter here and reopening it in the normal reader (or
 * vice versa) resumes at the same place.
 */
export default function SourceLetterPanel({
  open,
  onClose,
  pseudonym,
  viewerId,
  letterId,
  body,
  moments,
  photoConsent,
}: {
  open: boolean
  onClose: () => void
  pseudonym: string
  viewerId: string
  letterId: string
  body: string
  moments: Moment[]
  photoConsent?: {
    correspondenceId: string
    status: PhotoConsentStatus
    requestedBy: string | null
    resolvedBy: string | null
    userId: string
    otherPseudonym: string
  }
}) {
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
    <div className="fixed inset-0 z-50 flex sm:items-center sm:justify-center">
      <div className="absolute inset-0 bg-foreground/40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${pseudonym}'s letter`}
        onClick={(e) => e.stopPropagation()}
        className="relative mt-10 flex h-[calc(100vh-2.5rem)] w-full flex-col overflow-hidden rounded-t-2xl bg-background sm:mt-0 sm:h-auto sm:max-h-[85vh] sm:w-full sm:max-w-2xl sm:rounded-lg sm:border sm:border-foreground/10"
      >
        <div className="flex items-center justify-between gap-3 border-b border-foreground/10 px-5 py-4">
          <h2 className="truncate text-[15px] font-medium text-foreground">{pseudonym}&rsquo;s letter</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="shrink-0 rounded-full p-2 text-lg leading-none transition-colors hover:bg-foreground/[.04]"
          >
            ×
          </button>
        </div>
        <div className="flex-1 overflow-y-auto bg-surface-shell px-5 py-5">
          <LetterReader viewerId={viewerId} letterId={letterId} body={body} moments={moments} photoConsent={photoConsent} />
        </div>
      </div>
    </div>
  )
}
