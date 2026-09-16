'use client'

import Link from 'next/link'
import {
  helperTextClass,
  quietLinkClass,
  proseHeadingClass,
  proseBodyClass,
  contextQuestionClass,
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
//
// The old "Show in Minds" manual toggle (set_current_answer) is
// REMOVED from this surface entirely. Primary Minds/Profile
// representation is no longer a member choice at all — it is always
// and only the answer to whichever Question is currently Flagship
// (answer.isPrimary), a separate, admin-chosen bit of state never
// permanently tied to a slot number. Exposing a control that no longer
// actually determines that would be actively misleading. The
// set_current_answer RPC and is_current column are left completely
// unchanged server-side (see lib/questions.ts's own header comment)
// purely for backward compatibility with historical data — nothing in
// the member-facing UI reads or writes is_current anymore.
function AnsweredQuestionRow({ answer }: { answer: MyQuestionAnswer }) {
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
        {answer.isPrimary && <span className={helperTextClass}>Your primary response</span>}
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
 * "Answer a Question" shows the current, explicitly Admin-positioned
 * three Questions (lib/questions.ts's getEligibleQuestions), in slot
 * order, minus anything this member has already answered — genuinely
 * new things to try, never something already answered. Revisiting/
 * editing an existing answer is "My answers"' job (each answer's own
 * prompt links to the same write page,
 * app/question/[questionId]/page.tsx, pre-filled with the existing
 * body).
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
          <Link href="/you/responses?tab=new" className={quietLinkClass}>
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
      {/* Onboarding & First-Use checkpoint — People Information
          Architecture: this component's own two tabs (host-controlled
          via the `tab` prop) now live at /you/responses instead of as a
          third co-equal Minds/People tab (see that route's own doc
          comment). Nothing in this component's own internals changed. */}
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
