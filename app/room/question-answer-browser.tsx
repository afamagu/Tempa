'use client'

import { useState } from 'react'
import type { RoomFilters } from '@/lib/room-reading'
import DiscoveryResults, { type DiscoveryEntry } from './discovery-results'
import { loadRoomAnswers } from './reading-actions'
import { secondaryButtonClass } from '@/app/profile/ui'

export default function QuestionAnswerBrowser({
  questionId,
  initial,
  filters,
  returnTo,
  viewerId,
}: {
  viewerId?: string
  questionId: string
  initial: {
    entries: DiscoveryEntry[]
    shownUserIds: string[]
    hasMore: boolean
    error: string | null
  }
  filters: RoomFilters
  returnTo: string
}) {
  const [page, setPage] = useState(initial)
  const [busy, setBusy] = useState(false)

  async function more() {
    if (busy || (!page.hasMore && !page.error)) return
    setBusy(true)
    try {
      const next = await loadRoomAnswers(questionId, page.shownUserIds, filters, 6)
      if (next.error) {
        setPage((previous) => ({ ...previous, error: next.error }))
        return
      }

      setPage((previous) => {
        const existing = new Set(previous.entries.map((entry) => entry.userId))
        return {
          ...next,
          entries: [
            ...previous.entries,
            ...next.entries.filter((entry) => !existing.has(entry.userId)),
          ],
        }
      })
    } catch {
      setPage((previous) => ({
        ...previous,
        error: 'Could not load more answers. Please try again.',
      }))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <DiscoveryResults
        entries={page.entries}
        returnTo={returnTo}
        viewerId={viewerId}
        questionReading
      />

      {page.error && (
        <p role="alert" className="text-sm text-red-600">
          {page.error}
        </p>
      )}

      {page.entries.length === 0 && !page.error && (
        <p className="text-sm text-foreground/60">
          No answers yet. There is room for yours.
        </p>
      )}

      {(page.hasMore || page.error) && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void more()}
          className={secondaryButtonClass}
        >
          {busy ? 'Looking…' : 'Keep looking'}
        </button>
      )}
    </div>
  )
}
