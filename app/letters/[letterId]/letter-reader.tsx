'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  estimateScrollFraction,
  getReadingPlaceState,
  recordReadingProgress,
  saveReadingPlace,
  removeSavedReadingPlace,
} from '@/lib/reading-places'
import { findScrollRoot, getCurrentReadingAnchor, scrollToAnchor } from '@/app/reading-position'
import type { Moment } from '@/lib/moments'
import type { PhotoConsentStatus } from '@/lib/letters'
import LetterBody from './letter-body'
import SavedPlaceControls, { SavedPlaceRibbon } from '@/app/reading-place-controls'

const PROGRESS_SAVE_INTERVAL_MS = 4000

/**
 * The Letter-side counterpart to app/board/[dispatchId]/dispatch-
 * reader.tsx — automatic reading-position resume, PLUS the deliberate
 * Saved-place controls (SavedPlaceControls/SavedPlaceRibbon,
 * app/reading-place-controls.tsx), which Dispatches also get via their
 * own reader. Both automatic resume and Saved place persist through
 * lib/reading-places.ts, keyed by (viewer, 'letter', letterId) — the
 * SAME row whether this component is mounted from the normal Letter
 * reader page or from the reply composer's "View [pseudonym]'s letter"
 * overlay (SourceLetterPanel), so reading position is shared between
 * both, exactly as required: stopping halfway through a letter in the
 * normal reader and then opening the same letter via the reply
 * reference resumes at the same place, and vice versa.
 *
 * The reading position is always RE-MEASURED FRESH from the live DOM
 * (app/reading-position.ts's getCurrentReadingAnchor), never a
 * ratcheting "furthest paragraph ever scrolled past" accumulator — a
 * member who scrolls back up before closing this Letter has their
 * automatic resume position (and, if they click Save my place at that
 * moment, their deliberate Saved place too) reflect where they actually
 * stopped, not the furthest point they reached earlier. The same
 * measurement is scroll-root-aware (app/reading-position.ts's
 * findScrollRoot): inside SourceLetterPanel's own scrollable overlay,
 * positions are measured relative to that overlay, not the browser
 * window, so tracking is correct there too.
 *
 * Unlike DispatchReader (which receives its initial position as a
 * server-fetched prop, since it only ever mounts from a fresh page
 * load), this component fetches its own initial state on mount — it
 * can also be opened, client-side, from an ALREADY-rendered page (the
 * reply composer), where there is no fresh server round-trip to carry
 * a prop from, and the state could have changed since that page's own
 * last render.
 *
 * Reusability note (kept deliberately generic, not first-contact-
 * specific): nothing about this component or SourceLetterPanel assumes
 * the letter being shown is a first-contact letter specifically — both
 * take a plain letterId/body/moments. If an established-correspondence
 * composer (app/letters/[letterId]/moments-composer.tsx) ever grows a
 * genuine "replying to a specific earlier Letter" (`replyToId`) affordance,
 * it can reuse this same reference-reading architecture rather than a
 * second implementation. This task does not add a per-letter Reply
 * button to established correspondence itself — Tempa's established
 * flow is deliberately the quill/Write Anytime composer, unchanged here.
 */
export default function LetterReader({
  viewerId,
  letterId,
  body,
  moments,
  photoConsent,
}: {
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
  const containerRef = useRef<HTMLDivElement | null>(null)
  const scrollRootRef = useRef<HTMLElement | null>(null)
  const savedResumeRef = useRef<{ paragraphIndex: number; charOffset: number | null } | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const [ready, setReady] = useState(false)
  const [savedParagraphIndex, setSavedParagraphIndex] = useState<number | null>(null)
  const [savedCharOffset, setSavedCharOffset] = useState<number | null>(null)
  const [ribbonTop, setRibbonTop] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // One-time load of this member's existing reading state for this
  // exact letter, then scroll-to-resume and start tracking. Combined
  // into one effect (rather than load-then-a-second-effect） so the
  // periodic tracker is only ever set up once, against the final resume
  // position, never twice.
  useEffect(() => {
    let cancelled = false
    const container = containerRef.current
    if (!container) return
    const supabase = createClient()
    const scrollRoot = findScrollRoot(container)
    scrollRootRef.current = scrollRoot

    getReadingPlaceState(supabase, viewerId, 'letter', letterId).then((state) => {
      if (cancelled) return

      setSavedParagraphIndex(state.savedParagraphIndex)
      setSavedCharOffset(state.savedCharOffset)

      if (state.resumeParagraphIndex !== null) {
        scrollToAnchor(container, scrollRoot, state.resumeParagraphIndex, state.resumeCharOffset, 'auto')
        savedResumeRef.current = { paragraphIndex: state.resumeParagraphIndex, charOffset: state.resumeCharOffset }
      }

      // Always re-measures the CURRENT reading position fresh from the
      // live DOM on every tick — see this component's own doc comment
      // on why that replaces a ratcheting accumulator.
      const interval = window.setInterval(() => {
        const anchor = getCurrentReadingAnchor(container, scrollRoot)
        if (!anchor) return
        const prev = savedResumeRef.current
        if (!prev || anchor.paragraphIndex !== prev.paragraphIndex || anchor.charOffset !== prev.charOffset) {
          savedResumeRef.current = anchor
          void recordReadingProgress(supabase, viewerId, 'letter', letterId, anchor.paragraphIndex, anchor.charOffset)
        }
      }, PROGRESS_SAVE_INTERVAL_MS)

      setReady(true)

      // Cleanup captured in a ref so the outer effect's own cleanup
      // (below) can reach it after this async callback resolved.
      cleanupRef.current = () => {
        window.clearInterval(interval)
        const anchor = getCurrentReadingAnchor(container, scrollRoot)
        const prev = savedResumeRef.current
        if (anchor && (!prev || anchor.paragraphIndex !== prev.paragraphIndex || anchor.charOffset !== prev.charOffset)) {
          void recordReadingProgress(supabase, viewerId, 'letter', letterId, anchor.paragraphIndex, anchor.charOffset)
        }
      }
    })

    return () => {
      cancelled = true
      cleanupRef.current?.()
      cleanupRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Positions the ribbon at the saved paragraph AND its intra-paragraph
  // offset — paragraph top plus the saved offset's estimated fraction of
  // that paragraph's own rendered height, so moving a saved place within
  // the same paragraph visibly moves the ribbon (independent audit
  // correction: previously offsetTop alone, paragraph-level only).
  // estimateScrollFraction's own clamp/zero-length guard is what makes a
  // null/stale offset fall back safely to the paragraph's own top. Uses
  // offsetTop/offsetHeight (this component's own positioned-container
  // layout position), not a scroll-root-relative measurement — this
  // positions a ribbon in the document's own layout flow, not a live
  // scroll position. queueMicrotask defers the setState call out of the
  // effect body itself, the established pattern here for satisfying
  // react-hooks/set-state-in-effect (see letterhead-postcard.tsx) when
  // syncing a DOM measurement — taken only after paint — into state.
  useEffect(() => {
    if (savedParagraphIndex === null) {
      queueMicrotask(() => setRibbonTop(null))
      return
    }
    const container = containerRef.current
    if (!container) return
    const target = container.querySelector(`[data-paragraph-index="${savedParagraphIndex}"]`)
    if (target instanceof HTMLElement) {
      const text = target.textContent ?? ''
      const fraction = savedCharOffset !== null ? estimateScrollFraction(savedCharOffset, text.length) : 0
      const top = target.offsetTop + fraction * target.offsetHeight
      queueMicrotask(() => setRibbonTop(top))
    }
  }, [savedParagraphIndex, savedCharOffset, ready, body])

  async function handleSave() {
    const container = containerRef.current
    if (!container) return
    // Re-measured fresh at the moment of the click — Save my place saves
    // the position currently being read, never a stale/furthest-ever
    // value from the periodic tracker.
    const anchor = getCurrentReadingAnchor(container, scrollRootRef.current) ?? { paragraphIndex: 0, charOffset: null }
    setBusy(true)
    setErrorMessage(null)
    const supabase = createClient()
    const result = await saveReadingPlace(supabase, viewerId, 'letter', letterId, anchor.paragraphIndex, anchor.charOffset)
    if (result.ok) {
      setSavedParagraphIndex(anchor.paragraphIndex)
      setSavedCharOffset(anchor.charOffset)
    } else {
      setErrorMessage('Could not save your place. Please try again.')
    }
    setBusy(false)
  }

  async function handleRemove() {
    setBusy(true)
    setErrorMessage(null)
    const supabase = createClient()
    const result = await removeSavedReadingPlace(supabase, viewerId, 'letter', letterId)
    if (result.ok) {
      setSavedParagraphIndex(null)
      setSavedCharOffset(null)
    } else {
      setErrorMessage('Could not remove your saved place. Please try again.')
    }
    setBusy(false)
  }

  function handleJumpToSaved() {
    const container = containerRef.current
    if (savedParagraphIndex === null || !container) return
    scrollToAnchor(container, scrollRootRef.current, savedParagraphIndex, savedCharOffset, 'smooth')
  }

  return (
    <div>
      <div ref={containerRef} className="relative">
        {ribbonTop !== null && <SavedPlaceRibbon top={ribbonTop} />}
        <LetterBody
          body={body}
          moments={moments}
          photoConsent={photoConsent}
          paragraphAttrs={(index) => ({ 'data-paragraph-index': index })}
        />
      </div>
      {/* Sticky, not floating — stays reachable while reading a long
          Letter without becoming a toolbar or a social-media-style
          floating action button; resolves relative to whichever
          ancestor is actually scrollable (the page itself, or
          SourceLetterPanel's own overlay), exactly like the reading-
          position tracking above. */}
      <div className="sticky bottom-0 z-10 -mx-1 mt-3 border-t border-foreground/10 bg-background/90 px-1 py-2 backdrop-blur-sm">
        <SavedPlaceControls
          hasSavedPlace={savedParagraphIndex !== null}
          onSave={handleSave}
          onJumpToSaved={handleJumpToSaved}
          onRemove={handleRemove}
          busy={busy}
        />
        {errorMessage && <p className="mt-1 text-[13px] text-red-600">{errorMessage}</p>}
      </div>
    </div>
  )
}
