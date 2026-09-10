import { createClient } from '@/lib/supabase/server'
import { listQuestions } from '@/lib/admin-questions'
import { sectionTitleClass, helperTextClass } from '@/app/profile/ui'
import QuestionRow from './question-row'

/**
 * Admin Command Center Phase 2A-1 — Questions management. Admin-only
 * (admin_list_questions requires is_staff('admin') server-side).
 * Scoped to the 3 canonical Questions only. No Create control — the
 * member runtime only ever offers the fixed CANONICAL_QUESTION_SLUGS
 * set (lib/questions.ts); an admin-created row would never actually
 * reach a member under the current architecture, so building a Create
 * button here would be exactly the kind of control that looks
 * functional but silently does nothing. See the Phase 2A-1 design
 * discussion for the exact runtime change (a DB-driven offering query)
 * that would need to land first.
 */
export default async function AdminQuestionsPage() {
  const supabase = await createClient()
  const { data: questions, error } = await listQuestions(supabase)

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className={sectionTitleClass}>Questions</h1>
        <p className={helperTextClass}>
          TEMPA&rsquo;s three canonical Questions. Activating or deactivating changes what&rsquo;s offered to
          members immediately; a prompt can only be edited before it has any answers.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error.message}</p>}

      {questions.length === 0 ? (
        <p className={helperTextClass}>No canonical Questions found.</p>
      ) : (
        <div className="space-y-3">
          {questions.map((q) => (
            <QuestionRow key={q.id} question={q} />
          ))}
        </div>
      )}
    </div>
  )
}
