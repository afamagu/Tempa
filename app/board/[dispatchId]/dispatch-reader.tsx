'use client'

import { useEffect, useRef } from 'react'
import { createClient } from '@/lib/supabase/client'
import { recordDispatchProgress, type DispatchMoment } from '@/lib/dispatches'
import { splitParagraphs } from '@/lib/moments'
import { stripRichBodyMarker } from '@/lib/letter-editor-doc'
import DispatchBody from '../dispatch-body'

const PROGRESS_SAVE_INTERVAL_MS = 4000

/**
 * Automatic reading position — no visible bookmark/ribbon workflow.
 * An IntersectionObserver tracks the highest-index paragraph already
 * passed near the top of the viewport. Progress is persisted on an
 * interval and on unmount, then restored on the next visit.
 *
 * Dispatches keep using their already-shipped dispatch_views storage;
 * the separate reading_places table is needed only for Letter resume.
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
