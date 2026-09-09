'use client'

import { useEffect, useState } from 'react'
import { resolveLetterPostcardDisplay, type PostcardRevealLineAlignment } from '@/lib/moments'
import PostcardObject from './postcard-object'
import PostcardThumbnail from './postcard-thumbnail'

/**
 * Postcard thumbnail + expanded-experience checkpoint (2026-09-14) — the
 * ONE canonical enclosure slot for a NEW letter-level Postcard, shared
 * verbatim by Letter Preview and the delivered reader, so a Postcard is
 * positioned, sized, and behaves identically wherever a member sees it.
 *
 * LOCKED interaction model, corrected this checkpoint — a letter-level
 * Postcard has TWO visual states, not one:
 *   - CLOSED / letter state: a compact, still-only, portrait THUMBNAIL
 *     resting in the canonical upper-right letterhead position
 *     (PostcardThumbnail) — never the full Postcard experience, never
 *     autoplaying motion. The earlier version of this component rendered
 *     the real PostcardObject directly in the letterhead — too much of
 *     the Postcard experience, too large, and (worse) capable of
 *     autoplaying Living Reveal the instant the letter itself rendered.
 *   - OPEN / Postcard experience: tapping the thumbnail opens a large,
 *     centered, backdrop-covered overlay containing the REAL, unmodified
 *     PostcardObject (front/Living-Reveal/Turn-over/back, all exactly as
 *     already approved) — mounted only while open, so a fresh mount is
 *     what naturally triggers "first deliberate open" autoplay (see
 *     PostcardObject's own `hasRevealedBefore` semantics; no
 *     cross-open memory exists anywhere in this codebase yet — same,
 *     already-accepted limitation as MomentDisplay's own historical
 *     Moment-postcard overlay, which this deliberately mirrors).
 *
 * Never a Preview-only or reader-only reimplementation, and never
 * navigation — opening/closing is local state; closing returns the
 * member to exactly where they were in the letter.
 */
export default function LetterheadPostcard({
  postcardKey,
  revealLine,
  backMessage,
  senderPseudonym,
  version,
  onEditRequest,
}: {
  postcardKey: string
  revealLine: string
  backMessage: string
  /** Pre-migration audit correction (2026-09-14) — the REAL sending
   * member's current pseudonym, resolved by the caller exactly like
   * every other sender-name display on the same page (never a
   * snapshot — see resolveLetterPostcardDisplay's own doc comment).
   * Omitting it falls back to the catalog's own demo sender name,
   * which a real caller should never actually do. */
  senderPseudonym?: string
  /** Thumbnail + expanded-experience checkpoint (2026-09-14), Part 9 —
   * the sending letter's own FROZEN asset identity (getLetterPostcardsForLetters,
   * lib/letters.ts). When given, both the closed thumbnail and the open
   * PostcardObject render this letter's exact shipped artwork, never
   * whatever POSTCARD_CATALOG's current entry for the same key defines
   * today. Omitted by Preview (nothing has been sent/frozen yet — the
   * live draft correctly shows the CURRENT catalog entry instead). */
  version?: {
    frontImagePath: string
    motionSrc: string | null
    durationSeconds: number | null
    revealLineAlignment: string | null
  }
  /** Production back-editing UX defect (2026-09-15) — given ONLY by
   * LetterPreview's own compose-time usage of this slot, never by the
   * delivered reader. When present, tapping the thumbnail calls this
   * instead of opening this component's own read-only overlay: a
   * still-drafting Postcard has nothing meaningful to "preview" here
   * anyway (the real front/Living-Reveal/Turn-over/back experience is
   * already fully shown inside PostcardEditor itself, a strict superset
   * of this read-only view), so routing straight to the real, existing
   * PostcardEditor is a pure improvement, not a loss of capability. The
   * delivered reader never passes this, so its own tap-to-view behavior
   * is completely unchanged. */
  onEditRequest?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [hasOpened, setHasOpened] = useState(false)
  // Living Postcard final interaction verification (2026-09-15) — kept
  // ABOVE the conditionally mounted PostcardObject below specifically so
  // closing the overlay (which unmounts it) cannot erase it. Deliberately
  // NOT set synchronously alongside setOpen(true) in handleOpen: a fresh
  // PostcardObject mount reads this value exactly once, via its own
  // lazy useState initializer, at the render that mounts it — so if this
  // were flipped true in the SAME batch as the very first setOpen(true),
  // that very first mount would wrongly see "already revealed" and skip
  // its own autoplay. Instead it's flipped in the effect below, which
  // fires only AFTER that mount has already committed and already read
  // the old (false) value — by the time the update lands, the current
  // mount's isRevealing/isFirstReveal state is already locked in and
  // unaffected by a later prop change, so only the NEXT open (a fresh
  // mount, after a close) reads the new value and correctly skips
  // autoplay. queueMicrotask defers the actual setState call out of the
  // effect body itself, the established pattern here for satisfying
  // react-hooks/set-state-in-effect without changing this timing.
  const [hasRevealedThisSession, setHasRevealedThisSession] = useState(false)

  const postcard = resolveLetterPostcardDisplay(postcardKey, {
    revealLine,
    backMessage,
    senderPseudonym,
    version: version
      ? {
          frontImagePath: version.frontImagePath,
          motionSrc: version.motionSrc,
          durationSeconds: version.durationSeconds,
          // DB-stored as plain text, constrained by the table's own
          // CHECK to this exact set — cast here rather than re-validated,
          // since the database already guarantees it (see
          // LetterPostcardVersion's own doc comment, lib/letters.ts).
          revealLineAlignment: version.revealLineAlignment as PostcardRevealLineAlignment | null,
        }
      : undefined,
  })

  // Same body-scroll-lock + Escape-to-close convention already
  // established by MomentDisplay's own overlay and LetterPreview —
  // never a different pattern for the same kind of full-screen layer.
  useEffect(() => {
    if (!open) return

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  // See hasRevealedThisSession's own declaration above for why this is
  // deferred via queueMicrotask rather than set synchronously here or in
  // handleOpen.
  useEffect(() => {
    if (!open) return
    queueMicrotask(() => setHasRevealedThisSession(true))
  }, [open])

  if (!postcard) return null

  function handleOpen() {
    if (onEditRequest) {
      onEditRequest()
      return
    }
    setHasOpened(true)
    setOpen(true)
  }

  return (
    <>
      <div className="flex justify-end">
        <PostcardThumbnail
          frontImagePath={postcard.frontImagePath}
          onOpen={handleOpen}
          ariaLabel={onEditRequest ? 'Edit this postcard' : 'Open postcard'}
          showFirstUseHint={!onEditRequest && !hasOpened}
        />
      </div>

      {/* Mounted only while open — closing genuinely UNMOUNTS
          PostcardObject, so the next open is a fresh mount and Living
          Reveal's own "first deliberate open" autoplay fires exactly
          once per open, never merely because the letter itself
          rendered. Mirrors MomentDisplay's own postcard overlay
          treatment (same backdrop, same z-index, same close-button
          placement) rather than inventing a new one. */}
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 p-4">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default"
          />
          <div className="relative w-full max-w-[92vw] sm:max-w-md">
            <PostcardObject postcard={postcard} hasRevealedBefore={hasRevealedThisSession} />
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="absolute -top-3 -right-3 flex h-9 w-9 items-center justify-center rounded-full bg-background text-lg leading-none text-foreground ring-1 ring-foreground/15"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </>
  )
}
