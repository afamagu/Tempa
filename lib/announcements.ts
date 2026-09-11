import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdminError } from './admin'
import { docToPlainText, type AnnouncementDocJSON } from './announcement-editor-doc'

/**
 * Premium Announcement Publishing checkpoint. Builds on the V1
 * Announcements feature (docs/sql/2026-09-18-admin-operations-
 * refinement.sql) — schema/RPCs extended in docs/sql/2026-09-19-
 * question-slots-and-premium-announcements.sql with subtitle,
 * content_json (structured rich body — see lib/announcement-editor-doc.ts),
 * hero_image_path, and published_at. IN-APP ONLY: no mass-email, no
 * audience segmentation (all members only), no multiple delivery
 * channels. Every admin write RPC is admin-floor only
 * (is_staff('admin')), checked server-side.
 */

export type AnnouncementStatus = 'draft' | 'published' | 'archived'

/** Derived, human-understandable state — computed from status +
 * starts_at + ends_at, never a separate DB enum (per this checkpoint's
 * own instruction: "you do NOT necessarily need five database enum
 * values if the same safe result can be derived"). */
export type DerivedAnnouncementState = 'draft' | 'scheduled' | 'live' | 'expired' | 'archived'

export function deriveAnnouncementState(
  status: AnnouncementStatus,
  startsAt: string | null,
  endsAt: string | null,
  now: Date = new Date()
): DerivedAnnouncementState {
  if (status === 'draft') return 'draft'
  if (status === 'archived') return 'archived'
  // status === 'published' from here on.
  if (startsAt && new Date(startsAt) > now) return 'scheduled'
  if (endsAt && new Date(endsAt) < now) return 'expired'
  return 'live'
}

export type AdminAnnouncement = {
  id: string
  title: string
  subtitle: string | null
  body: string
  contentJson: AnnouncementDocJSON | null
  heroImagePath: string | null
  status: AnnouncementStatus
  startsAt: string | null
  endsAt: string | null
  publishedAt: string | null
  createdAt: string
  updatedAt: string
}

export type ActiveAnnouncement = {
  id: string
  title: string
  subtitle: string | null
  body: string
  contentJson: AnnouncementDocJSON | null
  heroImagePath: string | null
}

export async function listAnnouncements(
  supabase: SupabaseClient
): Promise<{ data: AdminAnnouncement[]; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_list_announcements')
  if (error) return { data: [], error: { message: error.message, code: error.code } }
  const rows = (data ?? []) as {
    id: string
    title: string
    subtitle: string | null
    body: string
    content_json: AnnouncementDocJSON | null
    hero_image_path: string | null
    status: AnnouncementStatus
    starts_at: string | null
    ends_at: string | null
    published_at: string | null
    created_at: string
    updated_at: string
  }[]
  return {
    data: rows.map((r) => ({
      id: r.id,
      title: r.title,
      subtitle: r.subtitle,
      body: r.body,
      contentJson: r.content_json,
      heroImagePath: r.hero_image_path,
      status: r.status,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      publishedAt: r.published_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    error: null,
  }
}

export type AnnouncementInput = {
  title: string
  subtitle?: string | null
  contentJson: AnnouncementDocJSON
  heroImagePath?: string | null
  startsAt?: string | null
  endsAt?: string | null
}

export async function createAnnouncement(
  supabase: SupabaseClient,
  input: AnnouncementInput
): Promise<{ data: string | null; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_create_announcement', {
    p_title: input.title.trim(),
    p_body: docToPlainText(input.contentJson),
    p_subtitle: input.subtitle?.trim() || null,
    p_content_json: input.contentJson,
    p_hero_image_path: input.heroImagePath ?? null,
    p_starts_at: input.startsAt ?? null,
    p_ends_at: input.endsAt ?? null,
  })
  if (error) return { data: null, error: { message: error.message, code: error.code } }
  return { data: data as string, error: null }
}

export async function updateAnnouncement(
  supabase: SupabaseClient,
  announcementId: string,
  input: AnnouncementInput
): Promise<{ error: AdminError }> {
  const { error } = await supabase.rpc('admin_update_announcement', {
    p_announcement_id: announcementId,
    p_title: input.title.trim(),
    p_body: docToPlainText(input.contentJson),
    p_subtitle: input.subtitle?.trim() || null,
    p_content_json: input.contentJson,
    p_hero_image_path: input.heroImagePath ?? null,
    p_starts_at: input.startsAt ?? null,
    p_ends_at: input.endsAt ?? null,
  })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}

export async function publishAnnouncement(
  supabase: SupabaseClient,
  announcementId: string
): Promise<{ error: AdminError }> {
  const { error } = await supabase.rpc('admin_publish_announcement', { p_announcement_id: announcementId })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}

/** Unpublish/deactivate — moves a published (live OR scheduled)
 * announcement to 'archived'. Never deletes it (preserving published
 * history is operationally useful; prefer archive semantics over
 * hard-delete). */
export async function archiveAnnouncement(
  supabase: SupabaseClient,
  announcementId: string
): Promise<{ error: AdminError }> {
  const { error } = await supabase.rpc('admin_archive_announcement', { p_announcement_id: announcementId })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}

/** The ONE currently active announcement for Home, or null. Member-
 * facing — deliberately returns no error to the caller for an
 * unauthenticated/empty case, keeping Home resilient. */
export async function getActiveAnnouncement(supabase: SupabaseClient): Promise<ActiveAnnouncement | null> {
  const { data, error } = await supabase.rpc('get_active_announcement')
  if (error) return null
  const row = (Array.isArray(data) ? data[0] : data) as
    | {
        id: string
        title: string
        subtitle: string | null
        body: string
        content_json: AnnouncementDocJSON | null
        hero_image_path: string | null
      }
    | undefined
  if (!row) return null
  return {
    id: row.id,
    title: row.title,
    subtitle: row.subtitle,
    body: row.body,
    contentJson: row.content_json,
    heroImagePath: row.hero_image_path,
  }
}
