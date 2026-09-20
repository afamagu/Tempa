import type { SupabaseClient } from '@supabase/supabase-js'
import { processImageForUpload } from './image-processing'

/**
 * Admin Phase 2A-2 — upload helpers for the `postcard-artwork` Storage
 * bucket (docs/sql/2026-09-21-postcard-admin-and-keepsakes.sql),
 * genuinely public (bucket-level `public = true`) since TEMPA-owned
 * catalogue artwork is not private correspondence media. Because the
 * bucket is public, `getPublicUrl` returns a stable, permanent URL —
 * exactly as durable as the existing `/postcards/...` static paths —
 * so the returned path is stored directly in postcard_versions.
 * front_image_path/motion_src as a plain ready-to-use string, with no
 * resolver or discriminator needed anywhere rendering happens: both
 * the legacy static assets and these new uploaded ones are just URL
 * strings, indistinguishable to every rendering component.
 *
 * Writes are Admin-only (the bucket's own INSERT policy checks
 * is_staff('admin')); this module has no per-uploader folder scoping
 * (unlike letter-photos/dispatch-photos/announcement-images) since
 * there is exactly one class of writer here, never an ordinary member.
 */

const ARTWORK_BUCKET = 'postcard-artwork'
export const MAX_POSTCARD_SOURCE_IMAGE_BYTES = 20 * 1024 * 1024
export const MAX_POSTCARD_VIDEO_BYTES = 20 * 1024 * 1024

export type UploadedPostcardAsset = {
  path: string | null
  error: string | null
}

/** Re-encodes/resizes via the shared processImageForUpload (same
 * pipeline every other photo-upload surface in this app uses), then
 * uploads to the postcard-artwork bucket and returns its public URL. */
export async function uploadPostcardArtworkImage(
  supabase: SupabaseClient,
  postcardKey: string,
  file: File
): Promise<UploadedPostcardAsset> {
  if (file.size > MAX_POSTCARD_SOURCE_IMAGE_BYTES) {
    return {
      path: null,
      error: 'That image is too large. Please choose a smaller file.',
    }
  }

  try {
    const blob = await processImageForUpload(file)
    const objectPath = `${postcardKey}/${crypto.randomUUID()}.jpg`
    const { error } = await supabase.storage
      .from(ARTWORK_BUCKET)
      .upload(objectPath, blob, { contentType: 'image/jpeg' })

    if (error) return { path: null, error: error.message }

    const { data } = supabase.storage.from(ARTWORK_BUCKET).getPublicUrl(objectPath)
    return { path: data.publicUrl, error: null }
  } catch (err) {
    return {
      path: null,
      error: err instanceof Error ? err.message : 'Could not process that image.',
    }
  }
}

/** Uploads a Living Reveal motion asset (mp4) unmodified — no
 * client-side re-encoding pipeline exists for video in this codebase,
 * matching how the four existing production motion assets were
 * produced outside the application and installed as static files. */
export async function uploadPostcardArtworkVideo(
  supabase: SupabaseClient,
  postcardKey: string,
  file: File
): Promise<UploadedPostcardAsset> {
  if (file.size > MAX_POSTCARD_VIDEO_BYTES) {
    return {
      path: null,
      error: 'That video is too large. Please choose a smaller file.',
    }
  }
  if (file.type !== 'video/mp4') {
    return {
      path: null,
      error: 'Living Reveal motion assets must be .mp4 files.',
    }
  }

  try {
    const objectPath = `${postcardKey}/${crypto.randomUUID()}.mp4`
    const { error } = await supabase.storage
      .from(ARTWORK_BUCKET)
      .upload(objectPath, file, { contentType: 'video/mp4' })

    if (error) return { path: null, error: error.message }

    const { data } = supabase.storage.from(ARTWORK_BUCKET).getPublicUrl(objectPath)
    return { path: data.publicUrl, error: null }
  } catch (err) {
    return {
      path: null,
      error: err instanceof Error ? err.message : 'Could not upload that video.',
    }
  }
}
