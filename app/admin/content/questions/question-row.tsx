import { adminMetadataClass, adminTableTextClass } from '@/app/admin/admin-ui'
import { formatDateTimeFull } from '@/lib/format-date'
import type { AdminQuestion } from '@/lib/admin-questions'

/**
 * Flagship Simplification correction — a single row in the SECONDARY
 * "View Question history" list (app/admin/content/questions/page.tsx),
 * never mixed in with the three current-question controls. Every
 * Question here is, by construction, unpositioned (current_position is
 * null) — it stopped being current either because it was replaced
 * (answered — Edit Question preserved it) or unpinned. It is
 * deliberately read-only: no Edit/Replace/Activate/Position controls
 * here at all. A historical Question is never edited or reassigned —
 * this exists purely so the owner can still see what a Question used
 * to say, for context, not to operate on it.
 */
export default function QuestionRow({ question }: { question: AdminQuestion }) {
  return (
    <div className="space-y-1 rounded-md border border-foreground/10 p-4">
      <p className={adminTableTextClass}>{question.prompt}</p>
      <p className={adminMetadataClass}>
        {question.answerCount} answer{question.answerCount === 1 ? '' : 's'} · {question.firstLetterCount} first
        letter{question.firstLetterCount === 1 ? '' : 's'} generated
        {question.createdAt ? ` · created ${formatDateTimeFull(question.createdAt)}` : ''}
      </p>
    </div>
  )
}
