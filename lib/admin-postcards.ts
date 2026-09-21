import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdminError } from './admin'
import type { PostcardRevealLineAlignment } from './moments'

/**
 * Admin Phase 2A-2 — Postcard catalogue management. All RPCs are
 * admin-floor only (is_staff('admin'), checked server-side — see
 * docs/sql/2026-09-21-postcard-admin-and-keepsakes.sql). No delete
 * anywhere, matching this checkpoint's own instruction and the fact
 * that a catalog key or version that has ever been sent already can't
 * be deleted by ordinary foreign-key semantics.
 *
 * "Edit current descriptive metadata" and "Replace artwork /
 * presentation version" are the SAME underlying action —
 * createPostcardVersion — always creating a brand-new immutable
 * version, never mutating an existing one.
 */

export type PostcardVersionInput = {
  title: string
  location: string
  collection: string
  postmarkText: string
  footerText: string
  storyText: string
  frontImagePath: string
  motionSrc?: string | null
  durationSeconds?: number | null
  revealLineAlignment?: PostcardRevealLineAlignment | null
}

export type AdminPostcard = {
  key: string
  isActive: boolean
  createdAt: string
  currentVersionId: string
  versionNumber: number
  title: string
  countryCode: string
  location: string
  collection: string
  postmarkText: string
  footerText: string
  storyText: string
  frontImagePath: string
  motionSrc: string | null
  durationSeconds: number | null
  revealLineAlignment: PostcardRevealLineAlignment | null
  timesSent: number
}

/** Release Polish Pass — natural "how many times has this ever been
 * sent" copy, replacing the previous "{n} sent{n===1?'':'s'}" bug
 * (which produced "2 sents"). Handles 0/1/n distinctly rather than a
 * single naive pluralization rule. */
export function formatPostcardSentCount(timesSent: number): string {
  if (timesSent === 0) return 'Not sent yet'
  if (timesSent === 1) return 'Sent once'
  return `Sent ${timesSent} times`
}

/** Release Polish Pass — the Admin Postcards catalogue search: matches
 * title, country, country code, location, collection, or the exact
 * internal key, case-insensitively. Pure and client-side, same as this
 * checkpoint's own instruction ("client-side filtering is fine for the
 * current catalogue size") — no new RPC/query. */
export function filterAdminPostcards(postcards: AdminPostcard[], query: string): AdminPostcard[] {
  const q = query.trim().toLowerCase()
  if (q === '') return postcards
  return postcards.filter((p) =>
    [p.title, p.countryCode, p.location, p.collection, p.key].some((field) => field.toLowerCase().includes(q))
  )
}

export async function listPostcards(
  supabase: SupabaseClient
): Promise<{ data: AdminPostcard[]; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_list_postcards')
  if (error) return { data: [], error: { message: error.message, code: error.code } }
  const rows = (data ?? []) as {
    key: string
    is_active: boolean
    created_at: string
    current_version_id: string
    version_number: number
    title: string
    country_code: string
    location: string
    collection: string
    postmark_text: string
    footer_text: string
    front_image_path: string
    motion_src: string | null
    duration_seconds: number | null
    reveal_line_alignment: string | null
    times_sent: number
  }[]
  const versionIds = rows.map((r) => r.current_version_id)
  const { data: stories, error: storyError } = versionIds.length
    ? await supabase.from('postcard_versions').select('id, story_text').in('id', versionIds)
    : { data: [], error: null }
  if (storyError) return { data: [], error: { message: storyError.message, code: storyError.code } }
  const storyByVersion = new Map((stories ?? []).map((v) => [v.id as string, v.story_text as string]))
  return {
    data: rows.map((r) => ({
      key: r.key,
      isActive: r.is_active,
      createdAt: r.created_at,
      currentVersionId: r.current_version_id,
      versionNumber: r.version_number,
      title: r.title,
      countryCode: r.country_code,
      location: r.location,
      collection: r.collection,
      postmarkText: r.postmark_text,
      footerText: r.footer_text,
      storyText: storyByVersion.get(r.current_version_id) ?? '',
      frontImagePath: r.front_image_path,
      motionSrc: r.motion_src,
      durationSeconds: r.duration_seconds,
      revealLineAlignment: r.reveal_line_alignment as PostcardRevealLineAlignment | null,
      timesSent: r.times_sent,
    })),
    error: null,
  }
}

/** Creates a brand new catalog key AND its Version 1 in one call. */
export async function addPostcard(
  supabase: SupabaseClient,
  key: string,
  countryCode: string,
  input: PostcardVersionInput
): Promise<{ data: string | null; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_add_story_postcard', {
    p_key: key.trim(),
    p_title: input.title.trim(),
    p_country_code: countryCode.trim(),
    p_location: input.location.trim(),
    p_collection: input.collection.trim(),
    p_postmark_text: input.postmarkText.trim(),
    p_footer_text: input.footerText.trim(),
    p_story_text: input.storyText.trim(),
    p_front_image_path: input.frontImagePath.trim(),
    p_motion_src: input.motionSrc?.trim() || null,
    p_duration_seconds: input.durationSeconds ?? null,
    p_reveal_line_alignment: input.revealLineAlignment ?? null,
  })
  if (error) return { data: null, error: { message: error.message, code: error.code } }
  return { data: data as string, error: null }
}

/** The single primitive behind both "Edit metadata" and "Replace
 * artwork" — always creates a brand new immutable version and marks it
 * current; the previous version is never mutated and every letter
 * already pointing at it keeps pointing at it forever. */
export async function createPostcardVersion(
  supabase: SupabaseClient,
  key: string,
  input: PostcardVersionInput
): Promise<{ data: string | null; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_create_story_postcard_version', {
    p_key: key,
    p_title: input.title.trim(),
    p_location: input.location.trim(),
    p_collection: input.collection.trim(),
    p_postmark_text: input.postmarkText.trim(),
    p_footer_text: input.footerText.trim(),
    p_story_text: input.storyText.trim(),
    p_front_image_path: input.frontImagePath.trim(),
    p_motion_src: input.motionSrc?.trim() || null,
    p_duration_seconds: input.durationSeconds ?? null,
    p_reveal_line_alignment: input.revealLineAlignment ?? null,
  })
  if (error) return { data: null, error: { message: error.message, code: error.code } }
  return { data: data as string, error: null }
}

/** Deactivating stops NEW sends from offering this Postcard; historical
 * letters remain perfectly readable regardless — visibility was never
 * tied to is_active. */
export async function setPostcardActive(
  supabase: SupabaseClient,
  key: string,
  active: boolean
): Promise<{ error: AdminError }> {
  const { error } = await supabase.rpc('admin_set_postcard_active', { p_key: key, p_active: active })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}
