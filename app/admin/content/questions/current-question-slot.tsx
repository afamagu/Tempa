'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { editCurrentQuestion, addCurrentQuestion, setQuestionFlagship, type AdminQuestion } from '@/lib/admin-questions'
import { secondaryButtonClass, primaryButtonClass, inputClass, helperTextClass } from '@/app/profile/ui'
import { adminMetadataClass, adminTableTextClass, adminBadgeClass } from '@/app/admin/admin-ui'

const SLOT_LABEL: Record<1 | 2 | 3, string> = { 1: 'QUESTION 1', 2: 'QUESTION 2', 3: 'QUESTION 3' }

/**
 * Flagship Simplification correction — this IS the entire operational
 * Questions surface for one of the three current slots. One card, one
 * "Edit Question" action (the server decides in-place-edit vs.
 * preserved-history replacement — see admin_edit_current_question's
 * own comment), one Flagship radio (native `<input type="radio"
 * name="current-question-flagship">`, grouped across all three slot
 * cards by that shared name — exactly one can ever be checked). No
 * Activate/Deactivate, no "Set as #N"/"Unpin," no replace-with-
 * checkboxes form: the owner should be able to operate the entire
 * Questions system from this one screen in seconds.
 */
export default function CurrentQuestionSlot({
  position,
  question,
}: {
  position: 1 | 2 | 3
  question: AdminQuestion | null
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [prompt, setPrompt] = useState(question?.prompt ?? '')

  async function handleFlagship() {
    if (!question || question.isFlagship) return
    setBusy(true)
    setError(null)
    const { error: actionError } = await setQuestionFlagship(createClient(), question.id)
    setBusy(false)
    if (actionError) {
      setError('Could not change the Flagship Question. Please try again.')
      return
    }
    router.refresh()
  }

  async function handleSave() {
    if (prompt.trim().length === 0) {
      setError('A prompt is required.')
      return
    }
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error: actionError } = question
      ? await editCurrentQuestion(supabase, question.id, prompt)
      : await addCurrentQuestion(supabase, position, prompt)
    setBusy(false)
    if (actionError) {
      setError(actionError.message || 'Could not save this Question. Please try again.')
      return
    }
    setEditing(false)
    router.refresh()
  }

  return (
    <div className="space-y-3 rounded-md border border-foreground/10 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className={adminBadgeClass}>{SLOT_LABEL[position]}</p>
        <label className="flex items-center gap-1.5 text-[14px] text-foreground">
          <input
            type="radio"
            name="current-question-flagship"
            checked={question?.isFlagship ?? false}
            onChange={handleFlagship}
            disabled={!question || busy}
          />
          Flagship
        </label>
      </div>

      {editing ? (
        <div className="space-y-2">
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={3}
            maxLength={2000}
            className={inputClass}
            placeholder="What should members be asked?"
            autoFocus
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setEditing(false)
                setPrompt(question?.prompt ?? '')
                setError(null)
              }}
              disabled={busy}
              className={secondaryButtonClass}
            >
              Cancel
            </button>
            <button type="button" onClick={handleSave} disabled={busy} className={primaryButtonClass}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>
      ) : question ? (
        <div className="space-y-2">
          <p className={adminTableTextClass}>{question.prompt}</p>
          <p className={adminMetadataClass}>
            {question.answerCount} answer{question.answerCount === 1 ? '' : 's'}
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="button" onClick={() => setEditing(true)} className={secondaryButtonClass}>
            Edit Question
          </button>
          {question.answerCount > 0 && (
            <p className={helperTextClass}>
              This Question already has answers — TEMPA will preserve it and create a revised version that takes
              over this slot.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <p className={adminMetadataClass}>No Question set</p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button type="button" onClick={() => setEditing(true)} className={secondaryButtonClass}>
            Add Question
          </button>
        </div>
      )}
    </div>
  )
}
