import type { SupabaseClient } from '@supabase/supabase-js'
import { isWritingRhythm, type WritingRhythm } from './writing-rhythm'

export type PublicProfileCorrespondenceState = {
  canReceiveFirstContact: boolean
  writingRhythm: WritingRhythm | null
}

type Row = {
  can_receive_first_contact: boolean
  writing_rhythm: string | null
}

export async function getPublicProfileCorrespondenceState(
  supabase: SupabaseClient,
  userId: string
): Promise<PublicProfileCorrespondenceState | null> {
  const { data, error } = await supabase.rpc('get_public_profile_correspondence_state', {
    p_user_id: userId,
  })

  if (error) {
    if (!['PGRST202', '42883'].includes(error.code ?? '')) {
      console.error('[profile-correspondence-state] read failed', {
        code: error.code,
        message: error.message,
      })
    }
    return null
  }

  const row = (Array.isArray(data) ? data[0] : data) as Row | null | undefined
  if (!row) return null

  return {
    canReceiveFirstContact: Boolean(row.can_receive_first_contact),
    writingRhythm: isWritingRhythm(row.writing_rhythm) ? row.writing_rhythm : null,
  }
}
