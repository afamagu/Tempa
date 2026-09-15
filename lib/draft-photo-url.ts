import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Draft/live-repair checkpoint (2026-09-08) — the ONE canonical rule for
 * turning a durable, private `letter-photos` Storage path into a fresh,
 * temporary display URL. Both the composer's own restored-photo
 * NodeView (photo-moment-node.tsx) and the Preview-preparation layer
 * (moments-composer.tsx) call this SAME function — neither invents its
 * own signing logic, so there is exactly one place that can ever be
 * wrong about how a draft photo gets a display URL.
 *
 * `imagePath` is always the durable, bucket-relative path (e.g.
 * `"<correspondenceId>/<uuid>.jpg"`) — the same value already stored as
 * a photoMoment's `imagePath` attr and already used unchanged by the
 * production upload/send path. This function never makes the object
 * public (`createSignedUrl` respects the bucket's existing RLS —
 * `letter_photos_select`, scoped to `is_correspondence_participant` —
 * exactly like every other private-photo read in this codebase), never
 * persists what it returns, and never throws: a genuine failure (RLS
 * denial, network error, an auth session not yet available) comes back
 * as `{ url: null, error }` rather than an unhandled rejection, so a
 * caller can always keep the UI in a recoverable state instead of a
 * silently-swallowed dead end (the exact defect this checkpoint fixes —
 * see photo-moment-node.tsx's own updated doc comment for why the OLD
 * inline call here used to fail silently and never retry).
 */
export const DRAFT_PHOTO_SIGNED_URL_TTL_SECONDS = 60 * 10

export type ResolvedPhotoUrl = { url: string | null; error: string | null }

export async function resolveLetterPhotoUrl(
  supabase: SupabaseClient,
  imagePath: string
): Promise<ResolvedPhotoUrl> {
  try {
    const { data, error } = await supabase.storage
      .from('letter-photos')
      .createSignedUrl(imagePath, DRAFT_PHOTO_SIGNED_URL_TTL_SECONDS)

    if (error || !data?.signedUrl) {
      return { url: null, error: error?.message ?? 'No signed URL was returned.' }
    }

    return { url: data.signedUrl, error: null }
  } catch (err) {
    return { url: null, error: err instanceof Error ? err.message : String(err) }
  }
}

/**
 * Dispatch Preview checkpoint — the exact same signing shape as
 * resolveLetterPhotoUrl above, against the separate, non-consent-gated
 * `dispatch-photos` bucket a Dispatch's own photoMoment nodes always
 * upload to (see app/board/dispatch-photo-moment-node.tsx's own doc
 * comment for why that bucket is kept structurally distinct from the
 * private `letter-photos` one). Used only as resolveDraftPreviewMoments'
 * fallback resolver, for the rare case a restored draft's photoMoment
 * node has no `previewUrl` attr of its own yet (the common case already
 * carries one — a fresh upload's blob: URL, or an already-resolved
 * signed URL from DispatchPhotoMomentView's own mount-time fetch).
 */
export async function resolveDispatchPhotoUrl(
  supabase: SupabaseClient,
  imagePath: string
): Promise<ResolvedPhotoUrl> {
  try {
    const { data, error } = await supabase.storage
      .from('dispatch-photos')
      .createSignedUrl(imagePath, DRAFT_PHOTO_SIGNED_URL_TTL_SECONDS)

    if (error || !data?.signedUrl) {
      return { url: null, error: error?.message ?? 'No signed URL was returned.' }
    }

    return { url: data.signedUrl, error: null }
  } catch (err) {
    return { url: null, error: err instanceof Error ? err.message : String(err) }
  }
}
