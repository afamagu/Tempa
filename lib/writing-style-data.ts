import type { SupabaseClient } from '@supabase/supabase-js'
import { normalizeWritingStyleId, type WritingStyleId } from './writing-style'

// Writing Style reads. Deliberately separate, fail-soft queries rather
// than new columns on existing selects: if docs/sql/2026-10-29-writing-
// style.sql has not been applied yet, every helper here simply reports
// "no style" (Tempa's canonical prose) and the surrounding page renders
// exactly as before. Every value passes through normalizeWritingStyleId,
// so nothing but the six semantic ids can ever leave this module.

type StyleMap = Map<string, WritingStyleId>

function toMap<T>(rows: T[] | null | undefined, key: (r: T) => string, value: (r: T) => unknown): StyleMap {
  const map: StyleMap = new Map()
  for (const row of rows ?? []) {
    const id = normalizeWritingStyleId(value(row))
    if (id) map.set(key(row), id)
  }
  return map
}

function unique(ids: readonly (string | null | undefined)[]): string[] {
  return Array.from(new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0)))
}

/** The signed-in member's own current style. */
export async function getMyWritingStyle(supabase: SupabaseClient, userId: string): Promise<WritingStyleId | null> {
  const { data, error } = await supabase.from('profiles').select('writing_style_id').eq('id', userId).maybeSingle()
  if (error || !data) return null
  return normalizeWritingStyleId((data as { writing_style_id?: unknown }).writing_style_id)
}

/** Current styles of members the caller can see (profile prose, discovery). */
export async function getMemberWritingStyles(supabase: SupabaseClient, userIds: readonly string[]): Promise<StyleMap> {
  const ids = unique(userIds)
  if (ids.length === 0) return new Map()
  const { data, error } = await supabase.rpc('member_writing_styles', { p_user_ids: ids })
  if (error) return new Map()
  return toMap(data as { user_id: string; writing_style_id: unknown }[], (r) => r.user_id, (r) => r.writing_style_id)
}

/** Send-time snapshots for letters the caller can read. Missing = sent
 *  before Writing Styles (Tempa's classic prose). */
export async function getLetterWritingStyles(supabase: SupabaseClient, letterIds: readonly string[]): Promise<StyleMap> {
  const ids = unique(letterIds)
  if (ids.length === 0) return new Map()
  const { data, error } = await supabase.rpc('letter_writing_styles', { p_letter_ids: ids })
  if (error) return new Map()
  return toMap(
    data as { letter_id: string; author_writing_style_id: unknown }[],
    (r) => r.letter_id,
    (r) => r.author_writing_style_id
  )
}

/** Publish-time snapshots for Dispatches (authenticated readers). */
export async function getDispatchWritingStyles(supabase: SupabaseClient, dispatchIds: readonly string[]): Promise<StyleMap> {
  const ids = unique(dispatchIds)
  if (ids.length === 0) return new Map()
  const { data, error } = await supabase.from('dispatches').select('id, author_writing_style_id').in('id', ids)
  if (error) return new Map()
  return toMap(data as { id: string; author_writing_style_id: unknown }[], (r) => r.id, (r) => r.author_writing_style_id)
}

export async function getSharedDispatchWritingStyle(supabase: SupabaseClient, shareToken: string): Promise<WritingStyleId | null> {
  const { data, error } = await supabase.rpc('shared_dispatch_writing_style', { p_token: shareToken })
  return error ? null : normalizeWritingStyleId(data)
}

export async function getPublicDispatchWritingStyle(supabase: SupabaseClient, slug: string): Promise<WritingStyleId | null> {
  const { data, error } = await supabase.rpc('public_dispatch_writing_style', { p_slug: slug })
  return error ? null : normalizeWritingStyleId(data)
}

export type SaveWritingStyleResult = { ok: true; styleId: WritingStyleId } | { ok: false }

export async function saveMyWritingStyle(supabase: SupabaseClient, styleId: WritingStyleId): Promise<SaveWritingStyleResult> {
  const { data, error } = await supabase.rpc('set_my_writing_style', { p_style_id: styleId })
  const saved = normalizeWritingStyleId(data)
  return error || !saved ? { ok: false } : { ok: true, styleId: saved }
}
