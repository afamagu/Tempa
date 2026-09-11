'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { setQuestionActive, updateQuestionPrompt, replaceQuestion, type AdminQuestion } from '@/lib/admin-questions'
import { helperTextClass, secondaryButtonClass, destructiveButtonClass, inputClass } from '@/app/profile/ui'
import { adminMetadataClass, adminTableTextClass } from '@/app/admin/admin-ui'
import { formatDateTimeFull } from '@/lib/format-date'

/**
 * One Question's admin row. Actions are context-aware:
 *  - 0 answers: Edit prompt, Activate/Deactivate.
 *  - >= 1 answer: Replace (creates a new Question, preserves this one
 *    and every historical answer untouched), Activate/Deactivate.
 * The LOCKED immutability rule (a Question with >= 1 answer can never
 * have its prompt edited in place) is enforced server-side regardless
 * (admin_update_question_prompt/admin_replace_question) — this UI gate
 * is a courtesy, not the actual boundary.
 */
export default function QuestionRow({ question }: { question: AdminQuestion }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [prompt, setPrompt] = useState(question.prompt)
  const [replacing, setReplacing] = useState(false)
  const [replacementPrompt, setReplacementPrompt] = useState('')
  const [deactivateOld, setDeactivateOld] = useState(true)
  // Mirrors the OLD Question's current active state by default — the
  // operationally intuitive default (Question source-of-truth
  // correction, Section 3): replacing a live, active Question should
  // make the revision take over immediately. The admin may uncheck
  // this to explicitly stage the replacement inactive instead.
  const [makeReplacementActive, setMakeReplacementActive] = useState(question.isActive)

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

  async function saveReplacement() {
    if (replacementPrompt.trim().length === 0) {
      setError('A prompt is required.')
      return
    }
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error: actionError } = await replaceQuestion(supabase, question.id, replacementPrompt, {
      newActive: makeReplacementActive,
      deactivateOld,
    })
    setBusy(false)
    if (actionError) {
      setError('Could not create the replacement Question. Please try again.')
      return
    }
    setReplacing(false)
    setReplacementPrompt('')
    router.refresh()
  }

  return (
    <div className="space-y-2 rounded-md border border-foreground/10 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className={adminMetadataClass}>
            {question.slug ?? 'Not yet offered to members'}
            {question.family ? ` · ${question.family}` : ''}
          </p>
          {editing ? (
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              maxLength={2000}
              className={`mt-1 ${inputClass}`}
            />
          ) : (
            <p className={`mt-0.5 ${adminTableTextClass}`}>{question.prompt}</p>
          )}
        </div>
        <span
          className={`shrink-0 rounded-full px-2 py-0.5 text-[14px] font-medium ${
            question.isActive ? 'bg-accent/10 text-accent' : 'bg-foreground/[.06] text-foreground/60'
          }`}
        >
          {question.isActive ? 'Active' : 'Inactive'}
        </span>
      </div>

      <p className={adminMetadataClass}>
        {question.answerCount} answer{question.answerCount === 1 ? '' : 's'} · {question.firstLetterCount} first
        letter{question.firstLetterCount === 1 ? '' : 's'} generated
        {question.createdAt ? ` · created ${formatDateTimeFull(question.createdAt)}` : ''}
      </p>

      {!canEdit && !editing && !replacing && (
        <p className={helperTextClass}>
          This Question already has answers. TEMPA will preserve the original Question and create a revised
          version.
        </p>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {replacing ? (
        <div className="space-y-2 rounded-md border border-foreground/10 bg-surface-shell p-3">
          <label className={helperTextClass} htmlFor={`replace-${question.id}`}>
            Revised prompt (creates a new Question; this one and its answers are preserved)
          </label>
          <textarea
            id={`replace-${question.id}`}
            value={replacementPrompt}
            onChange={(e) => setReplacementPrompt(e.target.value)}
            rows={3}
            maxLength={2000}
            className={inputClass}
            placeholder="Revised wording…"
          />
          <label className="flex items-center gap-2 text-[14px] text-foreground">
            <input type="checkbox" checked={deactivateOld} onChange={(e) => setDeactivateOld(e.target.checked)} />
            Deactivate this Question as part of the replacement
          </label>
          <label className="flex items-center gap-2 text-[14px] text-foreground">
            <input
              type="checkbox"
              checked={makeReplacementActive}
              onChange={(e) => setMakeReplacementActive(e.target.checked)}
            />
            Make the replacement active immediately
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                setReplacing(false)
                setReplacementPrompt('')
                setError(null)
              }}
              disabled={busy}
              className={secondaryButtonClass}
            >
              Cancel
            </button>
            <button type="button" onClick={saveReplacement} disabled={busy} className={destructiveButtonClass}>
              {busy ? 'Creating…' : 'Create replacement Question'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={toggleActive} disabled={busy} className={secondaryButtonClass}>
            {busy ? 'Working…' : question.isActive ? 'Deactivate' : 'Activate'}
          </button>
          {canEdit ? (
            editing ? (
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
            )
          ) : (
            <button type="button" onClick={() => setReplacing(true)} className={secondaryButtonClass}>
              Replace
            </button>
          )}
        </div>
      )}
    </div>
  )
}
