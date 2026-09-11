import { createClient } from '@/lib/supabase/server'
import { listQuestions } from '@/lib/admin-questions'
import { sectionTitleClass, sectionLabelClass } from '@/app/profile/ui'
import { adminMetadataClass } from '@/app/admin/admin-ui'
import QuestionRow from './question-row'
import CreateQuestionForm from './create-question-form'

/**
 * Admin Command Center — Questions library management. Admin-only
 * (admin_list_questions requires is_staff('admin') server-side).
 *
 * Question Slots checkpoint (Section A5) — the page is split into
 * CURRENT QUESTIONS (whichever of #1/#2/#3 currently exist, in slot
 * order — the actual member-facing experience) and the QUESTION
 * LIBRARY / HISTORY below it (every unpositioned Question — inactive
 * history, or an active-but-not-yet-promoted library entry). The owner
 * never needs to know a slug like `private_ritual` to tell which
 * Question is #1/#2/#3 — that's exactly what the CURRENT QUESTIONS
 * badges are for.
 */
export default async function AdminQuestionsPage() {
  const supabase = await createClient()
  const { data: questions, error } = await listQuestions(supabase)

  const current = questions
    .filter((q) => q.currentPosition !== null)
    .sort((a, b) => (a.currentPosition ?? 0) - (b.currentPosition ?? 0))
  const library = questions.filter((q) => q.currentPosition === null)

  const occupiedPositions = new Set(current.map((q) => q.currentPosition))
  const availablePositions = ([1, 2, 3] as const).filter((p) => !occupiedPositions.has(p))

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className={sectionTitleClass}>Questions</h1>
          <p className={adminMetadataClass}>
            The current member experience is driven by three explicit slots — #1 is the permanent flagship, #2
            and #3 rotate. A prompt can only be edited before it has any answers — an answered Question is
            Replaced with revised wording instead, which never rewrites or reassigns its historical answers.
          </p>
        </div>
        <CreateQuestionForm />
      </div>

      {error && <p className="text-sm text-red-600">{error.message}</p>}

      <div className="space-y-3">
        <p className={sectionLabelClass}>Current Questions</p>
        {current.length === 0 ? (
          <p className={adminMetadataClass}>
            No Question currently holds a slot. Assign one from the library below to populate #1/#2/#3.
          </p>
        ) : (
          <div className="space-y-3">
            {current.map((q) => (
              <QuestionRow key={q.id} question={q} availablePositions={availablePositions} />
            ))}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <p className={sectionLabelClass}>Question library / history</p>
        {library.length === 0 ? (
          <p className={adminMetadataClass}>Nothing else in the library yet.</p>
        ) : (
          <div className="space-y-3">
            {library.map((q) => (
              <QuestionRow key={q.id} question={q} availablePositions={availablePositions} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
