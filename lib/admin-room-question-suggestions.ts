import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdminError } from './admin'

export type RoomQuestionSuggestionStatus = 'pending' | 'shortlisted' | 'scheduled' | 'declined' | 'used'

export type AdminRoomQuestionSuggestion = {
  id: string
  proposedQuestion: string
  creditIfUsed: boolean
  pseudonymSnapshot: string | null
  status: RoomQuestionSuggestionStatus
  editorialNotes: string | null
  publishedQuestionId: string | null
  createdAt: string
  memberQuestionId?: string
  moderationStatus?: string
  withdrawn?: boolean
}

export async function listRoomQuestionSuggestions(
  supabase: SupabaseClient
): Promise<{ data: AdminRoomQuestionSuggestion[]; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_list_room_question_suggestions')
  if (error) return { data: [], error: { message: error.message, code: error.code } }

  const rows = (data ?? []) as {
    id: string
    proposed_question: string
    credit_if_used: boolean
    pseudonym_snapshot: string | null
    status: RoomQuestionSuggestionStatus
    editorial_notes: string | null
    published_question_id: string | null
    created_at: string
  }[]

  const { data: questionDetails } = await supabase.rpc('admin_member_question_details')
  const details = (questionDetails ?? []) as { suggestion_id: string; question_id: string; moderation_status: string; withdrawn: boolean }[]
  return {
    data: rows.map((row) => ({
      id: row.id,
      proposedQuestion: row.proposed_question,
      creditIfUsed: row.credit_if_used,
      pseudonymSnapshot: row.pseudonym_snapshot,
      status: row.status,
      editorialNotes: row.editorial_notes,
      publishedQuestionId: row.published_question_id,
      createdAt: row.created_at,
      memberQuestionId: details.find(q => q.suggestion_id === row.id)?.question_id,
      moderationStatus: details.find(q => q.suggestion_id === row.id)?.moderation_status,
      withdrawn: details.find(q => q.suggestion_id === row.id)?.withdrawn,
    })),
    error: null,
  }
}

export async function updateRoomQuestionSuggestion(
  supabase: SupabaseClient,
  suggestionId: string,
  status: RoomQuestionSuggestionStatus,
  editorialNotes?: string | null,
  publishedQuestionId?: string | null
): Promise<{ error: AdminError }> {
  const { error } = await supabase.rpc('admin_update_room_question_suggestion', {
    p_suggestion_id: suggestionId,
    p_status: status,
    p_editorial_notes: editorialNotes?.trim() || null,
    p_published_question_id: publishedQuestionId ?? null,
  })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}
