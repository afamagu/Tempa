'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { recordDispatchProgress, type DispatchMoment } from '@/lib/dispatches'
import { splitParagraphs } from '@/lib/moments'
import { stripRichBodyMarker } from '@/lib/letter-editor-doc'
import DispatchBody from '../dispatch-body'

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

  return (
    <div ref={containerRef}>
      <DispatchBody body={body} moments={moments} paragraphAttrs={(index) => ({ 'data-paragraph-index': index })} />
    </div>
  )
}
