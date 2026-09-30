'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  updateRoomQuestionSuggestion,
  type AdminRoomQuestionSuggestion,
  type RoomQuestionSuggestionStatus,
} from '@/lib/admin-room-question-suggestions'
import { secondaryButtonClass } from '@/app/profile/ui'
import { adminBadgeClass, adminMetadataClass, adminTableTextClass } from '@/app/admin/admin-ui'

const STATUSES: RoomQuestionSuggestionStatus[] = ['pending', 'shortlisted', 'scheduled', 'declined', 'used']

export default function SuggestionQueue({ suggestions }: { suggestions: AdminRoomQuestionSuggestion[] }) {
  if (suggestions.length === 0) {
    return <p className={adminMetadataClass}>No member suggestions yet.</p>
  }

  return (
    <div className="space-y-3">
      {suggestions.map((suggestion) => <SuggestionRow key={suggestion.id} suggestion={suggestion} />)}
    </div>
  )
}

function SuggestionRow({ suggestion }: { suggestion: AdminRoomQuestionSuggestion }) {
  const router = useRouter()
  const [status, setStatus] = useState<RoomQuestionSuggestionStatus>(suggestion.status)
  const [notes, setNotes] = useState(suggestion.editorialNotes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    const { error: actionError } = await updateRoomQuestionSuggestion(
      createClient(), suggestion.id, status, notes
    )
    setBusy(false)
    if (actionError) {
      setError(actionError.message || 'Could not update this suggestion.')
      return
    }
    router.refresh()
  }

  return (
    <div className="space-y-3 rounded-md border border-foreground/10 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={adminBadgeClass}>{suggestion.status.toUpperCase()}</span>
        {suggestion.creditIfUsed && suggestion.pseudonymSnapshot && (
          <span className={adminMetadataClass}>Credit requested: {suggestion.pseudonymSnapshot}</span>
        )}
      </div>
      <p className={adminTableTextClass}>{suggestion.proposedQuestion}</p>
      <div className="grid gap-3 sm:grid-cols-[180px_1fr_auto] sm:items-end">
        <label className="space-y-1 text-xs font-medium uppercase tracking-wider text-foreground/55">
          Status
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value as RoomQuestionSuggestionStatus)}
            className="mt-1 w-full rounded-md border border-foreground/15 bg-background px-3 py-2 text-sm normal-case tracking-normal text-foreground"
          >
            {STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="space-y-1 text-xs font-medium uppercase tracking-wider text-foreground/55">
          Editorial note
          <input
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            maxLength={1000}
            className="mt-1 w-full rounded-md border border-foreground/15 bg-background px-3 py-2 text-sm normal-case tracking-normal text-foreground"
            placeholder="Private"
          />
        </label>
        <button type="button" onClick={save} disabled={busy} className={secondaryButtonClass}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
