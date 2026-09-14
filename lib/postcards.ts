import type { SupabaseClient } from '@supabase/supabase-js'
import type { PostcardBaseContent, PostcardRevealLineAlignment } from './moments'

/**
 * Admin Phase 2A-2 — the CANONICAL, DB-backed Postcard catalogue for
 * NEW letter-level sending. Replaces lib/moments.ts's static
 * POSTCARD_CATALOG as the source of truth for what the picker offers
 * and what a delivered Postcard renders: this reads live from
 * public.postcard_catalog/public.postcard_versions
 * (docs/sql/2026-09-14-letter-level-postcards.sql, live; widened by
 * docs/sql/2026-09-21-postcard-admin-and-keepsakes.sql to also carry
 * title/location/collection/postmark/footer text, not just artwork).
 *
 * POSTCARD_CATALOG in lib/moments.ts is NOT replaced or removed — it
 * remains the resolution path for historical inline `moments.type =
 * 'postcard'` rows (postcard-moment-node.tsx/MomentDisplay), a
 * completely separate, untouched legacy feature. This module is the
 * ONLY catalogue the new letter-level Postcard flow (picker, composer,
 * delivered reader) uses going forward.
 */
export type PostcardCatalogEntry = {
  key: string
  title: string
  /** Release Polish Pass — the picker's own search needs a "TH"/"MA"
   * match alongside title/location/collection/key; sourced from the
   * already-live, already-readable postcard_catalog.country_code
   * column (no new query/RPC — just widening the existing SELECT). */
  countryCode: string
  location: string
  collection: string
  postmarkText: string
  footerText: string
  frontImagePath: string
  motionSrc: string | null
  durationSeconds: number | null
  revealLineAlignment: PostcardRevealLineAlignment | null
}

type PostcardCatalogRow = {
  key: string
  country_code: string
  postcard_versions:
    | {
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
    | null
}

/**
 * Pure: maps raw (already-fetched) postcard_catalog rows — each
 * carrying its embedded, is_current-filtered postcard_versions relation
 * — into the flat PostcardCatalogEntry list callers actually want. Split
 * out from getActivePostcards specifically so this mapping is directly
 * unit-testable without a live or faked Supabase query-builder chain,
 * same convention as lib/letters.ts's mapLetterPostcardRows.
 */
export function mapPostcardCatalogRows(rows: PostcardCatalogRow[]): PostcardCatalogEntry[] {
  return rows
    .filter((row): row is PostcardCatalogRow & { postcard_versions: NonNullable<PostcardCatalogRow['postcard_versions']> } =>
      Array.isArray(row.postcard_versions) && row.postcard_versions.length > 0
    )
    .map((row) => {
      const version = row.postcard_versions[0]
      return {
        key: row.key,
        title: version.title,
        countryCode: row.country_code,
        location: version.location,
        collection: version.collection,
        postmarkText: version.postmark_text,
        footerText: version.footer_text,
        frontImagePath: version.front_image_path,
        motionSrc: version.motion_src,
        durationSeconds: version.duration_seconds,
        revealLineAlignment: version.reveal_line_alignment as PostcardRevealLineAlignment | null,
      }
    })
}

/**
 * Every currently ACTIVE Postcard, for the picker/composer. Reads
 * directly from postcard_catalog/postcard_versions (both `using (true)`
 * to authenticated — non-private catalogue metadata, no RPC needed for
 * a plain read) rather than a hand-maintained TypeScript list, so a
 * Postcard added entirely through Admin (lib/admin-postcards.ts)
 * appears here with zero code changes. A deactivated Postcard is
 * correctly excluded — `is_active` is the SEND-eligibility gate,
 * exactly mirroring write_letter/reply_to_letter's own check.
 */
export async function getActivePostcards(supabase: SupabaseClient): Promise<PostcardCatalogEntry[]> {
  const { data, error } = await supabase
    .from('postcard_catalog')
    .select(
      'key, country_code, postcard_versions(title, location, collection, postmark_text, footer_text, front_image_path, motion_src, duration_seconds, reveal_line_alignment, is_current)'
    )
    .eq('is_active', true)
    .eq('postcard_versions.is_current', true)

  if (error) {
    console.error('[postcard_catalog] read failed', { message: error.message, code: error.code })
    return []
  }

  return mapPostcardCatalogRows((data ?? []) as unknown as PostcardCatalogRow[])
}

/** Release Polish Pass — the composer's own Postcard picker search:
 * matches title, country code, location, collection, or the exact
 * internal key, case-insensitively. Pure/client-side, mirroring
 * lib/admin-postcards.ts's filterAdminPostcards exactly (same fields,
 * same "no new query" reasoning) so the picker and Admin search behave
 * identically wherever practical. */
export function filterPostcardCatalog(postcards: PostcardCatalogEntry[], query: string): PostcardCatalogEntry[] {
  const q = query.trim().toLowerCase()
  if (q === '') return postcards
  return postcards.filter((p) =>
    [p.title, p.countryCode, p.location, p.collection, p.key].some((field) => field.toLowerCase().includes(q))
  )
}

/** Converts a canonical catalogue entry into the generic base content
 * shape lib/moments.ts's resolveLetterPostcardDisplay merges sender
 * overrides onto — used by the composer's own live draft preview
 * (choosing among CURRENT offerings, nothing frozen yet). */
export function postcardEntryToBaseContent(entry: PostcardCatalogEntry): PostcardBaseContent {
  return {
    title: entry.title,
    location: entry.location,
    collection: entry.collection,
    frontImagePath: entry.frontImagePath,
    postmarkText: entry.postmarkText,
    footerText: entry.footerText,
    living: entry.motionSrc
      ? {
          motionSrc: entry.motionSrc,
          durationSeconds: entry.durationSeconds ?? undefined,
          revealLineAlignment: entry.revealLineAlignment ?? undefined,
        }
      : undefined,
  }
}
