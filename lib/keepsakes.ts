import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdminError } from './admin'
import type { PostcardRevealLineAlignment, PostcardBaseContent } from './moments'

/**
 * Admin Phase 2A-2 — Keepsakes / Your Postcards. RECEIVING a Postcard
 * automatically preserves it; there is no "Save Postcard" action.
 * get_my_postcards (docs/sql/2026-09-21-postcard-admin-and-keepsakes.sql)
 * derives this directly from letter_postcards -> letters -> recipient,
 * the existing source of truth — no separate ownership table. auth.uid()
 * is hardcoded server-side; there is no way to request another
 * member's Postcards through this call.
 */

export type MyPostcard = {
  letterId: string
  correspondenceId: string
  deliveredAt: string
  revealLine: string
  backMessage: string
  senderPseudonymSnapshot: string
  postcardKey: string
  base: PostcardBaseContent
}

export async function getMyPostcards(supabase: SupabaseClient): Promise<{ data: MyPostcard[]; error: AdminError }> {
  const { data, error } = await supabase.rpc('get_my_postcards')
  if (error) return { data: [], error: { message: error.message, code: error.code } }
  const rows = (data ?? []) as {
    letter_id: string
    correspondence_id: string
    delivered_at: string
    reveal_line: string | null
    back_message: string
    sender_pseudonym_snapshot: string
    postcard_key: string
    title: string
    location: string
    collection: string
    postmark_text: string
    footer_text: string
    front_image_path: string
    motion_src: string | null
    duration_seconds: number | null
    reveal_line_alignment: string | null
  }[]
  return {
    data: rows.map((r) => ({
      letterId: r.letter_id,
      correspondenceId: r.correspondence_id,
      deliveredAt: r.delivered_at,
      revealLine: r.reveal_line ?? '',
      backMessage: r.back_message,
      senderPseudonymSnapshot: r.sender_pseudonym_snapshot,
      postcardKey: r.postcard_key,
      base: {
        title: r.title,
        location: r.location,
        collection: r.collection,
        frontImagePath: r.front_image_path,
        postmarkText: r.postmark_text,
        footerText: r.footer_text,
        living: r.motion_src
          ? {
              motionSrc: r.motion_src,
              durationSeconds: r.duration_seconds ?? undefined,
              revealLineAlignment: (r.reveal_line_alignment as PostcardRevealLineAlignment | null) ?? undefined,
            }
          : undefined,
      },
    })),
    error: null,
  }
}

/** "Remove from my Postcards" — hides one delivered Postcard from this
 * member's own Keepsakes view only. Never deletes letter_postcards,
 * never alters the original letter or the sender's own history, never
 * touches the immutable version. The original historical letter still
 * shows its Postcard exactly as it always did. */
export async function removeMyPostcard(
  supabase: SupabaseClient,
  letterId: string
): Promise<{ error: AdminError }> {
  const { error } = await supabase.rpc('remove_my_postcard', { p_letter_id: letterId })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}
