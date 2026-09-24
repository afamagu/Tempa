'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { getReadingPlaceState, recordReadingProgress } from '@/lib/reading-places'
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
  const savedResumeRef = useRef<{ paragraphIndex: number; charOffset: number | null } | null>(null)
  const cleanupRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    let cancelled = false
    const container = containerRef.current
    if (!container) return

    const supabase = createClient()
    const scrollRoot = findScrollRoot(container)

    getReadingPlaceState(supabase, viewerId, 'letter', letterId).then((state) => {
      if (cancelled) return

      if (state.resumeParagraphIndex !== null) {
        scrollToAnchor(container, scrollRoot, state.resumeParagraphIndex, state.resumeCharOffset, 'auto')
        savedResumeRef.current = {
          paragraphIndex: state.resumeParagraphIndex,
          charOffset: state.resumeCharOffset,
        }
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
        const anchor = getCurrentReadingAnchor(container, scrollRoot)
        const previous = savedResumeRef.current
        if (
          anchor &&
          (!previous ||
            anchor.paragraphIndex !== previous.paragraphIndex ||
            anchor.charOffset !== previous.charOffset)
        ) {
          void recordReadingProgress(
            supabase,
            viewerId,
            'letter',
            letterId,
            anchor.paragraphIndex,
            anchor.charOffset
          )
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

  return (
    <div ref={containerRef}>
      <LetterBody
        body={body}
        moments={moments}
        photoConsent={photoConsent}
        paragraphAttrs={(index) => ({ 'data-paragraph-index': index })}
      />
    </div>
  )
}
