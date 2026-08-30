'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  sectionLabelClass,
  helperTextClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '@/app/profile/ui'

const MAX_CHARS = 2000
const CHAR_WARNING_THRESHOLD = 1750

function charLength(text: string) {
  // Counts Unicode code points rather than UTF-16 code units, so
  // characters like emoji don't get counted twice.
  return Array.from(text).length
}

function draftKey(questionId: string, userId: string) {
  return `tempa-question-draft:${questionId}:${userId}`
}

function readDraft(questionId: string, userId: string): string | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage.getItem(draftKey(questionId, userId))
  } catch {
    return null
  }
}

export default function QuestionAnswer({
  userId,
  questionId,
  prompt,
  initialAnswer,
  isActive = true,
}: {
  userId: string
  questionId: string
  prompt: string
  initialAnswer: string | null
  isActive?: boolean
}) {
  const router = useRouter()

  const [mode, setMode] = useState<'view' | 'edit'>(
    initialAnswer || !isActive ? 'view' : 'edit'
  )
  const [publishedBody, setPublishedBody] = useState(initialAnswer)
  const [body, setBody] = useState(
    () => readDraft(questionId, userId) ?? initialAnswer ?? ''
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const charCount = charLength(body)
  const hasContent = body.trim().length > 0
  const aboveMax = charCount > MAX_CHARS
  const canPublish = hasContent && !aboveMax && !saving
  const showCharCount = charCount >= CHAR_WARNING_THRESHOLD

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const next = e.target.value
    setBody(next)
    try {
      window.localStorage.setItem(draftKey(questionId, userId), next)
    } catch {
      // ignore storage failures (e.g. private browsing quota)
    }
  }

  async function handlePublish() {
    if (!canPublish) return

    setSaving(true)
    setError(null)

    const supabase = createClient()
    const trimmed = body.trim()

    // A member has exactly one current discovery answer at a time. Demote
    // any other row of theirs before promoting this one, so the partial
    // unique index on question_answers(user_id) where is_current never
    // sees two rows marked current at once.
    const { error: demoteError } = await supabase
      .from('question_answers')
      .update({ is_current: false })
      .eq('user_id', userId)
      .neq('question_id', questionId)

    if (demoteError) {
      setSaving(false)
      console.error('[question] demote previous answer failed', {
        message: demoteError.message,
        code: demoteError.code,
      })
      setError('Could not save your answer. Please try again.')
      return
    }

    const { error: saveError } = await supabase
      .from('question_answers')
      .upsert(
        {
          user_id: userId,
          question_id: questionId,
          body: trimmed,
          is_current: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,question_id' }
      )

    setSaving(false)

    if (saveError) {
      console.error('[question] save failed', {
        message: saveError.message,
        details: saveError.details,
        hint: saveError.hint,
        code: saveError.code,
      })
      setError(
        'Could not save your answer. Please try again.' +
          (process.env.NODE_ENV === 'development'
            ? ` (${saveError.message})`
            : '')
      )
      return
    }

    try {
      window.localStorage.removeItem(draftKey(questionId, userId))
    } catch {
      // ignore
    }

    setPublishedBody(trimmed)
    setBody(trimmed)
    setMode('view')
    router.refresh()
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-2xl space-y-8 py-10">
        <div className="space-y-3">
          <p className={sectionLabelClass}>The Question</p>
          <h1 className="text-xl font-semibold leading-snug">{prompt}</h1>
        </div>

        {mode === 'view' && publishedBody ? (
          <div className="space-y-8">
            <div className="space-y-4">
              <p className={helperTextClass}>
                {isActive ? 'Published' : 'This Question is no longer open'}
              </p>
              <p className="whitespace-pre-wrap text-base leading-relaxed">
                {publishedBody}
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/question" className={secondaryButtonClass}>
                Back to Questions
              </Link>
              {isActive && (
                <button
                  type="button"
                  onClick={() => setMode('edit')}
                  className={secondaryButtonClass}
                >
                  Edit answer
                </button>
              )}
            </div>
          </div>
        ) : mode === 'view' && !isActive ? (
          <div className="space-y-8">
            <p className={helperTextClass}>
              This Question is no longer open, and you haven&apos;t answered it.
            </p>
            <Link href="/question" className={secondaryButtonClass}>
              Back to Questions
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <textarea
              value={body}
              onChange={handleChange}
              rows={16}
              placeholder="Begin writing…"
              className="w-full resize-y rounded-md border border-black/10 dark:border-white/20 bg-transparent px-4 py-3 text-base leading-relaxed outline-none focus:border-black/30 dark:focus:border-white/40"
            />

            {showCharCount && (
              <p className={helperTextClass}>
                {charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()}
              </p>
            )}
            {error && (
              <p className="text-sm text-red-600 dark:text-red-400">
                {error}
              </p>
            )}

            <div className="flex flex-wrap gap-3">
              <Link href="/question" className={secondaryButtonClass}>
                Back to Questions
              </Link>
              <button
                type="button"
                onClick={handlePublish}
                disabled={!canPublish}
                className={primaryButtonClass}
              >
                {saving ? 'Saving…' : 'Publish answer'}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
