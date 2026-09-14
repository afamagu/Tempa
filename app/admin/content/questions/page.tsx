import { createClient } from '@/lib/supabase/server'
import { listQuestions, type AdminQuestion } from '@/lib/admin-questions'
import { sectionTitleClass, sectionLabelClass } from '@/app/profile/ui'
import { adminMetadataClass } from '@/app/admin/admin-ui'
import CurrentQuestionSlot from './current-question-slot'
import QuestionRow from './question-row'

/**
 * Flagship Simplification correction — replaces the prior library-
 * centric screen entirely. TEMPA has exactly THREE current Questions;
 * this page shows exactly those three slots as the main (and only
 * prominent) operating surface, each with one "Edit Question" action
 * and one Flagship radio. Everything else — every historical/replaced
 * Question — lives behind a collapsed "View Question history"
 * disclosure below: secondary, never presented as an operational
 * choice.
 */
export default async function AdminQuestionsPage() {
  const supabase = await createClient()
  const { data: questions, error } = await listQuestions(supabase)

  const bySlot = new Map<1 | 2 | 3, AdminQuestion>(
    questions
      .filter((q): q is AdminQuestion & { currentPosition: 1 | 2 | 3 } => q.currentPosition !== null)
      .map((q) => [q.currentPosition, q])
  )
  const history = questions
    .filter((q) => q.currentPosition === null)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className={sectionTitleClass}>Questions</h1>
        <p className={adminMetadataClass}>
          TEMPA offers exactly three current Questions. Exactly one is Flagship — it alone defines every
          member&rsquo;s primary Minds answer.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error.message}</p>}

      <div className="space-y-3">
        <p className={sectionLabelClass}>Current Questions</p>
        <div className="space-y-3">
          {([1, 2, 3] as const).map((position) => (
            <CurrentQuestionSlot key={position} position={position} question={bySlot.get(position) ?? null} />
          ))}
        </div>
      </div>

      <details className="space-y-3">
        <summary className={`cursor-pointer ${sectionLabelClass}`}>View Question history ({history.length})</summary>
        <div className="mt-3 space-y-3">
          {history.length === 0 ? (
            <p className={adminMetadataClass}>No historical Questions yet.</p>
          ) : (
            history.map((q) => <QuestionRow key={q.id} question={q} />)
          )}
        </div>
      </details>
    </div>
  )
}
