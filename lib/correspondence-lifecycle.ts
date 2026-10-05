import type { SupabaseClient } from '@supabase/supabase-js'

export type CorrespondenceLifecycleStatus = 'pending' | 'active' | 'paused' | 'closed'

export type CorrespondenceLifecycle = {
  correspondenceId: string
  status: CorrespondenceLifecycleStatus
  establishedAt: string | null
  pausedAt: string | null
  pausedBy: string | null
  resumeRequestedAt: string | null
  resumeRequestedBy: string | null
  closedAt: string | null
  endedBy: string | null
}

type LifecycleRow = {
  correspondence_id: string
  status: CorrespondenceLifecycleStatus
  established_at: string | null
  paused_at: string | null
  paused_by: string | null
  resume_requested_at: string | null
  resume_requested_by: string | null
  closed_at: string | null
  ended_by: string | null
}

export async function getCorrespondenceLifecycleWithMember(
  supabase: SupabaseClient,
  otherUserId: string
): Promise<CorrespondenceLifecycle | null> {
  const { data, error } = await supabase.rpc('get_correspondence_lifecycle_with_member', {
    p_other_user_id: otherUserId,
  })

  if (error) {
    if (!['PGRST202', '42883'].includes(error.code ?? '')) {
      console.error('[correspondence-lifecycle] read failed', { code: error.code })
    }
    return null
  }

  const row = (Array.isArray(data) ? data[0] : data) as LifecycleRow | null | undefined
  if (!row) return null

  return {
    correspondenceId: row.correspondence_id,
    status: row.status,
    establishedAt: row.established_at,
    pausedAt: row.paused_at,
    pausedBy: row.paused_by,
    resumeRequestedAt: row.resume_requested_at,
    resumeRequestedBy: row.resume_requested_by,
    closedAt: row.closed_at,
    endedBy: row.ended_by,
  }
}

async function callLifecycleRpc(
  supabase: SupabaseClient,
  name: 'pause_correspondence' | 'request_resume_correspondence' | 'end_correspondence',
  correspondenceId: string
) {
  return supabase.rpc(name, { p_correspondence_id: correspondenceId })
}

export function pauseCorrespondence(supabase: SupabaseClient, correspondenceId: string) {
  return callLifecycleRpc(supabase, 'pause_correspondence', correspondenceId)
}

export function requestResumeCorrespondence(supabase: SupabaseClient, correspondenceId: string) {
  return callLifecycleRpc(supabase, 'request_resume_correspondence', correspondenceId)
}

export function endCorrespondence(supabase: SupabaseClient, correspondenceId: string) {
  return callLifecycleRpc(supabase, 'end_correspondence', correspondenceId)
}

export function respondResumeCorrespondence(
  supabase: SupabaseClient,
  correspondenceId: string,
  accept: boolean
) {
  return supabase.rpc('respond_resume_correspondence', {
    p_correspondence_id: correspondenceId,
    p_accept: accept,
  })
}

export function lifecycleActionErrorMessage(error: { message?: string | null; details?: string | null } | null) {
  const detail = error?.details ?? ''
  if (detail.includes('RESUME_CAPACITY_REACHED')) {
    return 'There is not room to resume this correspondence yet. It will stay paused until both of you have space.'
  }
  return error ? 'Could not change this correspondence right now. Please try again.' : null
}
