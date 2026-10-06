import type { SupabaseClient } from '@supabase/supabase-js'

export type PilotInvite = {
  id: string
  email: string
  status: 'pending' | 'claimed' | 'revoked'
  note: string | null
  createdAt: string
  claimedAt: string | null
  memberPseudonym: string | null
}

export type PilotHealth = {
  cohortMembers: number
  pendingInvites: number
  profilesCreated: number
  firstContactCorrespondences: number
  establishedCorrespondences: number
  thirdTurnCorrespondences: number
  fifthTurnCorrespondences: number
  survival30Eligible: number
  survival30Alive: number
  survival60Eligible: number
  survival60Alive: number
  survival90Eligible: number
  survival90Alive: number
}

type RawHealth = {
  cohort_members?: number
  pending_invites?: number
  profiles_created?: number
  first_contact_correspondences?: number
  established_correspondences?: number
  third_turn_correspondences?: number
  fifth_turn_correspondences?: number
  survival_30_eligible?: number
  survival_30_alive?: number
  survival_60_eligible?: number
  survival_60_alive?: number
  survival_90_eligible?: number
  survival_90_alive?: number
}

export async function getPilotHealth(
  supabase: SupabaseClient
): Promise<{ data: PilotHealth | null; error: string | null }> {
  const { data, error } = await supabase.rpc('admin_pilot_health')
  if (error) return { data: null, error: error.message }

  const r = (data ?? {}) as RawHealth
  return {
    data: {
      cohortMembers: Number(r.cohort_members ?? 0),
      pendingInvites: Number(r.pending_invites ?? 0),
      profilesCreated: Number(r.profiles_created ?? 0),
      firstContactCorrespondences: Number(r.first_contact_correspondences ?? 0),
      establishedCorrespondences: Number(r.established_correspondences ?? 0),
      thirdTurnCorrespondences: Number(r.third_turn_correspondences ?? 0),
      fifthTurnCorrespondences: Number(r.fifth_turn_correspondences ?? 0),
      survival30Eligible: Number(r.survival_30_eligible ?? 0),
      survival30Alive: Number(r.survival_30_alive ?? 0),
      survival60Eligible: Number(r.survival_60_eligible ?? 0),
      survival60Alive: Number(r.survival_60_alive ?? 0),
      survival90Eligible: Number(r.survival_90_eligible ?? 0),
      survival90Alive: Number(r.survival_90_alive ?? 0),
    },
    error: null,
  }
}

export async function listPilotInvites(
  supabase: SupabaseClient
): Promise<{ data: PilotInvite[]; error: string | null }> {
  const { data, error } = await supabase.rpc('admin_list_pilot_invites')
  if (error) return { data: [], error: error.message }

  const rows = (data ?? []) as {
    id: string
    email: string
    status: PilotInvite['status']
    note: string | null
    created_at: string
    claimed_at: string | null
    member_pseudonym: string | null
  }[]

  return {
    data: rows.map((r) => ({
      id: r.id,
      email: r.email,
      status: r.status,
      note: r.note,
      createdAt: r.created_at,
      claimedAt: r.claimed_at,
      memberPseudonym: r.member_pseudonym,
    })),
    error: null,
  }
}

export async function invitePilotEmail(
  supabase: SupabaseClient,
  email: string,
  note: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('admin_pilot_invite_email', {
    p_email: email,
    p_note: note.trim() || null,
  })
  return { error: error?.message ?? null }
}

export async function revokePilotInvite(
  supabase: SupabaseClient,
  inviteId: string
): Promise<{ error: string | null }> {
  const { error } = await supabase.rpc('admin_revoke_pilot_invite', {
    p_invite_id: inviteId,
  })
  return { error: error?.message ?? null }
}

export function percentage(numerator: number, denominator: number): string {
  if (denominator <= 0) return '—'
  return `${Math.round((numerator / denominator) * 100)}%`
}
