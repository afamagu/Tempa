'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { recordDispatchProgress, type DispatchMoment } from '@/lib/dispatches'
import {
  clampReadingPosition,
  estimateScrollFraction,
  getReadingPlaceState,
  recordReadingProgress,
  saveReadingPlace,
  removeSavedReadingPlace,
} from '@/lib/reading-places'
import { findScrollRoot, getCurrentReadingAnchor, scrollToAnchor } from '@/app/reading-position'
import { splitParagraphs } from '@/lib/moments'
import { stripRichBodyMarker } from '@/lib/letter-editor-doc'
import DispatchBody from '../dispatch-body'
import SavedPlaceControls, { SavedPlaceRibbon } from '@/app/reading-place-controls'

const PROGRESS_SAVE_INTERVAL_MS = 4000

/**
 * dispatch_views (recordDispatchProgress/initialPosition, via
 * lib/dispatches.ts) remains live, untouched, shipped production
 * infrastructure — this component still writes to it on the same
 * triggers as before, and other Board seen/view infrastructure that may
 * read it is not affected. What CHANGES here (independent audit
 * correction): dispatch_views' own forward-only "furthest paragraph
 * passed" tracker is no longer what decides where the reader visibly
 * scrolls to on open, or what "Save my place" saves — that authority
 * now belongs to reading_places (lib/reading-places.ts), exactly like
 * Letters, via a fresh-measurement anchor (app/reading-position.ts's
 * getCurrentReadingAnchor) that is re-computed every time, never
 * ratcheted. dispatch_views' own initialPosition prop is still read,
 * but now only as a ONE-TIME, paragraph-only FALLBACK for a Dispatch
 * this member started reading before reading_places had a row for it —
 * once a reading_places row exists, it is authoritative, permanently.
 *
 * The deliberate "Saved place" half (SavedPlaceControls/SavedPlaceRibbon,
 * app/reading-place-controls.tsx) lives on the same reading_places row,
 * kept fully independent of the automatic-resume columns on it: reading
 * further after saving a place never moves it, and saving/moving/
 * removing it never touches dispatch_views either.
 */
export default function DispatchReader({
  viewerId,
  dispatchId,
  body,
  moments,
  initialPosition,
}: {
  viewerId: string
  dispatchId: string
  body: string
  moments: DispatchMoment[]
  initialPosition: number
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const scrollRootRef = useRef<HTMLElement | null>(null)
  const lastPassedRef = useRef(initialPosition)
  const savedRef = useRef(initialPosition)
  const resumeAnchorRef = useRef<{ paragraphIndex: number; charOffset: number | null } | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)
  const [savedParagraphIndex, setSavedParagraphIndex] = useState<number | null>(null)
  const [savedCharOffset, setSavedCharOffset] = useState<number | null>(null)
  const [ribbonTop, setRibbonTop] = useState<number | null>(null)
  const [ribbonReady, setRibbonReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const { body: cleanBody } = stripRichBodyMarker(body)
  const paragraphCount = splitParagraphs(cleanBody).length

  // dispatch_views' own tracker — UNCHANGED persistence behavior
  // (recordDispatchProgress, same triggers, same data), except it no
  // longer decides where the reader scrolls to on entry; see this
  // component's own doc comment above.
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const index = Number((entry.target as HTMLElement).dataset.paragraphIndex)
          if (entry.boundingClientRect.top < 0 && index > lastPassedRef.current) {
            lastPassedRef.current = index
          }
        }
      },
      { threshold: 0 }
    )

    const paragraphEls = container.querySelectorAll('[data-paragraph-index]')
    paragraphEls.forEach((el) => observer.observe(el))

    const supabase = createClient()
    const interval = window.setInterval(() => {
      if (lastPassedRef.current !== savedRef.current) {
        savedRef.current = lastPassedRef.current
        void recordDispatchProgress(supabase, viewerId, dispatchId, savedRef.current)
      }
    }, PROGRESS_SAVE_INTERVAL_MS)

    return () => {
      observer.disconnect()
      window.clearInterval(interval)
      if (lastPassedRef.current !== savedRef.current) {
        void recordDispatchProgress(supabase, viewerId, dispatchId, lastPassedRef.current)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // reading_places — the AUTHORITATIVE user-facing resume position, plus
  // the deliberate Saved place, loaded together in one round trip (same
  // combined-effect shape as app/letters/[letterId]/letter-reader.tsx).
  // Falls back to dispatch_views' own initialPosition (paragraph-only)
  // only when no reading_places row exists yet for this member/Dispatch.
  useEffect(() => {
    let cancelled = false
    const container = containerRef.current
    if (!container) return
    const supabase = createClient()
    const scrollRoot = findScrollRoot(container)
    scrollRootRef.current = scrollRoot

    getReadingPlaceState(supabase, viewerId, 'dispatch', dispatchId).then((state) => {
      if (cancelled) return

      setSavedParagraphIndex(state.savedParagraphIndex)
      setSavedCharOffset(state.savedCharOffset)
      setRibbonReady(true)

      if (state.resumeParagraphIndex !== null) {
        scrollToAnchor(container, scrollRoot, state.resumeParagraphIndex, state.resumeCharOffset, 'auto')
        resumeAnchorRef.current = { paragraphIndex: state.resumeParagraphIndex, charOffset: state.resumeCharOffset }
      } else {
        const clamped = clampReadingPosition(initialPosition, paragraphCount)
        if (clamped > 0) {
          scrollToAnchor(container, scrollRoot, clamped, null, 'auto')
        }
      }

      // Always re-measures the CURRENT reading position fresh from the
      // live DOM on every tick — never a ratcheting accumulator (see
      // this component's own doc comment).
      const interval = window.setInterval(() => {
        const anchor = getCurrentReadingAnchor(container, scrollRoot)
        if (!anchor) return
        const prev = resumeAnchorRef.current
        if (!prev || anchor.paragraphIndex !== prev.paragraphIndex || anchor.charOffset !== prev.charOffset) {
          resumeAnchorRef.current = anchor
          void recordReadingProgress(supabase, viewerId, 'dispatch', dispatchId, anchor.paragraphIndex, anchor.charOffset)
        }
      }, PROGRESS_SAVE_INTERVAL_MS)

      cleanupRef.current = () => {
        window.clearInterval(interval)
        const anchor = getCurrentReadingAnchor(container, scrollRoot)
        const prev = resumeAnchorRef.current
        if (anchor && (!prev || anchor.paragraphIndex !== prev.paragraphIndex || anchor.charOffset !== prev.charOffset)) {
          void recordReadingProgress(supabase, viewerId, 'dispatch', dispatchId, anchor.paragraphIndex, anchor.charOffset)
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
  // null/stale offset fall back safely to the paragraph's own top.
  // queueMicrotask defers the setState call out of the effect body
  // itself, the established pattern here for satisfying react-hooks/
  // set-state-in-effect (see letterhead-postcard.tsx) when syncing a DOM
  // measurement — taken only after paint — into state.
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
  }, [savedParagraphIndex, savedCharOffset, ribbonReady, body])

  async function handleSave() {
    const container = containerRef.current
    if (!container) return
    // Re-measured fresh at the moment of the click — independent of
    // dispatch_views' own ratchet-based lastPassedRef above.
    const anchor = getCurrentReadingAnchor(container, scrollRootRef.current) ?? { paragraphIndex: 0, charOffset: null }
    setBusy(true)
    setErrorMessage(null)
    const supabase = createClient()
    const result = await saveReadingPlace(supabase, viewerId, 'dispatch', dispatchId, anchor.paragraphIndex, anchor.charOffset)
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
    const result = await removeSavedReadingPlace(supabase, viewerId, 'dispatch', dispatchId)
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
        <DispatchBody body={body} moments={moments} paragraphAttrs={(index) => ({ 'data-paragraph-index': index })} />
      </div>
      {/* Sticky, not floating — stays reachable while reading a long
          Dispatch without becoming a toolbar or a social-media-style
          floating action button, same treatment as the Letter reader. */}
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
