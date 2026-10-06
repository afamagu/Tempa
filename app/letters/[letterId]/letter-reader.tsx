'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  getReadingPlaceState,
  recordReadingProgress,
  readCachedReadingPlace,
  writeCachedReadingPlace,
  serverReadingPlaceTimestamp,
} from '@/lib/reading-places'
import { findScrollRoot, getCurrentReadingAnchor, scrollToAnchor } from '@/app/reading-position'
import type { Moment } from '@/lib/moments'
import type { PhotoConsentStatus } from '@/lib/letters'
import LetterBody from './letter-body'

const PROGRESS_SAVE_INTERVAL_MS = 4000

/**
 * Automatic Letter resume. There is deliberately no visible bookmark,
 * ribbon, or "Save my place" action: reading position is remembered in
 * the background and restored when this same Letter is opened again.
 *
 * The same state is shared by the normal Letter page and the reply
 * composer's "View [pseudonym]'s letter" panel because both mount this
 * component with the same viewerId + letterId. Opening/closing that
 * panel never touches the reply editor, so a draft stays intact.
 */
export default function LetterReader({
  viewerId,
  letterId,
  body,
  moments,
  photoConsent,
  writingStyleId = null,
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
  /** Send-time snapshot (letters.author_writing_style_id). */
  writingStyleId?: string | null
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const savedResumeRef = useRef<{ paragraphIndex: number; charOffset: number | null } | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let cancelled = false
    const container = containerRef.current
    if (!container) return

    const supabase = createClient()
    const scrollRoot = findScrollRoot(container)
    const scrollTarget: Window | HTMLElement = scrollRoot ?? window
    let localSaveTimer: number | null = null

    const rememberCurrentLocally = () => {
      const anchor = getCurrentReadingAnchor(container, scrollRoot)
      if (!anchor) return null
      savedResumeRef.current = anchor
      return writeCachedReadingPlace(
        viewerId,
        'letter',
        letterId,
        anchor.paragraphIndex,
        anchor.charOffset
      )
    }

    const cached = readCachedReadingPlace(viewerId, 'letter', letterId)
    if (cached) {
      scrollToAnchor(container, scrollRoot, cached.paragraphIndex, cached.charOffset, 'auto')
      savedResumeRef.current = {
        paragraphIndex: cached.paragraphIndex,
        charOffset: cached.charOffset,
      }
    }

    const onScroll = () => {
      if (localSaveTimer !== null) return
      localSaveTimer = window.setTimeout(() => {
        localSaveTimer = null
        rememberCurrentLocally()
      }, 120)
    }
    scrollTarget.addEventListener('scroll', onScroll, { passive: true })

    getReadingPlaceState(supabase, viewerId, 'letter', letterId).then((state) => {
      if (cancelled) return

      const latestLocal = readCachedReadingPlace(viewerId, 'letter', letterId)
      const serverTimestamp = serverReadingPlaceTimestamp(state)

      if (
        state.resumeParagraphIndex !== null &&
        (!latestLocal || serverTimestamp > latestLocal.updatedAt)
      ) {
        scrollToAnchor(
          container,
          scrollRoot,
          state.resumeParagraphIndex,
          state.resumeCharOffset,
          'auto'
        )
        savedResumeRef.current = {
          paragraphIndex: state.resumeParagraphIndex,
          charOffset: state.resumeCharOffset,
        }
        writeCachedReadingPlace(
          viewerId,
          'letter',
          letterId,
          state.resumeParagraphIndex,
          state.resumeCharOffset
        )
      } else if (
        latestLocal &&
        state.resumeParagraphIndex !== null &&
        serverTimestamp <= latestLocal.updatedAt
      ) {
        // The local device moved more recently than the durable row. Bring
        // cross-device storage forward without delaying or re-scrolling UI.
        void recordReadingProgress(
          supabase,
          viewerId,
          'letter',
          letterId,
          latestLocal.paragraphIndex,
          latestLocal.charOffset
        )
      }

      const interval = window.setInterval(() => {
        const anchor = getCurrentReadingAnchor(container, scrollRoot)
        if (!anchor) return
        const previous = savedResumeRef.current
        if (
          !previous ||
          anchor.paragraphIndex !== previous.paragraphIndex ||
          anchor.charOffset !== previous.charOffset
        ) {
          savedResumeRef.current = anchor
          writeCachedReadingPlace(
            viewerId,
            'letter',
            letterId,
            anchor.paragraphIndex,
            anchor.charOffset
          )
          void recordReadingProgress(
            supabase,
            viewerId,
            'letter',
            letterId,
            anchor.paragraphIndex,
            anchor.charOffset
          )
        }
      }, PROGRESS_SAVE_INTERVAL_MS)

      cleanupRef.current = () => {
        window.clearInterval(interval)
        if (localSaveTimer !== null) {
          window.clearTimeout(localSaveTimer)
          localSaveTimer = null
        }
        const local = rememberCurrentLocally()
        if (local) {
          void recordReadingProgress(
            supabase,
            viewerId,
            'letter',
            letterId,
            local.paragraphIndex,
            local.charOffset
          )
        }
      }
    })

    return () => {
      cancelled = true
      scrollTarget.removeEventListener('scroll', onScroll)
      if (localSaveTimer !== null) window.clearTimeout(localSaveTimer)
      cleanupRef.current?.()
      cleanupRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div ref={containerRef}>
      <LetterBody
        body={body}
        moments={moments}
        photoConsent={photoConsent}
        paragraphAttrs={(index) => ({ 'data-paragraph-index': index })}
        writingStyleId={writingStyleId}
      />
    </div>
  )
}
