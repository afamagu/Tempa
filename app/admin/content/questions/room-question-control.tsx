'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { makeCurrentRoomQuestion, type AdminQuestion } from '@/lib/admin-questions'
import { primaryButtonClass, secondaryButtonClass } from '@/app/profile/ui'
import { adminBadgeClass, adminMetadataClass, adminTableTextClass } from '@/app/admin/admin-ui'

export default function RoomQuestionControl({
  current,
  candidates,
}: {
  current: AdminQuestion | null
  candidates: AdminQuestion[]
}) {
  const router = useRouter()
  const [selectedId, setSelectedId] = useState(current?.id ?? candidates[0]?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function makeCurrent() {
    if (!selectedId || selectedId === current?.id) return
    setBusy(true)
    setError(null)
    const { error: actionError } = await makeCurrentRoomQuestion(createClient(), selectedId)
    setBusy(false)
    if (actionError) {
      setError(actionError.message || 'Could not change the current Room Question.')
      return
    }
    router.refresh()
  }

  return (
    <section className="space-y-3 rounded-md border border-foreground/10 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className={adminBadgeClass}>THE ROOM</p>
        {current ? (
          <span className="text-xs text-foreground/55">Current</span>
        ) : (
          <span className="text-xs font-medium text-red-600">Needs a current Question</span>
        )}
      </div>

      {current ? (
        <div className="space-y-1">
          <p className={adminTableTextClass}>{current.prompt}</p>
          <p className={adminMetadataClass}>{current.answerCount} answer{current.answerCount === 1 ? '' : 's'}</p>
        </div>
      ) : (
        <p className={adminMetadataClass}>Members will not see a weekly Room Question until one is selected.</p>
      )}

      {candidates.length > 0 && (
        <div className="space-y-2">
          <label className="block text-xs font-medium uppercase tracking-wider text-foreground/55" htmlFor="room-question-select">
            Choose an active Question
          </label>
          <select
            id="room-question-select"
            value={selectedId}
            onChange={(event) => setSelectedId(event.target.value)}
            disabled={busy}
            className="w-full rounded-md border border-foreground/15 bg-background px-3 py-2 text-sm text-foreground"
          >
            {candidates.map((question) => (
              <option key={question.id} value={question.id}>{question.prompt}</option>
            ))}
          </select>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={primaryButtonClass}
              disabled={busy || !selectedId || selectedId === current?.id}
              onClick={makeCurrent}
            >
              {busy ? 'Changing…' : 'Make this the current Room Question'}
            </button>
            {current && selectedId !== current.id && (
              <button type="button" className={secondaryButtonClass} onClick={() => setSelectedId(current.id)} disabled={busy}>
                Keep current
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
