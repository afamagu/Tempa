'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  updateRoomQuestionSuggestion,
  type AdminRoomQuestionSuggestion,
  type RoomQuestionSuggestionStatus,
} from '@/lib/admin-room-question-suggestions'
import Link from 'next/link'
import { primaryButtonClass, inputClass, secondaryButtonClass } from '@/app/profile/ui'
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
  const [preview, setPreview] = useState(false)
  const [prompt, setPrompt] = useState(suggestion.proposedQuestion)
  const [notes, setNotes] = useState(suggestion.editorialNotes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setBusy(true)
    setError(null)
    const { error: actionError } = await updateRoomQuestionSuggestion(
      createClient(), suggestion.id, status, notes, suggestion.publishedQuestionId
    )
    setBusy(false)
    if (actionError) {
      setError(actionError.message || 'Could not update this suggestion.')
      return
    }
    router.refresh()
  }

  async function action(name: string, args: Record<string, unknown>) {
    if (busy) return
    setBusy(true); setError(null)
    try {
      const { error } = await createClient().rpc(name, args)
      if (error) setError(error.message)
      else { setPreview(false); router.refresh() }
    } catch { setError('Could not update this question. Please try again.') } finally { setBusy(false) }
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
      {suggestion.withdrawn ? <p className={adminMetadataClass}>Withdrawn by its author.</p> : suggestion.publishedQuestionId ? <Link className={secondaryButtonClass} href={`/question/${suggestion.publishedQuestionId}`}>View selected question</Link> : <button disabled={busy} className={secondaryButtonClass} onClick={() => setPreview(!preview)}>Preview for the Room</button>}
      {preview && !suggestion.withdrawn && !suggestion.publishedQuestionId && <div className="space-y-3 border-t border-foreground/10 pt-4">
        <p className={adminMetadataClass}>This week in the Room</p>
        <label className="block space-y-2"><span>Final question</span><textarea className={inputClass} rows={3} maxLength={500} value={prompt} onChange={e => setPrompt(e.target.value)} /></label>
        <p className={adminMetadataClass}>{suggestion.creditIfUsed ? `A question from ${suggestion.pseudonymSnapshot ?? 'this member'} — their current name and Mark will appear.` : 'No member attribution will appear.'}</p>
        <p className={adminMetadataClass}>Selection makes this the current Room question and approves its profile publication. The Flagship question stays in place.</p>
        <button className={primaryButtonClass} disabled={busy || [...prompt.trim()].length < 10} onClick={() => void action('admin_select_member_question', { p_suggestion_id: suggestion.id, p_prompt: prompt.trim() })}>{busy ? 'Selecting…' : 'Select as the Room question'}</button>
      </div>}
      {suggestion.memberQuestionId && !suggestion.withdrawn && <div className="flex flex-wrap gap-3">
        <span className={adminMetadataClass}>Profile: {suggestion.moderationStatus}</span>
        <button className={secondaryButtonClass} disabled={busy} onClick={() => void action('admin_review_member_question', { p_id: suggestion.memberQuestionId, p_status: suggestion.moderationStatus === 'visible' ? 'hidden' : 'visible' })}>{suggestion.moderationStatus === 'visible' ? 'Hide on profile' : 'Approve for profile'}</button>
      </div>}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  )
}
