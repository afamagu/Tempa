'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { createQuestion } from '@/lib/admin-questions'
import { secondaryButtonClass, primaryButtonClass, inputClass, helperTextClass, fieldLabelClass } from '@/app/profile/ui'

/**
 * Creates a brand new, inactive, non-canonical Question. This does NOT
 * make it live to members — see lib/admin-questions.ts's own doc
 * comment for why. Collapsed by default so Questions still reads as an
 * operational list first, not a form.
 */
export default function CreateQuestionForm() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [prompt, setPrompt] = useState('')
  const [family, setFamily] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className={secondaryButtonClass}>
        Create Question
      </button>
    )
  }

  async function handleCreate() {
    if (prompt.trim().length === 0) {
      setError('A prompt is required.')
      return
    }
    setBusy(true)
    setError(null)
    const supabase = createClient()
    const { error: actionError } = await createQuestion(supabase, prompt, family)
    setBusy(false)
    if (actionError) {
      setError('Could not create this Question. Please try again.')
      return
    }
    setOpen(false)
    setPrompt('')
    setFamily('')
    router.refresh()
  }

  return (
    <div className="space-y-3 rounded-md border border-foreground/10 p-4">
      <div>
        <label className={fieldLabelClass} htmlFor="new-question-prompt">
          Prompt
        </label>
        <textarea
          id="new-question-prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          maxLength={2000}
          className={`mt-1 ${inputClass}`}
          placeholder="What should members be asked?"
        />
      </div>
      <div>
        <label className={fieldLabelClass} htmlFor="new-question-family">
          Family / category (optional)
        </label>
        <input
          id="new-question-family"
          type="text"
          value={family}
          onChange={(e) => setFamily(e.target.value)}
          className={`mt-1 ${inputClass}`}
          placeholder="e.g. place, ritual, values"
        />
      </div>
      <p className={helperTextClass}>
        New Questions start inactive and are not yet offered to members — activate one only when it&rsquo;s ready.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            setPrompt('')
            setFamily('')
            setError(null)
          }}
          disabled={busy}
          className={secondaryButtonClass}
        >
          Cancel
        </button>
        <button type="button" onClick={handleCreate} disabled={busy} className={primaryButtonClass}>
          {busy ? 'Creating…' : 'Create Question'}
        </button>
      </div>
    </div>
  )
}
