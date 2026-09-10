'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  helperTextClass,
  quietLinkClass,
  proseHeadingClass,
  proseBodyClass,
  contextQuestionClass,
  compactSecondaryButtonClass,
} from '@/app/profile/ui'
import { formatDatePlain } from '@/lib/format-date'
import type { CanonicalQuestionState } from '@/lib/questions'

function excerpt(text: string, maxChars = 240) {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed
  const cut = trimmed.slice(0, maxChars)
  const lastSpace = cut.lastIndexOf(' ')
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : maxChars)}…`
}

// QUESTION + DATE: system/context styling, outside the writing surface.
// ANSWER: darker inset human-writing surface. Same grammar as a letter.
function AnsweredQuestionRow({ state }: { state: CanonicalQuestionState & { answer: NonNullable<CanonicalQuestionState['answer']> } }) {
  const router = useRouter()
  const [settingCurrent, setSettingCurrent] = useState(false)
  const { answer } = state

  async function showInMinds() {
    setSettingCurrent(true)
    const supabase = createClient()
    const { error } = await supabase.rpc('set_current_answer', { p_answer_id: answer.id })
    setSettingCurrent(false)
    if (!error) router.refresh()
  }

  return (
    <div className="border-b border-foreground/10 py-6 first:pt-0 last:border-b-0">
      <Link href={`/question/${state.id}`} className="block hover:opacity-90">
        <p className={contextQuestionClass}>{state.prompt}</p>
        <p className={`mt-1 ${helperTextClass}`}>{formatDatePlain(answer.updatedAt)}</p>
        <div className="mt-3 rounded-md bg-surface-shell p-4">
          <p className={`line-clamp-4 whitespace-pre-wrap ${proseBodyClass}`}>
            {excerpt(answer.body)}
          </p>
        </div>
      </Link>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        {answer.isCurrent ? (
          <span className={helperTextClass}>Shown in Minds</span>
        ) : (
          <button
            type="button"
            onClick={showInMinds}
            disabled={settingCurrent}
            className={compactSecondaryButtonClass}
          >
            {settingCurrent ? 'Updating…' : 'Show in Minds'}
          </button>
        )}
        {/* Admin Phase 2A-1 — only ever true for the answer's own
            author (question_answers' RLS excludes a hidden row from
            everyone else entirely); a calm, private notice, never a
            public tombstone. */}
        {answer.moderationStatus === 'hidden' && (
          <span className={helperTextClass}>Hidden by TEMPA.</span>
        )}
      </div>
    </div>
  )
}

function CanonicalQuestionRow({ state }: { state: CanonicalQuestionState }) {
  return (
    <Link
      href={`/question/${state.id}`}
      className="block py-5 transition-colors first:pt-0 hover:opacity-80 active:bg-foreground/[.02]"
    >
      <p className={helperTextClass}>{state.answer ? 'Answered' : 'Not yet answered'}</p>
      <p className="mt-1 text-[15px] leading-relaxed text-foreground">{state.prompt}</p>
    </Link>
  )
}

/**
 * Minds' "My answers" and "Answer a Question" content — both driven by
 * the same fixed three canonical Questions (see lib/questions.ts),
 * never a rotating/eligible subset. "My answers" shows only the ones
 * this member has completed; "Answer a Question" always shows all
 * three, with a plain completed/uncompleted state, so a member can
 * revisit any of the three at any time rather than having answered
 * ones disappear from view.
 */
export default function QuestionWorkspace({
  tab,
  // "No canonical Questions/answers yet" is always a real, valid state
  // (a brand-new account, or the canonical migration not applied yet —
  // see lib/questions.ts's getCanonicalQuestions/getCanonicalAnswers,
  // which already return [] rather than undefined for exactly this
  // reason) — never an error state. Defaulting here means this
  // component can never throw on a missing/not-yet-resolved prop; every
  // `.length`/`.filter`/`.map` below always has a real array to work
  // with.
  questions = [],
}: {
  tab: 'answers' | 'new'
  questions: CanonicalQuestionState[]
}) {
  if (tab === 'answers') {
    const answered = questions.filter(
      (q): q is CanonicalQuestionState & { answer: NonNullable<CanonicalQuestionState['answer']> } =>
        q.answer !== null
    )

    if (answered.length === 0) {
      return (
        <div className="space-y-4">
          <p className={helperTextClass}>You haven&apos;t answered a Question yet.</p>
          <Link href="/minds?view=answer" className={quietLinkClass}>
            Answer a new Question
          </Link>
        </div>
      )
    }
    return (
      <div className="divide-y divide-foreground/10">
        {answered.map((state) => (
          <AnsweredQuestionRow key={state.id} state={state} />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <h1 className={proseHeadingClass}>Answer a Question</h1>
        <p className={helperTextClass}>
          Choose whichever gives you the best opportunity to say something real.
        </p>
      </div>
      <div className="divide-y divide-foreground/10">
        {questions.map((state) => (
          <CanonicalQuestionRow key={state.id} state={state} />
        ))}
      </div>
    </div>
  )
}
