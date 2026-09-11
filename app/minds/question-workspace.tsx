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
import type { LibraryQuestion, MyQuestionAnswer } from '@/lib/questions'

function excerpt(text: string, maxChars = 240) {
  const trimmed = text.trim()
  if (trimmed.length <= maxChars) return trimmed
  const cut = trimmed.slice(0, maxChars)
  const lastSpace = cut.lastIndexOf(' ')
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : maxChars)}…`
}

// QUESTION + DATE: system/context styling, outside the writing surface.
// ANSWER: darker inset human-writing surface. Same grammar as a letter.
function AnsweredQuestionRow({ answer }: { answer: MyQuestionAnswer }) {
  const router = useRouter()
  const [settingCurrent, setSettingCurrent] = useState(false)

  async function showInMinds() {
    setSettingCurrent(true)
    const supabase = createClient()
    const { error } = await supabase.rpc('set_current_answer', { p_answer_id: answer.id })
    setSettingCurrent(false)
    if (!error) router.refresh()
  }

  return (
    <div className="border-b border-foreground/10 py-6 first:pt-0 last:border-b-0">
      <Link href={`/question/${answer.questionId}`} className="block hover:opacity-90">
        <p className={contextQuestionClass}>{answer.prompt}</p>
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

function EligibleQuestionRow({ question }: { question: LibraryQuestion }) {
  return (
    <Link
      href={`/question/${question.id}`}
      className="block py-5 transition-colors first:pt-0 hover:opacity-80 active:bg-foreground/[.02]"
    >
      <p className="text-[15px] leading-relaxed text-foreground">{question.prompt}</p>
    </Link>
  )
}

/**
 * Minds' "My answers" and "Answer a Question" content.
 *
 * Question source-of-truth correction: "Answer a Question" used to
 * always show the same fixed three canonical Questions, each already
 * marked Answered/Not yet answered, so a member could revisit any of
 * them at any time — the only way to "answer something new" WAS to
 * revisit one of the three. Now that the library can hold many
 * Questions, `questions` here is already the up-to-three, unanswered,
 * family-diverse ELIGIBLE set (lib/questions.ts's
 * getEligibleQuestions) — genuinely new things to try, never something
 * already answered. Revisiting/editing an existing answer is "My
 * answers"' job now (it always was, for the completed half): each
 * answer's own prompt links to the same write page
 * (app/question/[questionId]/page.tsx), pre-filled with the existing
 * body, so editing keeps working exactly as before.
 */
export default function QuestionWorkspace({
  tab,
  // An empty array is always a real, valid state (a brand-new account,
  // nothing currently eligible, or nothing answered yet) — never an
  // error state. Defaulting here means this component can never throw
  // on a missing/not-yet-resolved prop; every `.length`/`.map` below
  // always has a real array to work with.
  questions = [],
  answers = [],
}: {
  tab: 'answers' | 'new'
  questions?: LibraryQuestion[]
  answers?: MyQuestionAnswer[]
}) {
  if (tab === 'answers') {
    if (answers.length === 0) {
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
        {answers.map((answer) => (
          <AnsweredQuestionRow key={answer.id} answer={answer} />
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
      {questions.length === 0 ? (
        <p className={helperTextClass}>Nothing new to answer right now — check back later.</p>
      ) : (
        <div className="divide-y divide-foreground/10">
          {questions.map((question) => (
            <EligibleQuestionRow key={question.id} question={question} />
          ))}
        </div>
      )}
    </div>
  )
}
