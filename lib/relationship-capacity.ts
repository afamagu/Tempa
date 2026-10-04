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

export type RelationshipCapacityErrorLike = {
  message?: string | null
  details?: string | null
  hint?: string | null
}

export type RelationshipCapacityFailure =
  | 'RELATIONSHIP_CAPACITY_REACHED'
  | 'OUTGOING_FIRST_CONTACT_LIMIT_REACHED'
  | 'RECIPIENT_FIRST_CONTACT_LIMIT_REACHED'

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
 * Calm, caller-only UI copy for places that could BEGIN a new private
 * correspondence. We consume fields already calculated by the canonical RPC;
 * no surface independently counts Letters or Correspondences.
 *
 * null means either the member can start a first contact or the capacity read
 * failed. In the latter case the UI stays usable and the database remains the
 * final authority at send time rather than inventing a client-side capacity.
 */
export function newCorrespondenceUnavailableMessage(
  capacity: RelationshipCapacity | null
): string | null {
  if (!capacity || capacity.canStartFirstContact) return null

  if (capacity.availableSlots <= 0) {
    return 'Your correspondence circle is full for now. When a place opens, you can write to someone new.'
  }

  if (capacity.outgoingPendingCount >= capacity.outgoingPendingLimit) {
    return 'You already have two first letters waiting for replies. When one is answered or closes, you can write to someone new.'
  }

  return 'You can’t begin another correspondence right now. When there is room for someone new, you can write again.'
}

/**
 * PostgREST exposes PostgreSQL RAISE ... DETAIL through `details`, but keep
 * message/hint in the search too so the UI remains stable if the transport
 * representation changes. Only these fixed server codes are interpreted;
 * arbitrary database text is never shown directly to members.
 */
export function relationshipCapacityFailure(
  error: RelationshipCapacityErrorLike
): RelationshipCapacityFailure | null {
  const haystack = [error.details, error.message, error.hint].filter(Boolean).join(' ')

  for (const code of [
    'RELATIONSHIP_CAPACITY_REACHED',
    'OUTGOING_FIRST_CONTACT_LIMIT_REACHED',
    'RECIPIENT_FIRST_CONTACT_LIMIT_REACHED',
  ] as const) {
    if (haystack.includes(code)) return code
  }

  return null
}

/** Member-facing copy for a failed attempt to START a correspondence. */
export function firstContactCapacityMessage(
  error: RelationshipCapacityErrorLike,
  recipientPseudonym: string
): string | null {
  switch (relationshipCapacityFailure(error)) {
    case 'RELATIONSHIP_CAPACITY_REACHED':
      return 'Your correspondence circle is full right now. When a place opens, you can begin a new correspondence.'
    case 'OUTGOING_FIRST_CONTACT_LIMIT_REACHED':
      return 'You already have two first letters waiting for replies. When one is answered or closes, you can write to someone new.'
    case 'RECIPIENT_FIRST_CONTACT_LIMIT_REACHED':
      return `${recipientPseudonym} already has two new letters waiting for a response. Try again when they have room for another.`
    default:
      return null
  }
}

/** Member-facing copy when a first reply would establish a new relationship. */
export function establishmentCapacityMessage(
  error: RelationshipCapacityErrorLike
): string | null {
  if (relationshipCapacityFailure(error) !== 'RELATIONSHIP_CAPACITY_REACHED') return null
  return 'Your correspondence circle is full right now. You can keep this letter and reply when a place opens.'
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
