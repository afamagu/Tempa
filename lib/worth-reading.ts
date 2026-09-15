import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Board Experience Phase 2C — Worth Reading. A PRIVATE per-Dispatch
 * quality signal, deliberately shaped like Keep in Mind
 * (lib/dispatches.ts's isKeepingMind/keepMind/unkeepMind) rather than
 * a public score: no count, no voter list, no author notification, no
 * ranking change — see docs/sql/2026-09-24-dispatch-worth-reading.sql
 * for the full schema/RPC reasoning this module is a thin client
 * wrapper around.
 */

/** Whether the viewer currently has this Dispatch marked worth
 * reading — private to the viewer; RLS (dispatch_worth_reading_own)
 * means the Dispatch's author themselves can never query this about
 * anyone else's mark, including their own Dispatch. */
export async function isDispatchWorthReading(
  supabase: SupabaseClient,
  viewerId: string,
  dispatchId: string
): Promise<boolean> {
  const { data } = await supabase
    .from('dispatch_worth_reading')
    .select('dispatch_id')
    .eq('dispatch_id', dispatchId)
    .eq('user_id', viewerId)
    .maybeSingle()

  return data !== null
}

export type SetWorthReadingError = { message: string; code?: string } | null

/**
 * Marks or unmarks a Dispatch worth reading via the sole RPC,
 * set_dispatch_worth_reading. The server derives the acting member
 * from auth.uid() and enforces every eligibility rule (published +
 * moderator-visible, not the caller's own Dispatch, no full block,
 * author publicly visible) for the true direction; the false direction
 * is always available and simply removes the caller's own row.
 */
export async function setDispatchWorthReading(
  supabase: SupabaseClient,
  dispatchId: string,
  worthReading: boolean
): Promise<{ error: SetWorthReadingError }> {
  const { error } = await supabase.rpc('set_dispatch_worth_reading', {
    p_dispatch_id: dispatchId,
    p_worth_reading: worthReading,
  })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}
