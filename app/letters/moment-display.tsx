'use client'

import { useEffect, useState } from 'react'
import { helperTextClass } from '@/app/profile/ui'
import type { PostcardData } from '@/lib/moments'
import PostcardObject from './postcard-object'

type MomentDisplayProps =
  | {
      type: 'photo'
      src: string
      alt: string
      /** Shown once, before the first tap — used only by the walkthrough's
       * teaching moment. The real reader never passes this. */
      hint?: string
      onFirstOpen?: () => void
    }
  | {
      type: 'postcard'
      postcard: PostcardData
      /** See PostcardObject's own doc comment — passed straight through.
       * Omitted by every current call site (no persistence exists yet),
       * which defaults to "first reveal," exactly matching pre-Living-
       * Reveal behavior for a PostcardData with no `living` data. */
      hasRevealedBefore?: boolean
      hint?: string
      onFirstOpen?: () => void
    }

/**
 * One Photo or Postcard, rendered inline in a letter and expandable to
 * a focused view on tap. Shared by the real letter reader
 * (app/letters/[letterId]/letter-body.tsx) and the Moments walkthrough's
 * interactive sample letter, so both use the exact same interaction —
 * the walkthrough is not a diagram of this behavior, it's a real
 * instance of it.
 *
 * A Photo is a plain image, natural aspect ratio, never cropped, single-
 * sided. A Postcard keeps its card/border treatment even when expanded,
 * and only there — never on the small inline thumbnail — gains a
 * "Turn over" control that flips the same card object to a designed
 * back side, built entirely from PostcardData rather than any hard-coded
 * markup, so a future catalog postcard gets the identical interaction
 * for free.
 */
export default function MomentDisplay(props: MomentDisplayProps) {
  const { type, hint, onFirstOpen } = props
  const [open, setOpen] = useState(false)
  const [hasOpened, setHasOpened] = useState(false)

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

  function handleTap() {
    if (!hasOpened) {
      setHasOpened(true)
      onFirstOpen?.()
    }
    setOpen(true)
  }

  const showHint = Boolean(hint) && !hasOpened
  const thumbnailSrc = type === 'photo' ? props.src : props.postcard.frontImagePath
  const thumbnailAlt = type === 'photo' ? props.alt : `${props.postcard.title} postcard`

  return (
    <div className="my-3">
      {/* Inline = glimpse, tap = reveal — a small physical-print-sized
          thumbnail, never full width, and never carrying a flip control
          of its own (turning over only happens once expanded). */}
      <button
        type="button"
        onClick={handleTap}
        className={
          type === 'postcard'
            ? `mx-auto block w-[170px] rounded-md border border-foreground/15 bg-background p-2 ${
                showHint ? 'animate-moment-hint' : ''
              }`
            : `mx-auto block w-[140px] overflow-hidden rounded-md ${
                showHint ? 'animate-moment-hint' : ''
              }`
        }
      >
        {/* Natural aspect ratio, never cropped or stretched. */}
        <img
          src={thumbnailSrc}
          alt={thumbnailAlt}
          className={type === 'postcard' ? 'block w-full rounded-sm' : 'block w-full rounded-md'}
        />
      </button>

      {showHint && <p className={`mt-2 text-center ${helperTextClass}`}>{hint}</p>}

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/50 p-4">
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="absolute inset-0 cursor-default"
          />

          {type === 'photo' ? (
            <div className="relative max-h-[90vh] max-w-[92vw] sm:max-w-lg">
              <img
                src={props.src}
                alt={props.alt}
                className="max-h-[85vh] w-full rounded-md object-contain"
              />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="absolute -top-3 -right-3 flex h-9 w-9 items-center justify-center rounded-full bg-background text-lg leading-none text-foreground ring-1 ring-foreground/15"
              >
                ×
              </button>
            </div>
          ) : (
            <div className="relative w-full max-w-[92vw] sm:max-w-md">
              {/* Everything postcard-related (front/back, flip, and any
                  Living Reveal) lives inside the shared PostcardObject —
                  never duplicated here. See postcard-object.tsx. */}
              <PostcardObject postcard={props.postcard} hasRevealedBefore={props.hasRevealedBefore} />

              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="absolute -top-3 -right-3 flex h-9 w-9 items-center justify-center rounded-full bg-background text-lg leading-none text-foreground ring-1 ring-foreground/15"
              >
                ×
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
