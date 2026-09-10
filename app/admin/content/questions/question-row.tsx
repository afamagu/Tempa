'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { setQuestionActive, updateQuestionPrompt, type AdminQuestion } from '@/lib/admin-questions'
import { helperTextClass, secondaryButtonClass, destructiveButtonClass, inputClass } from '@/app/profile/ui'

/**
 * One canonical Question's admin row — Activate/Deactivate is always
 * available; Edit is only ever offered when answerCount is 0, and says
 * exactly why when it isn't (never a silently-disabled control with no
 * explanation). The LOCKED immutability rule is enforced server-side
 * regardless (admin_update_question_prompt) — this UI gate is a
 * courtesy, not the actual boundary.
 */
export default function QuestionRow({ question }: { question: AdminQuestion }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [prompt, setPrompt] = useState(question.prompt)

  const canEdit = question.answerCount === 0

  async function toggleActive() {
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error: actionError } = await setQuestionActive(supabase, question.id, !question.isActive)
    setBusy(false)
    if (actionError) {
      setError('Could not update this Question. Please try again.')
      return
    }
    router.refresh()
  }

  async function saveEdit() {
    if (prompt.trim().length === 0) {
      setError('A prompt is required.')
      return
    }
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error: actionError } = await updateQuestionPrompt(supabase, question.id, prompt)
    setBusy(false)
    if (actionError) {
      setError('Could not save this prompt. Please try again.')
      return
    }
    setEditing(false)
    router.refresh()
  }

  return (
    <div className="space-y-2 rounded-md border border-foreground/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={helperTextClass}>{question.slug}</p>
          {editing ? (
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              maxLength={2000}
              className={`mt-1 ${inputClass}`}
            />
          ) : (
            <p className="mt-0.5 text-[15px] text-foreground">{question.prompt}</p>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[12px] font-medium ${
            question.isActive ? 'bg-accent/10 text-accent' : 'bg-foreground/[.06] text-foreground/60'
          }`}
        >
          {question.isActive ? 'Active' : 'Inactive'}
        </span>
      </div>

      <p className={helperTextClass}>
        {question.answerCount} answer{question.answerCount === 1 ? '' : 's'} · {question.firstLetterCount} first
        letter{question.firstLetterCount === 1 ? '' : 's'} generated
      </p>

      {!canEdit && !editing && (
        <p className={helperTextClass}>
          Prompt is locked — this Question already has {question.answerCount} answer
          {question.answerCount === 1 ? '' : 's'}. Different wording requires a new Question.
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={toggleActive} disabled={busy} className={secondaryButtonClass}>
          {busy ? 'Working…' : question.isActive ? 'Deactivate' : 'Activate'}
        </button>
        {canEdit &&
          (editing ? (
            <>
              <button
                type="button"
                onClick={() => {
                  setEditing(false)
                  setPrompt(question.prompt)
                  setError(null)
                }}
                disabled={busy}
                className={secondaryButtonClass}
              >
                Cancel
              </button>
              <button type="button" onClick={saveEdit} disabled={busy} className={destructiveButtonClass}>
                {busy ? 'Saving…' : 'Save prompt'}
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setEditing(true)} className={secondaryButtonClass}>
              Edit prompt
            </button>
          ))}
      </div>
    </div>
  )
}
