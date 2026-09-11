import type { SupabaseClient } from '@supabase/supabase-js'
import { processImageForUpload } from './image-processing'

/**
 * Announcement hero image storage — mirrors lib/draft-photo-url.ts's
 * exact resolveLetterPhotoUrl pattern (signed URL, never public, never
 * throws) for the new `announcement-images` bucket
 * (docs/sql/2026-09-19-question-slots-and-premium-announcements.sql).
 * Path convention matches dispatch-photos: `{uploaderId}/{uuid}.jpg` —
 * the hero image is chosen while composing, often before the
 * Announcement row is saved at all, so it can never be keyed by an
 * Announcement id that doesn't exist yet.
 */
export const ANNOUNCEMENT_IMAGE_SIGNED_URL_TTL_SECONDS = 60 * 10

export type ResolvedAnnouncementImageUrl = { url: string | null; error: string | null }

export async function resolveAnnouncementImageUrl(
  supabase: SupabaseClient,
  imagePath: string
): Promise<ResolvedAnnouncementImageUrl> {
  try {
    const { data, error } = await supabase.storage
      .from('announcement-images')
      .createSignedUrl(imagePath, ANNOUNCEMENT_IMAGE_SIGNED_URL_TTL_SECONDS)

    if (error || !data?.signedUrl) {
      return { url: null, error: error?.message ?? 'No signed URL was returned.' }
    }

    return { url: data.signedUrl, error: null }
  } catch (err) {
    return { url: null, error: err instanceof Error ? err.message : String(err) }
  }
}

export type UploadedAnnouncementImage = { path: string | null; error: string | null }

/** Re-encodes/resizes via the shared processImageForUpload (same
 * function every other photo-upload surface in this app uses — strips
 * EXIF, caps dimensions, forces JPEG), then uploads to the admin's own
 * folder. A crude pre-check on the ORIGINAL file size guards against
 * handing an enormous file to the canvas pipeline at all; the bucket's
 * own file_size_limit/allowed_mime_types (set at the storage layer) is
 * the real server-side backstop regardless. */
const MAX_SOURCE_FILE_BYTES = 20 * 1024 * 1024

export async function uploadAnnouncementHeroImage(
  supabase: SupabaseClient,
  uploaderId: string,
  file: File
): Promise<UploadedAnnouncementImage> {
  if (file.size > MAX_SOURCE_FILE_BYTES) {
    return { path: null, error: 'That image is too large. Please choose a smaller file.' }
  }

  try {
    const blob = await processImageForUpload(file)
    const path = `${uploaderId}/${crypto.randomUUID()}.jpg`
    const { error } = await supabase.storage
      .from('announcement-images')
      .upload(path, blob, { contentType: 'image/jpeg' })

    if (error) return { path: null, error: error.message }
    return { path, error: null }
  } catch (err) {
    return { path: null, error: err instanceof Error ? err.message : 'Could not process that image.' }
  }
}
