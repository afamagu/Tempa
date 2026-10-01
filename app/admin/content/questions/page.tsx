import { createClient } from '@/lib/supabase/server'
import { listQuestions, type AdminQuestion } from '@/lib/admin-questions'
import { listRoomQuestionSuggestions } from '@/lib/admin-room-question-suggestions'
import { sectionTitleClass, sectionLabelClass } from '@/app/profile/ui'
import { adminMetadataClass } from '@/app/admin/admin-ui'
import CurrentQuestionSlot from './current-question-slot'
import QuestionRow from './question-row'
import RoomQuestionControl from './room-question-control'
import SuggestionQueue from './suggestion-queue'

export default async function AdminQuestionsPage() {
  const supabase = await createClient()
  const [questionResult, suggestionResult] = await Promise.all([
    listQuestions(supabase),
    listRoomQuestionSuggestions(supabase),
  ])
  const { data: questions, error } = questionResult
  const { data: suggestions, error: suggestionError } = suggestionResult

  const bySlot = new Map<1 | 2 | 3, AdminQuestion>(
    questions
      .filter((q): q is AdminQuestion & { currentPosition: 1 | 2 | 3 } => q.currentPosition !== null)
      .map((q) => [q.currentPosition, q])
  )
  const currentRoomQuestions = questions.filter(
    (q) => q.isActive && !q.isFlagship && q.currentPosition !== null
  )
  const currentRoomQuestion = currentRoomQuestions.length === 1 ? currentRoomQuestions[0] : null
  const roomCandidates = questions
    .filter((q) => q.isActive && !q.isFlagship)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))
  const history = questions
    .filter((q) => q.currentPosition === null)
    .sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''))

  return (
    <div className="space-y-8">
      <div className="space-y-1">
        <h1 className={sectionTitleClass}>Questions</h1>
        <p className={adminMetadataClass}>
          The First Question is Tempa&rsquo;s permanent introduction. Separately, choose exactly one active Question for this week in The Room.
        </p>
      </div>

      {error && <p className="text-sm text-red-600">{error.message}</p>}
      {currentRoomQuestions.length > 1 && (
        <p className="rounded-md border border-red-500/30 bg-red-500/5 p-3 text-sm text-red-700">
          More than one non-Flagship Question is positioned. Choose the current Room Question below to repair this state safely.
        </p>
      )}

      <div className="space-y-3">
        <p className={sectionLabelClass}>Current Room Question</p>
        <RoomQuestionControl current={currentRoomQuestion} candidates={roomCandidates} />
      </div>

      <details className="space-y-3" open={suggestions.some((suggestion) => suggestion.status === 'pending')}>
        <summary className={`cursor-pointer ${sectionLabelClass}`}>Member suggestions ({suggestions.length})</summary>
        <div className="mt-3 space-y-3">
          <p className={adminMetadataClass}>
            Private editorial submissions. Members cannot vote on them or publish them directly; Tempa can refine wording before creating a Question.
          </p>
          {suggestionError && <p className="text-sm text-red-600">{suggestionError.message}</p>}
          <SuggestionQueue suggestions={suggestions} />
        </div>
      </details>

      <details className="space-y-3">
        <summary className={`cursor-pointer ${sectionLabelClass}`}>Legacy Question slots</summary>
        <div className="mt-3 space-y-3">
          <p className={adminMetadataClass}>
            Kept for compatibility with the existing Question administration model. The member-facing Room uses only the First Question and the one current Room Question above.
          </p>
          {([1, 2, 3] as const).map((position) => (
            <CurrentQuestionSlot key={position} position={position} question={bySlot.get(position) ?? null} />
          ))}
        </div>
      </details>

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
