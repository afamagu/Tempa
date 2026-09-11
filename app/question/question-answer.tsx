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
  isPositionOne = false,
  isActive = true,
  nextQuestion = null,
}: {
  userId: string
  questionId: string
  prompt: string
  initialAnswer: string | null
  /** Question Slots checkpoint — whether THIS Question currently holds
   * position #1, the permanent flagship. The confirmation copy for a
   * member's very first save here is the only save ever announced as
   * "now your primary Minds answer" (lib/questions.ts's
   * questionSaveConfirmationCopy) — deliberately never based on
   * is_current, which no longer determines Minds primary-answer
   * status under the new model. */
  isPositionOne?: boolean
  isActive?: boolean
  /** The next currently-eligible Question (positioned, unanswered by
   * this member), or null when none remain — computed server-side
   * (lib/questions.ts's nextEligibleQuestion). Only ever offered once
   * there's a saved answer to show (never during active editing, so
   * Next can't discard unsaved text). */
  nextQuestion?: LibraryQuestion | null
}) {
  const router = useRouter()

  const [mode, setMode] = useState<'view' | 'edit'>(
    initialAnswer || !isActive ? 'view' : 'edit'
  )
  const [publishedBody, setPublishedBody] = useState(initialAnswer)
  const hadExistingAnswer = initialAnswer !== null
  const [body, setBody] = useState(
    () => readDraft(questionId, userId) ?? initialAnswer ?? ''
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Set only immediately after a successful save this visit — never
  // restored from a page load, so a member who saved earlier and comes
  // back later just sees their answer, not a stale "Answer saved."
  const [confirmation, setConfirmation] = useState<string | null>(null)

  const charCount = charLength(body)
  const hasContent = body.trim().length > 0
  const aboveMax = charCount > MAX_CHARS
  const canPublish = hasContent && !aboveMax && !saving
  const showCharCount = charCount >= CHAR_WARNING_THRESHOLD
  // Editing/choosing a Question: the prompt is the writing instruction,
  // reasonably prominent since there's no answer yet to compete with.
  // Viewing a published answer: the answer is the content now, so the
  // Question steps back to a subordinate, contextual size.
  const hasPublishedView = mode === 'view' && Boolean(publishedBody)
  const promptClass = hasPublishedView ? contextQuestionClass : proseSubheadingClass

  const textareaRef = useRef<HTMLTextAreaElement | null>(null)

  function updateBody(next: string) {
    setBody(next)
    try {
      window.localStorage.setItem(draftKey(questionId, userId), next)
    } catch {
      // ignore storage failures (e.g. private browsing quota)
    }
  }

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    updateBody(e.target.value)
  }

  // Intentionally plain-textarea insertion, not a Tiptap command — the
  // Question editor stays plain text (see this component's own
  // rationale in docs/tempa-build-guide.md's writing-essentials
  // section); emoji are still Unicode characters either way, so a
  // manual selectionStart/selectionEnd splice is all "insert at the
  // cursor" needs here. Cursor restoration happens after React commits
  // the new value, since the DOM textarea's own selection would
  // otherwise reset to the end on re-render.
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

    // publish_question_answer's own is_current promotion logic still
    // runs server-side unchanged (kept for backward compatibility —
    // see lib/questions.ts's own header discussion), but this
    // component no longer reads or displays it: primary-answer status
    // is entirely a function of Question position now, computed below
    // from isPositionOne alone.
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
          (process.env.NODE_ENV === 'development'
            ? ` (${publishError.message})`
            : '')
      )
      return
    }

    try {
      window.localStorage.removeItem(draftKey(questionId, userId))
    } catch {
      // ignore
    }

    setConfirmation(questionSaveConfirmationCopy(isPositionOne, hadExistingAnswer))

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
          <h1 className={promptClass}>{prompt}</h1>
        </div>

        {mode === 'view' && publishedBody ? (
          <div className="space-y-8">
            <div className="space-y-4">
              {confirmation && <p className={helperTextClass}>{confirmation}</p>}
              <p className={helperTextClass}>
                {isActive ? 'Published' : 'This Question is no longer open'}
              </p>
              <div className="rounded-md bg-surface-shell p-4 sm:p-5">
                <p className={`whitespace-pre-wrap ${proseBodyClass}`}>
                  {publishedBody}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/minds?view=answers" className={secondaryButtonClass}>
                Back to my answers
              </Link>
              {/* Editable regardless of isActive: "no longer open" governs
                  whether a NEW answer can be started, not whether a
                  member may keep editing their own already-published
                  writing — old answers remain permanently editable. */}
              <button
                type="button"
                onClick={() => {
                  setConfirmation(null)
                  setMode('edit')
                }}
                className={secondaryButtonClass}
              >
                Edit answer
              </button>
              {/* Only reachable once there's a saved answer on screen —
                  never during active editing, so Next can never discard
                  unsaved text. */}
              {nextQuestion && (
                <Link href={`/question/${nextQuestion.id}`} className={primaryButtonClass}>
                  Next
                </Link>
              )}
            </div>
          </div>
        ) : mode === 'view' && !isActive ? (
          <div className="space-y-8">
            <p className={helperTextClass}>
              This Question is no longer open, and you haven&apos;t answered it.
            </p>
            <Link href="/minds?view=answers" className={secondaryButtonClass}>
              Back to my answers
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
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

            {showCharCount && (
              <p className={helperTextClass}>
                {charCount.toLocaleString()} / {MAX_CHARS.toLocaleString()}
              </p>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex flex-wrap gap-3">
              <Link href="/minds?view=answers" className={secondaryButtonClass}>
                Back to my answers
              </Link>
              <button
                type="button"
                onClick={handlePublish}
                disabled={!canPublish}
                className={primaryButtonClass}
              >
                {saving ? 'Saving…' : 'Save answer'}
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  )
}
