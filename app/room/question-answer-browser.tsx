'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { RoomCursor, RoomFilters } from '@/lib/room-reading'
import DiscoveryResults, { type DiscoveryEntry } from './discovery-results'
import { loadRoomAnswers } from './reading-actions'
import { secondaryButtonClass } from '@/app/profile/ui'

export default function QuestionAnswerBrowser({ questionId, initial, filters, returnTo }: {
  questionId: string; initial: { entries: DiscoveryEntry[]; cursor: RoomCursor | null; hasMore: boolean; error: string | null }; filters: RoomFilters; returnTo: string
}) {
  const [page, setPage] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [automaticUsed, setAutomaticUsed] = useState(false)
  const sentinel = useRef<HTMLDivElement>(null)
  const inFlight = useRef(false)
  const automaticConsumed = useRef(false)
  const more = useCallback(async (automatic = false) => {
    if (inFlight.current || (!page.hasMore && !page.error)) return
    if (automatic && automaticConsumed.current) return
    automaticConsumed.current = true
    inFlight.current = true; setBusy(true)
    if (automatic) setAutomaticUsed(true)
    try {
      const next = await loadRoomAnswers(questionId, page.cursor, filters, page.entries.length < 6 ? 3 : 6)
      if (next.error) { setPage(p => ({ ...p, error: next.error })); return }
      setPage(p => {
        const existing = new Set(p.entries.map(e => e.response.id))
        return { ...next, entries: [...p.entries, ...next.entries.filter(e => !existing.has(e.response.id))] }
      })
    } catch { setPage(p => ({ ...p, error: 'Could not load more answers. Please try again.' })) }
    finally { inFlight.current = false; setBusy(false) }
  }, [questionId, page.cursor, page.hasMore, page.error, page.entries.length, filters])
  useEffect(() => {
    if (automaticUsed || !page.hasMore || !sentinel.current || !('IntersectionObserver' in window)) return
    const observer = new IntersectionObserver(entries => { if (entries.some(e => e.isIntersecting)) void more(true) }, { threshold: 1 })
    observer.observe(sentinel.current)
    return () => observer.disconnect()
  }, [automaticUsed, page.hasMore, more])
  return <div className="space-y-5">
    <DiscoveryResults entries={page.entries} returnTo={returnTo} questionReading />
    {page.error && <p role="alert" className="text-sm text-red-600">{page.error}</p>}
    {page.entries.length === 0 && !page.error && <p className="text-sm text-foreground/60">No answers yet. There is room for yours.</p>}
    {!automaticUsed && <div ref={sentinel} aria-hidden="true" className="h-px" />}
    {(page.hasMore || page.error) && <button type="button" disabled={busy} onClick={() => { setAutomaticUsed(true); void more() }} className={secondaryButtonClass}>{busy ? 'Loading…' : 'See more answers'}</button>}
  </div>
}
