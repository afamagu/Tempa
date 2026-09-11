import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdminError } from './admin'

/**
 * Admin Operations Refinement checkpoint — V1 in-app Announcements.
 * IN-APP ONLY: no mass-email/broadcast, no audience segmentation (all
 * members only), no multiple delivery channels. See
 * docs/sql/2026-09-18-admin-operations-refinement.sql for the schema
 * and every RPC. Every admin write RPC is admin-floor only
 * (is_staff('admin')), checked server-side.
 */

export type AnnouncementStatus = 'draft' | 'published' | 'archived'

export type AdminAnnouncement = {
  id: string
  title: string
  body: string
  status: AnnouncementStatus
  startsAt: string | null
  endsAt: string | null
  createdAt: string
  updatedAt: string
}

export type ActiveAnnouncement = {
  id: string
  title: string
  body: string
}

export async function listAnnouncements(
  supabase: SupabaseClient
): Promise<{ data: AdminAnnouncement[]; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_list_announcements')
  if (error) return { data: [], error: { message: error.message, code: error.code } }
  const rows = (data ?? []) as {
    id: string
    title: string
    body: string
    status: AnnouncementStatus
    starts_at: string | null
    ends_at: string | null
    created_at: string
    updated_at: string
  }[]
  return {
    data: rows.map((r) => ({
      id: r.id,
      title: r.title,
      body: r.body,
      status: r.status,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    error: null,
  }
}

export async function createAnnouncement(
  supabase: SupabaseClient,
  title: string,
  body: string,
  startsAt?: string | null,
  endsAt?: string | null
): Promise<{ data: string | null; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_create_announcement', {
    p_title: title.trim(),
    p_body: body.trim(),
    p_starts_at: startsAt ?? null,
    p_ends_at: endsAt ?? null,
  })
  if (error) return { data: null, error: { message: error.message, code: error.code } }
  return { data: data as string, error: null }
}

export async function updateAnnouncement(
  supabase: SupabaseClient,
  announcementId: string,
  title: string,
  body: string,
  startsAt?: string | null,
  endsAt?: string | null
): Promise<{ error: AdminError }> {
  const { error } = await supabase.rpc('admin_update_announcement', {
    p_announcement_id: announcementId,
    p_title: title.trim(),
    p_body: body.trim(),
    p_starts_at: startsAt ?? null,
    p_ends_at: endsAt ?? null,
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

/** Unpublish/deactivate — moves a published announcement to 'archived'.
 * Never deletes it (preserving published history is operationally
 * useful; prefer archive semantics over hard-delete). */
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
export async function getActiveAnnouncement(
  supabase: SupabaseClient
): Promise<ActiveAnnouncement | null> {
  const { data, error } = await supabase.rpc('get_active_announcement')
  if (error) return null
  const row = (Array.isArray(data) ? data[0] : data) as ActiveAnnouncement | undefined
  return row ?? null
}
