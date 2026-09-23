'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { recordDispatchProgress, type DispatchMoment } from '@/lib/dispatches'
import { getReadingPlaceState, saveReadingPlace, removeSavedReadingPlace } from '@/lib/reading-places'
import { findScrollRoot, getCurrentReadingAnchor, scrollToAnchor } from '@/app/reading-position'
import { splitParagraphs } from '@/lib/moments'
import { stripRichBodyMarker } from '@/lib/letter-editor-doc'
import DispatchBody from '../dispatch-body'
import SavedPlaceControls, { SavedPlaceRibbon } from '@/app/reading-place-controls'

const PROGRESS_SAVE_INTERVAL_MS = 4000

/**
 * Automatic reading position — no Save Bookmark button anywhere, no
 * visible bookmark workflow. An IntersectionObserver watches each
 * paragraph; the highest-index paragraph that has scrolled up past the
 * "already read" threshold near the top of the viewport is the resume
 * position, matching the product requirement's preference for a
 * content-stable position (paragraph index) over a fragile raw pixel
 * scroll offset, which breaks across viewport widths, font-size
 * changes, and any future reflow. Saved on an interval and on unmount
 * — never on every scroll event, which would be far more writes than
 * this needs. Reading state is private to the viewer (dispatch_views'
 * own RLS enforces this; nothing here changes that).
 *
 * Automatic resume itself is UNCHANGED — still dispatch_views, via
 * recordDispatchProgress, exactly as before this feature (including its
 * own pre-existing "furthest paragraph passed" tracking — out of scope
 * to alter; that mechanism is live, shipped production infrastructure).
 * The deliberate "Saved place" half (SavedPlaceControls/SavedPlaceRibbon,
 * app/reading-place-controls.tsx) is new, and lives on the separate,
 * shared reading_places table (lib/reading-places.ts) — the same one
 * app/letters/[letterId]/letter-reader.tsx uses for Letters — kept
 * fully independent of the automatic-resume state above: reading
 * further after saving a place never moves it, and saving/moving/
 * removing it never touches dispatch_views. Saved place ALWAYS
 * re-measures the current reading position fresh (app/reading-
 * position.ts's getCurrentReadingAnchor) at the moment "Save my place"
 * is clicked, independent of dispatch_views' own ratchet above — see
 * that module's own doc comment for why a ratchet is the wrong anchor
 * for a deliberate "save what I'm looking at right now" action.
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
  const [savedParagraphIndex, setSavedParagraphIndex] = useState<number | null>(null)
  const [savedCharOffset, setSavedCharOffset] = useState<number | null>(null)
  const [ribbonTop, setRibbonTop] = useState<number | null>(null)
  const [ribbonReady, setRibbonReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const { body: cleanBody } = stripRichBodyMarker(body)
  const paragraphCount = splitParagraphs(cleanBody).length

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    // Scroll to the stored position once, on entry — clamped against
    // the Dispatch's ACTUAL current paragraph count, never trusted as
    // in-range on its own (see clampReadingPosition, lib/dispatches.ts).
    const clamped = Math.min(Math.max(initialPosition, 0), Math.max(paragraphCount - 1, 0))
    if (clamped > 0) {
      const target = container.querySelector(`[data-paragraph-index="${clamped}"]`)
      target?.scrollIntoView({ block: 'start' })
    }

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

  // Deliberate Saved place — entirely separate load from the automatic-
  // resume effect above (different table, different concern).
  useEffect(() => {
    let cancelled = false
    const container = containerRef.current
    if (container) scrollRootRef.current = findScrollRoot(container)
    const supabase = createClient()
    getReadingPlaceState(supabase, viewerId, 'dispatch', dispatchId).then((state) => {
      if (!cancelled) {
        setSavedParagraphIndex(state.savedParagraphIndex)
        setSavedCharOffset(state.savedCharOffset)
        setRibbonReady(true)
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // queueMicrotask defers the setState call out of the effect body
  // itself, the established pattern here for satisfying react-hooks/
  // set-state-in-effect (see letterhead-postcard.tsx) when syncing a
  // DOM measurement — taken only after paint — into state.
  useEffect(() => {
    if (savedParagraphIndex === null) {
      queueMicrotask(() => setRibbonTop(null))
      return
    }
    const container = containerRef.current
    if (!container) return
    const target = container.querySelector(`[data-paragraph-index="${savedParagraphIndex}"]`)
    if (target instanceof HTMLElement) {
      const top = target.offsetTop
      queueMicrotask(() => setRibbonTop(top))
    }
  }, [savedParagraphIndex, ribbonReady, body])

  async function handleSave() {
    const container = containerRef.current
    if (!container) return
    // Re-measured fresh at the moment of the click — see this
    // component's own doc comment on why this is independent of
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
