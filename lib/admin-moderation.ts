import type { SupabaseClient } from '@supabase/supabase-js'
import type { AdminError } from './admin'

/**
 * Admin Command Center Phase 2A-1 — thin wrappers around the staff-only
 * moderation RPCs (docs/sql/2026-09-10-admin-moderation-and-questions.sql,
 * prepared but not yet applied). Every RPC checks is_staff() itself,
 * server-side — these wrappers are a call-shape convenience only, same
 * convention as lib/admin.ts. Hide/restore stay moderator-floor
 * (reachable from report detail); the proactive public-content list is
 * admin-floor only — see the migration's own comments for why.
 */

export type ContentType = 'dispatch' | 'question_answer'
export type ModerationStatus = 'visible' | 'hidden'

export async function hideDispatch(
  supabase: SupabaseClient,
  dispatchId: string,
  reason: string
): Promise<{ error: AdminError }> {
  const { error } = await supabase.rpc('admin_hide_dispatch', { p_dispatch_id: dispatchId, p_reason: reason.trim() })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}

export async function restoreDispatch(
  supabase: SupabaseClient,
  dispatchId: string,
  reason: string
): Promise<{ error: AdminError }> {
  const { error } = await supabase.rpc('admin_restore_dispatch', { p_dispatch_id: dispatchId, p_reason: reason.trim() })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}

export async function hideQuestionAnswer(
  supabase: SupabaseClient,
  answerId: string,
  reason: string
): Promise<{ error: AdminError }> {
  const { error } = await supabase.rpc('admin_hide_question_answer', { p_answer_id: answerId, p_reason: reason.trim() })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}

export async function restoreQuestionAnswer(
  supabase: SupabaseClient,
  answerId: string,
  reason: string
): Promise<{ error: AdminError }> {
  const { error } = await supabase.rpc('admin_restore_question_answer', { p_answer_id: answerId, p_reason: reason.trim() })
  if (error) return { error: { message: error.message, code: error.code } }
  return { error: null }
}

export type PublicContentRow = {
  contentType: ContentType
  id: string
  title: string
  excerpt: string
  authorId: string
  authorPseudonym: string
  moderationStatus: ModerationStatus
  moderatedAt: string | null
  contentCreatedAt: string
}

/**
 * Admin-only (is_staff('admin') server-side) — a moderator cannot reach
 * this even by calling the RPC directly. Bounded (limit/offset), never
 * an unbounded query. Public content only: published Dispatches and
 * live-to-Minds Question answers — never letters, moments, or
 * letter_postcards.
 */
export async function listPublicContent(
  supabase: SupabaseClient,
  options: { type?: ContentType; status?: ModerationStatus; limit?: number; offset?: number } = {}
): Promise<{ data: PublicContentRow[]; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_list_public_content', {
    p_type: options.type ?? null,
    p_status: options.status ?? null,
    p_limit: options.limit ?? 30,
    p_offset: options.offset ?? 0,
  })
  if (error) return { data: [], error: { message: error.message, code: error.code } }
  const rows = (data ?? []) as {
    content_type: ContentType
    id: string
    title: string
    excerpt: string
    author_id: string
    author_pseudonym: string
    moderation_status: ModerationStatus
    moderated_at: string | null
    content_created_at: string
  }[]
  return {
    data: rows.map((r) => ({
      contentType: r.content_type,
      id: r.id,
      title: r.title,
      excerpt: r.excerpt,
      authorId: r.author_id,
      authorPseudonym: r.author_pseudonym,
      moderationStatus: r.moderation_status,
      moderatedAt: r.moderated_at,
      contentCreatedAt: r.content_created_at,
    })),
    error: null,
  }
}

export type ContentAuditRow = {
  id: string
  actorIdentifierSnapshot: string
  action: string
  targetType: string
  targetId: string | null
  targetIdentifierSnapshot: string | null
  reason: string | null
  metadata: Record<string, unknown> | null
  createdAt: string
}

/** Staff floor (moderator) — used by both report detail and Public
 * Content Review to show one content item's own moderation history. */
export async function listContentAudit(
  supabase: SupabaseClient,
  options: { targetType?: string; targetId?: string; limit?: number } = {}
): Promise<{ data: ContentAuditRow[]; error: AdminError }> {
  const { data, error } = await supabase.rpc('admin_list_content_audit', {
    p_target_type: options.targetType ?? null,
    p_target_id: options.targetId ?? null,
    p_limit: options.limit ?? 100,
  })
  if (error) return { data: [], error: { message: error.message, code: error.code } }
  const rows = (data ?? []) as {
    id: string
    actor_identifier_snapshot: string
    action: string
    target_type: string
    target_id: string | null
    target_identifier_snapshot: string | null
    reason: string | null
    metadata: Record<string, unknown> | null
    created_at: string
  }[]
  return {
    data: rows.map((r) => ({
      id: r.id,
      actorIdentifierSnapshot: r.actor_identifier_snapshot,
      action: r.action,
      targetType: r.target_type,
      targetId: r.target_id,
      targetIdentifierSnapshot: r.target_identifier_snapshot,
      reason: r.reason,
      metadata: r.metadata,
      createdAt: r.created_at,
    })),
    error: null,
  }
}
