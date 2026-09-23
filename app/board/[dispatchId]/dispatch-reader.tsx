'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { recordDispatchProgress, type DispatchMoment } from '@/lib/dispatches'
import { getReadingPlaceState, saveReadingPlace, removeSavedReadingPlace } from '@/lib/reading-places'
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
 * recordDispatchProgress, exactly as before this feature. The
 * deliberate "Saved place" half (SavedPlaceControls/SavedPlaceRibbon,
 * app/reading-place-controls.tsx) is new, and lives on the separate,
 * shared reading_places table (lib/reading-places.ts) — the same one
 * app/letters/[letterId]/letter-reader.tsx uses for Letters — kept
 * fully independent of the automatic-resume state above: reading
 * further after saving a place never moves it, and saving/moving/
 * removing it never touches dispatch_views.
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
  const lastPassedRef = useRef(initialPosition)
  const savedRef = useRef(initialPosition)
  const [savedParagraphIndex, setSavedParagraphIndex] = useState<number | null>(null)
  const [ribbonTop, setRibbonTop] = useState<number | null>(null)
  const [ribbonReady, setRibbonReady] = useState(false)
  const [busy, setBusy] = useState(false)

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
    const supabase = createClient()
    getReadingPlaceState(supabase, viewerId, 'dispatch', dispatchId).then((state) => {
      if (!cancelled) {
        setSavedParagraphIndex(state.savedParagraphIndex)
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
    setBusy(true)
    const supabase = createClient()
    const index = Math.min(Math.max(lastPassedRef.current, 0), Math.max(paragraphCount - 1, 0))
    await saveReadingPlace(supabase, viewerId, 'dispatch', dispatchId, index)
    setSavedParagraphIndex(index)
    setBusy(false)
  }

  async function handleRemove() {
    setBusy(true)
    const supabase = createClient()
    await removeSavedReadingPlace(supabase, viewerId, 'dispatch', dispatchId)
    setSavedParagraphIndex(null)
    setBusy(false)
  }

  function handleJumpToSaved() {
    if (savedParagraphIndex === null) return
    const target = containerRef.current?.querySelector(`[data-paragraph-index="${savedParagraphIndex}"]`)
    target?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  return (
    <div>
      <div ref={containerRef} className="relative">
        {ribbonTop !== null && <SavedPlaceRibbon top={ribbonTop} />}
        <DispatchBody body={body} moments={moments} paragraphAttrs={(index) => ({ 'data-paragraph-index': index })} />
      </div>
      <div className="mt-3">
        <SavedPlaceControls
          hasSavedPlace={savedParagraphIndex !== null}
          onSave={handleSave}
          onJumpToSaved={handleJumpToSaved}
          onRemove={handleRemove}
          busy={busy}
        />
      </div>
    </div>
  )
}
