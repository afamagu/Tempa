'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { primaryButtonClass, secondaryButtonClass, helperTextClass, inputClass } from '@/app/profile/ui'

export default function QuestionSuggestionForm() {
  const [open, setOpen] = useState(false)
  const [question, setQuestion] = useState('')
  const [credit, setCredit] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  async function submit() {
    const value = question.trim()
    if (value.length < 10) {
      setError('Write the question you would genuinely like to hear people answer.')
      return
    }
    setBusy(true)
    setError(null)
    const { error: submitError } = await createClient().rpc('submit_room_question_suggestion', {
      p_question: value,
      p_credit_if_used: credit,
    })
    setBusy(false)
    if (submitError) {
      setError(submitError.message || 'Could not send your suggestion. Please try again.')
      return
    }
    setSent(true)
    setQuestion('')
  }

  if (sent) {
    return (
      <div className="border-t border-foreground/10 pt-6">
        <p className="font-serif text-lg text-foreground">Thank you. Tempa will read it.</p>
        <p className={`mt-1 ${helperTextClass}`}>Suggestions are reviewed before they can become a Room Question.</p>
      </div>
    )
  }

  return (
    <section className="border-t border-foreground/10 pt-6">
      <p className="font-serif text-lg text-foreground">Have a question for The Room?</p>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className={`${secondaryButtonClass} mt-3`}>
          Suggest one →
        </button>
      ) : (
        <div className="mt-4 space-y-3">
          <textarea
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            rows={4}
            maxLength={500}
            className={inputClass}
            placeholder="What would you genuinely want to hear different people answer?"
            autoFocus
          />
          <label className="flex items-start gap-2 text-sm text-foreground/75">
            <input type="checkbox" checked={credit} onChange={(event) => setCredit(event.target.checked)} className="mt-1" />
            <span>Credit me if Tempa uses this question.</span>
          </label>
          <p className={helperTextClass}>Tempa may edit the wording before using a suggestion. Suggestions are not published automatically.</p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { setOpen(false); setError(null) }} disabled={busy} className={secondaryButtonClass}>
              Cancel
            </button>
            <button type="button" onClick={submit} disabled={busy} className={primaryButtonClass}>
              {busy ? 'Sending…' : 'Send suggestion'}
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
