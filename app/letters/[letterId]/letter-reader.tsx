'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  clampReadingPosition,
  getReadingPlaceState,
  recordReadingProgress,
  saveReadingPlace,
  removeSavedReadingPlace,
} from '@/lib/reading-places'
import { splitParagraphs, type Moment } from '@/lib/moments'
import { stripRichBodyMarker } from '@/lib/letter-editor-doc'
import type { PhotoConsentStatus } from '@/lib/letters'
import LetterBody from './letter-body'
import SavedPlaceControls, { SavedPlaceRibbon } from '@/app/reading-place-controls'

const PROGRESS_SAVE_INTERVAL_MS = 4000

/**
 * The Letter-side counterpart to app/board/[dispatchId]/dispatch-
 * reader.tsx — automatic reading-position resume, same paragraph-index/
 * IntersectionObserver approach, same "save on an interval and on
 * unmount, never on every scroll event" discipline — PLUS the
 * deliberate Saved-place controls (SavedPlaceControls/SavedPlaceRibbon,
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
 * Unlike DispatchReader (which receives its initial position as a
 * server-fetched prop, since it only ever mounts from a fresh page
 * load), this component fetches its own initial state on mount — it
 * can also be opened, client-side, from an ALREADY-rendered page (the
 * reply composer), where there is no fresh server round-trip to carry
 * a prop from, and the state could have changed since that page's own
 * last render.
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
  const lastPassedRef = useRef(0)
  const savedResumeRef = useRef(0)
  const cleanupRef = useRef<(() => void) | null>(null)
  const [ready, setReady] = useState(false)
  const [savedParagraphIndex, setSavedParagraphIndex] = useState<number | null>(null)
  const [ribbonTop, setRibbonTop] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)

  const { body: cleanBody } = stripRichBodyMarker(body)
  const paragraphCount = splitParagraphs(cleanBody).length

  // One-time load of this member's existing reading state for this
  // exact letter, then scroll-to-resume and start tracking. Combined
  // into one effect (rather than load-then-a-second-effect） so the
  // IntersectionObserver is only ever set up once, against the final
  // resume position, never twice.
  useEffect(() => {
    let cancelled = false
    const supabase = createClient()
    const container = containerRef.current

    getReadingPlaceState(supabase, viewerId, 'letter', letterId).then((state) => {
      if (cancelled || !container) return

      setSavedParagraphIndex(state.savedParagraphIndex)

      const clamped = clampReadingPosition(state.resumeParagraphIndex, paragraphCount)
      lastPassedRef.current = clamped
      savedResumeRef.current = clamped
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
      container.querySelectorAll('[data-paragraph-index]').forEach((el) => observer.observe(el))

      const interval = window.setInterval(() => {
        if (lastPassedRef.current !== savedResumeRef.current) {
          savedResumeRef.current = lastPassedRef.current
          void recordReadingProgress(supabase, viewerId, 'letter', letterId, savedResumeRef.current)
        }
      }, PROGRESS_SAVE_INTERVAL_MS)

      setReady(true)

      // Cleanup captured in a ref so the outer effect's own cleanup
      // (below) can reach it after this async callback resolved.
      cleanupRef.current = () => {
        observer.disconnect()
        window.clearInterval(interval)
        if (lastPassedRef.current !== savedResumeRef.current) {
          void recordReadingProgress(supabase, viewerId, 'letter', letterId, lastPassedRef.current)
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

  // Position the ribbon at the saved paragraph whenever it changes (or
  // once paragraphs first render) — decoupled from the resume-tracking
  // effect above since it only reacts to savedParagraphIndex, not to
  // scroll. queueMicrotask defers the setState call out of the effect
  // body itself, the established pattern here for satisfying
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
      const top = target.offsetTop
      queueMicrotask(() => setRibbonTop(top))
    }
  }, [savedParagraphIndex, ready, body])

  async function handleSave() {
    setBusy(true)
    const supabase = createClient()
    const index = clampReadingPosition(lastPassedRef.current, paragraphCount)
    await saveReadingPlace(supabase, viewerId, 'letter', letterId, index)
    setSavedParagraphIndex(index)
    setBusy(false)
  }

  async function handleRemove() {
    setBusy(true)
    const supabase = createClient()
    await removeSavedReadingPlace(supabase, viewerId, 'letter', letterId)
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
        <LetterBody
          body={body}
          moments={moments}
          photoConsent={photoConsent}
          paragraphAttrs={(index) => ({ 'data-paragraph-index': index })}
        />
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
