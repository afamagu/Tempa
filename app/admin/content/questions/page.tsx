import { createClient } from '@/lib/supabase/server'
import { listQuestions } from '@/lib/admin-questions'
import { sectionTitleClass } from '@/app/profile/ui'
import { adminMetadataClass } from '@/app/admin/admin-ui'
import QuestionRow from './question-row'
import CreateQuestionForm from './create-question-form'

/**
 * Admin Command Center — Questions library management. Admin-only
 * (admin_list_questions requires is_staff('admin') server-side). Lists
 * the FULL Questions library, not just the 3 canonical ones — Create
 * and Replace here build out the library; they do not, on their own,
 * change what members are currently offered (see lib/admin-questions.ts).
 */
export default async function AdminQuestionsPage() {
  const supabase = await createClient()
  const { data: questions, error } = await listQuestions(supabase)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className={sectionTitleClass}>Questions</h1>
          <p className={adminMetadataClass}>
            Activating or deactivating changes what&rsquo;s offered to members immediately. A prompt can only be
            edited before it has any answers — an answered Question can be Replaced with revised wording instead,
            which never rewrites or reassigns its historical answers.
          </p>
        </div>
        <CreateQuestionForm />
      </div>

      {error && <p className="text-sm text-red-600">{error.message}</p>}

      {questions.length === 0 ? (
        <p className={adminMetadataClass}>No Questions found.</p>
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
