'use client'

import { helperTextClass } from '@/app/profile/ui'

/**
 * Postcard thumbnail + expanded-experience checkpoint (2026-09-14) — the
 * ONE compact, portrait, CLOSED representation of a Postcard, shared by
 * the letterhead's read-only slot (LetterheadPostcard) and the
 * composer's own resting state (PostcardComposerSlot). "The mistake was
 * rendering too much of the Postcard experience directly in the letter"
 * — this component renders exactly the still front image, nothing else:
 * no Living Reveal, no flip, no video chrome of any kind. Locked master
 * orientation is portrait (~9:16); this never crops or stretches that,
 * it only constrains WIDTH (90–110px on mobile, 110–135px on desktop —
 * chosen from within those ranges against the real letterhead
 * composition), letting height follow the image's own natural ratio.
 *
 * Discoverability is a QUIET physical affordance, never video-player UI:
 * a small lift (border + restrained shadow, a touch more shadow on
 * hover/focus for desktop pointer users) and a one-time text hint
 * ("Tap the postcard to open it.") shown only before this specific
 * instance's first tap, reusing the same animate-moment-hint/hasOpened
 * convention MomentDisplay already established for exactly this
 * purpose — never a permanent label, never a play triangle, never a
 * badge.
 */
export default function PostcardThumbnail({
  frontImagePath,
  onOpen,
  ariaLabel,
  showFirstUseHint,
}: {
  frontImagePath: string
  onOpen: () => void
  ariaLabel: string
  /** True only before this instance's own first tap this page view —
   * the caller owns that one-time state (hasOpened), never this
   * component, so it stays a pure presentational piece. */
  showFirstUseHint?: boolean
}) {
  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={onOpen}
        aria-label={ariaLabel}
        className={`w-[96px] shrink-0 overflow-hidden rounded-md border border-foreground/15 bg-background shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 sm:w-[124px] ${
          showFirstUseHint ? 'animate-moment-hint' : ''
        }`}
      >
        {/* Still front only — never a <video>, never autoplaying motion.
            Natural aspect ratio (the real masters are ~9:16 portrait) —
            no object-fit/crop, only the width above is constrained. */}
        <img src={frontImagePath} alt="" className="block w-full" />
      </button>

      {showFirstUseHint && <p className={`text-right ${helperTextClass}`}>Tap the postcard to open it.</p>}
    </div>
  )
}
