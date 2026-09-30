import type { SupabaseClient } from '@supabase/supabase-js'

// Editorial bylines — the disclosure a house account run by Tempa itself
// carries beneath its pseudonym ("Tempa House Columnist"). Set only from
// the back end (docs/sql/2026-09-30-editorial-byline.sql); members can
// never set it on any account, including their own.
//
// Read through ONE tiny RPC, editorial_bylines(), which returns just the
// canonical pseudonym key + title of each house account. Surfaces match
// it against the pseudonym they already show, so no existing select,
// view or RPC had to widen. Fail-soft: if the migration is not live yet
// the map is empty and every page renders exactly as before.

export type EditorialBylines = ReadonlyMap<string, string>

const EMPTY: EditorialBylines = new Map()
const MAX_TITLE_CHARS = 60

/** Mirrors public.canonicalize_pseudonym: trim, lowercase, strip spaces
 * and hyphens — so "Lady Larkspur" and "lady-larkspur" are one key. */
export function canonicalizePseudonym(pseudonym: string): string {
  return pseudonym.trim().toLowerCase().replace(/[ -]+/g, '')
}

export function toEditorialBylines(rows: unknown): EditorialBylines {
  if (!Array.isArray(rows)) return EMPTY
  const map = new Map<string, string>()
  for (const row of rows as { pseudonym_key?: unknown; editorial_title?: unknown }[]) {
    const key = typeof row?.pseudonym_key === 'string' ? row.pseudonym_key : ''
    const title = typeof row?.editorial_title === 'string' ? row.editorial_title.trim() : ''
    if (key && title && title.length <= MAX_TITLE_CHARS) map.set(key, title)
  }
  return map
}

// One read per Supabase client — server clients are created per request,
// so a page that renders several surfaces (Home: Board shelf, Kept,
// Recommended minds) asks once.
const inflight = new WeakMap<SupabaseClient, Promise<EditorialBylines>>()

export function getEditorialBylines(supabase: SupabaseClient): Promise<EditorialBylines> {
  let pending = inflight.get(supabase)
  if (!pending) {
    pending = readEditorialBylines(supabase)
    inflight.set(supabase, pending)
  }
  return pending
}

async function readEditorialBylines(supabase: SupabaseClient): Promise<EditorialBylines> {
  try {
    const { data, error } = await supabase.rpc('editorial_bylines')
    return error ? EMPTY : toEditorialBylines(data)
  } catch {
    return EMPTY
  }
}

export function editorialTitleFor(bylines: EditorialBylines, pseudonym: string | null | undefined): string | null {
  if (!pseudonym) return null
  return bylines.get(canonicalizePseudonym(pseudonym)) ?? null
}

/** "Lady Larkspur, Tempa House Columnist" — the author string search
 * engines see (page metadata and JSON-LD). */
export function editorialAuthorName(name: string, editorialTitle: string | null | undefined): string {
  return editorialTitle ? `${name}, ${editorialTitle}` : name
}
