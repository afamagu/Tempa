import type { SupabaseClient } from '@supabase/supabase-js'

export type CorrespondencePrivateMemory = {
  noteText: string
  updatedAt: string
}

type PrivateMemoryRow = {
  note_text: string
  updated_at: string
}

export async function getCorrespondencePrivateMemory(
  supabase: SupabaseClient,
  correspondenceId: string
): Promise<CorrespondencePrivateMemory | null> {
  const { data, error } = await supabase.rpc('get_my_correspondence_private_memory', {
    p_correspondence_id: correspondenceId,
  })

  if (error) {
    console.error('[private-memory] read failed', {
      code: error.code,
      correspondenceId,
    })
    return null
  }

  const row = (Array.isArray(data) ? data[0] : data) as PrivateMemoryRow | null | undefined
  if (!row) return null

  return {
    noteText: row.note_text,
    updatedAt: row.updated_at,
  }
}

export async function saveCorrespondencePrivateMemory(
  supabase: SupabaseClient,
  correspondenceId: string,
  noteText: string
): Promise<{ updatedAt: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc('save_my_correspondence_private_memory', {
    p_correspondence_id: correspondenceId,
    p_note_text: noteText,
  })

  return {
    updatedAt: typeof data === 'string' ? data : null,
    error: error?.message ?? null,
  }
}

export async function deleteCorrespondencePrivateMemory(
  supabase: SupabaseClient,
  correspondenceId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('delete_my_correspondence_private_memory', {
    p_correspondence_id: correspondenceId,
  })

  return { error: error?.message ?? null }
}
