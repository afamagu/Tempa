import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The caller's private-correspondence capacity, calculated entirely by
 * public.get_relationship_capacity(). UI code must consume this shape rather
 * than reproducing counts from correspondences/letters itself: the database
 * RPC owns the definitions of established, pending, effective expiry,
 * reservations, controlled overrides and grandfathering.
 */
export type RelationshipCapacity = {
  activeLimit: number
  establishedCount: number
  outgoingPendingCount: number
  incomingPendingCount: number
  committedCount: number
  availableSlots: number
  outgoingPendingLimit: number
  incomingPendingLimit: number
  canStartFirstContact: boolean
  canReceiveFirstContact: boolean
  grandfathered: boolean
}

type RelationshipCapacityRow = {
  active_limit: number
  established_count: number
  outgoing_pending_count: number
  incoming_pending_count: number
  committed_count: number
  available_slots: number
  outgoing_pending_limit: number
  incoming_pending_limit: number
  can_start_first_contact: boolean
  can_receive_first_contact: boolean
  grandfathered: boolean
}

function toRelationshipCapacity(row: RelationshipCapacityRow): RelationshipCapacity {
  return {
    activeLimit: row.active_limit,
    establishedCount: row.established_count,
    outgoingPendingCount: row.outgoing_pending_count,
    incomingPendingCount: row.incoming_pending_count,
    committedCount: row.committed_count,
    availableSlots: row.available_slots,
    outgoingPendingLimit: row.outgoing_pending_limit,
    incomingPendingLimit: row.incoming_pending_limit,
    canStartFirstContact: row.can_start_first_contact,
    canReceiveFirstContact: row.can_receive_first_contact,
    grandfathered: row.grandfathered,
  }
}

/**
 * Reads the one canonical server-side capacity state for the authenticated
 * member. Returns null on an RPC failure rather than fabricating permissive
 * capacity client-side. Mutation safety remains server-enforced by the Phase
 * 1 database triggers regardless of this read helper's result.
 */
export async function getRelationshipCapacity(
  supabase: SupabaseClient
): Promise<RelationshipCapacity | null> {
  const { data, error } = await supabase.rpc('get_relationship_capacity')

  if (error) {
    console.error('[relationship-capacity] get_relationship_capacity failed', {
      message: error.message,
      code: error.code,
    })
    return null
  }

  const row = Array.isArray(data) ? data[0] : data
  if (!row) return null

  return toRelationshipCapacity(row as RelationshipCapacityRow)
}
