'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  sectionLabelClass,
  helperTextClass,
  primaryButtonClass,
  secondaryButtonClass,
  proseSubheadingClass,
  proseBodyClass,
  contextQuestionClass,
} from '@/app/profile/ui'
import {
  questionSaveConfirmationCopy,
  QUESTION_ANSWER_MAX_CHARS,
  type LibraryQuestion,
} from '@/lib/questions'
import { insertAtCursor } from '@/lib/textarea-insert'
import EmojiPicker from '@/app/letters/emoji-picker'

const MAX_CHARS = QUESTION_ANSWER_MAX_CHARS
const CHAR_WARNING_THRESHOLD = 1750

function charLength(text: string) {
  return Array.from(text).length
}

function draftKey(questionId: string, userId: string) {
  return `tempa-question-draft:${questionId}:${userId}`
}

function readDraft(questionId: string, userId: string): string | null {
  if (typeof window === 'undefined') return null
  try { return window.localStorage.getItem(draftKey(questionId, userId)) } catch { return null }
}

export default function QuestionAnswer({
  userId,
  questionId,
  prompt,
  initialAnswer,
  isFlagship = false,
  isActive = true,
  nextQuestion = null,
  onboarding = false,
}: {
  userId: string
  questionId: string
  prompt: string
  initialAnswer: string | null
  isFlagship?: boolean
  isActive?: boolean
  nextQuestion?: LibraryQuestion | null
  onboarding?: boolean
}) {
  const router = useRouter()
  const [mode, setMode] = useState<'view' | 'edit'>(initialAnswer || !isActive ? 'view' : 'edit')
  const [publishedBody, setPublishedBody] = useState(initialAnswer)
  const hadExistingAnswer = initialAnswer !== null
  const [body, setBody] = useState(() => readDraft(questionId, userId) ?? initialAnswer ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState<string | null>(null)

  const charCount = charLength(body)
  const hasContent = body.trim().length > 0
  const aboveMax = charCount > MAX_CHARS
  const canPublish = hasContent && !aboveMax && !saving
  const showCharCount = charCount >= CHAR_WARNING_THRESHOLD
  const hasPublishedView = mode === 'view' && Boolean(publishedBody)
  const promptClass = hasPublishedView ? contextQuestionClass : proseSubheadingClass
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  function updateBody(next: string) {
    setBody(next)
    try { window.localStorage.setItem(draftKey(questionId, userId), next) } catch { /* ignore */ }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    updateBody(e.target.value)
  }

  function insertEmoji(emoji: string) {
    const el = textareaRef.current
    const start = el?.selectionStart ?? body.length
    const end = el?.selectionEnd ?? body.length
    const { value: next, cursor } = insertAtCursor(body, start, end, emoji)
    updateBody(next)
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(cursor, cursor)
    })
  }

  async function handlePublish() {
    if (!canPublish) return
    setSaving(true)
    setError(null)

    const supabase = createClient()
    const trimmed = body.trim()
    const { error: publishError } = await supabase.rpc('publish_question_answer', {
      p_question_id: questionId,
      p_body: trimmed,
    })
    setSaving(false)

    if (publishError) {
      console.error('[question] publish failed', {
        message: publishError.message,
        details: publishError.details,
        hint: publishError.hint,
        code: publishError.code,
      })
      setError(
        'Could not save your answer. Please try again.' +
          (process.env.NODE_ENV === 'development' ? ` (${publishError.message})` : '')
      )
      return
    }

    try { window.localStorage.removeItem(draftKey(questionId, userId)) } catch { /* ignore */ }
    setConfirmation(questionSaveConfirmationCopy(isFlagship, hadExistingAnswer))
    setPublishedBody(trimmed)
    setBody(trimmed)
    setMode('view')
    if (!onboarding) router.refresh()
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-2xl space-y-8 py-10">
        <div className="space-y-3">
          <p className={sectionLabelClass}>The Question</p>
          <h1 className={promptClass}>{prompt}</h1>
        </div>

        {mode === 'view' && publishedBody && onboarding && confirmation ? (
          <div className="space-y-8">
            <div className="space-y-4">
              <h2 className={proseSubheadingClass}>That&rsquo;s your first response.</h2>
              <p className={helperTextClass}>
                This is how people first discover you on Tempa. You can answer the other two whenever you feel like it. For now, there are people to meet.
              </p>
              <div className="rounded-md bg-surface-shell p-4 sm:p-5">
                <p className={`whitespace-pre-wrap ${proseBodyClass}`}>{publishedBody}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/minds" className={primaryButtonClass}>Meet some people</Link>
              {nextQuestion ? (
                <Link href={`/question/${nextQuestion.id}`} className={secondaryButtonClass}>Answer another Question</Link>
              ) : (
                <Link href="/you/responses?tab=new" className={secondaryButtonClass}>Answer another Question</Link>
              )}
            </div>
          </div>
        ) : mode === 'view' && publishedBody ? (
          <div className="space-y-8">
            <div className="space-y-4">
              {confirmation && <p className={helperTextClass}>{confirmation}</p>}
              <p className={helperTextClass}>{isActive ? 'Published' : 'This Question is no longer open'}</p>
              <div className="rounded-md bg-surface-shell p-4 sm:p-5">
                <p className={`whitespace-pre-wrap ${proseBodyClass}`}>{publishedBody}</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/you/responses" className={secondaryButtonClass}>Back to my responses</Link>
              <button
                type="button"
                onClick={() => { setConfirmation(null); setMode('edit') }}
                className={secondaryButtonClass}
              >
                Edit response
              </button>
              {nextQuestion && <Link href={`/question/${nextQuestion.id}`} className={primaryButtonClass}>Next</Link>}
            </div>
          </div>
        ) : mode === 'view' && !isActive ? (
          <div className="space-y-8">
            <p className={helperTextClass}>This Question is no longer open, and you haven&apos;t answered it.</p>
            <Link href="/you/responses" className={secondaryButtonClass}>Back to my responses</Link>
          </div>
        ) : (
          <div className="space-y-4">
            {onboarding && !hadExistingAnswer && (
              <div className="space-y-2 border-l-2 border-clay/50 pl-3">
                <p className="text-[11px] font-semibold uppercase tracking-wider text-clay">One last thing before you meet everyone</p>
                <div className={`italic ${helperTextClass}`}>
                  <p>Tempa gives you three Questions designed to reveal a little more than a profile ever could.</p>
                  <p className="mt-2">Your response to this first Question is how people first discover you on Tempa — and sometimes the beginning of a letter.</p>
                  <p className="mt-2">Start with this one. The other two can wait.</p>
                </div>
              </div>
            )}

            <div className="flex items-center gap-1 border-b border-foreground/10 pb-2">
              <EmojiPicker onSelect={insertEmoji} />
            </div>
            <textarea
              ref={textareaRef}
              value={body}
              onChange={handleChange}
              rows={16}
              placeholder="Begin writing…"
              className="w-full resize-y rounded-md border border-foreground/15 bg-transparent px-4 py-3 font-serif text-lg leading-relaxed outline-none transition-colors placeholder:font-sans placeholder:text-base placeholder:text-muted focus:border-accent"
            />

            {showCharCount && <p className={helperTextClass}>{charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()}</p>}
            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex flex-wrap gap-3">
              {!(onboarding && !hadExistingAnswer) && (
                <Link href="/you/responses" className={secondaryButtonClass}>Back to my responses</Link>
              )}
              <button type="button" onClick={handlePublish} disabled={!canPublish} className={primaryButtonClass}>
                {saving ? 'Saving…' : 'Save response'}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
