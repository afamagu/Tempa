'use client'

import { quietLinkClass } from '@/app/profile/ui'

/**
 * Shared between the Letter reader (app/letters/[letterId]/letter-
 * reader.tsx) and the Dispatch reader (app/board/[dispatchId]/
 * dispatch-reader.tsx) — the deliberate "Saved place" interaction is
 * identical for both content types (lib/reading-places.ts is already
 * the shared persistence layer); only the paragraph anchoring differs,
 * which lives in each reader, not here.
 *
 * Deliberately just three quiet text actions, never a toolbar — "Save
 * my place" / "Saved place" / "Move my place" / "Remove", matching the
 * restrained visual weight of this app's other quiet text actions
 * (quietLinkClass). No bookmark emoji, no annotation system beyond the
 * one deliberate place this supports.
 */
export default function SavedPlaceControls({
  hasSavedPlace,
  onSave,
  onJumpToSaved,
  onRemove,
  busy,
}: {
  hasSavedPlace: boolean
  onSave: () => void
  onJumpToSaved: () => void
  onRemove: () => void
  busy: boolean
}) {
  if (!hasSavedPlace) {
    return (
      <button type="button" onClick={onSave} disabled={busy} className={`${quietLinkClass} disabled:opacity-50`}>
        Save my place
      </button>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <button type="button" onClick={onJumpToSaved} className={quietLinkClass}>
        Saved place
      </button>
      <button
        type="button"
        onClick={onSave}
        disabled={busy}
        className="text-[13px] text-foreground/50 underline decoration-foreground/20 underline-offset-4 transition-colors hover:text-foreground/80 hover:decoration-foreground/50 disabled:opacity-50"
      >
        Move my place
      </button>
      <button
        type="button"
        onClick={onRemove}
        disabled={busy}
        className="text-[13px] text-foreground/50 underline decoration-foreground/20 underline-offset-4 transition-colors hover:text-foreground/80 hover:decoration-foreground/50 disabled:opacity-50"
      >
        Remove
      </button>
    </div>
  )
}

/**
 * The margin ribbon itself — a quiet, physical-book-detail tab at the
 * paragraph where a place was deliberately saved, never a social-
 * media-style reaction icon. `top` is the target paragraph's own
 * `offsetTop` within the reader's positioned container (see the
 * readers' own ribbon-positioning effect) — purely decorative,
 * `aria-hidden`, since "Saved place" above already gives an
 * accessible way to reach the same spot.
 */
export function SavedPlaceRibbon({ top }: { top: number }) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute left-0 z-10 -translate-x-1/2 text-accent sm:-translate-x-[140%]"
      style={{ top }}
    >
      <svg width="14" height="22" viewBox="0 0 14 22" className="drop-shadow-sm">
        <path d="M0 0H14V22L7 16L0 22V0Z" fill="currentColor" />
      </svg>
    </div>
  )
}
