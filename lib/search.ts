// Types and pure helpers for search_letterbox
// (docs/sql/2026-09-03-search-letterbox-rpc.sql) — the RPC itself is
// called directly from the client component via createClient().rpc(),
// the same pattern every other RPC in this app already uses; nothing
// here talks to Supabase.

export type SearchPersonResult = {
  kind: 'person'
  personId: string
  pseudonym: string
}

export type SearchLetterResult = {
  kind: 'letter'
  letterId: string
  correspondenceId: string
  otherPseudonym: string
  createdAt: string
  excerpt: string
}

export type SearchResult = SearchPersonResult | SearchLetterResult

/** The raw shape of one row returned by search_letterbox — every
 * column nullable per row since a 'person' row leaves the letter
 * columns null and vice versa (see the RPC's own RETURNS TABLE). */
export type SearchLetterboxRow = {
  kind: string
  person_id: string | null
  pseudonym: string | null
  letter_id: string | null
  correspondence_id: string | null
  other_pseudonym: string | null
  created_at: string | null
  excerpt: string | null
  rank: number | null
}

/**
 * Pure: maps one raw search_letterbox row to a typed result, or null
 * if it matches neither known shape — defensive only, since the RPC
 * itself never emits anything else; keeps a malformed/unexpected row
 * from ever reaching the UI as half-populated data.
 */
export function toSearchResult(row: SearchLetterboxRow): SearchResult | null {
  if (row.kind === 'person' && row.person_id && row.pseudonym) {
    return { kind: 'person', personId: row.person_id, pseudonym: row.pseudonym }
  }
  if (
    row.kind === 'letter' &&
    row.letter_id &&
    row.correspondence_id &&
    row.other_pseudonym &&
    row.created_at
  ) {
    return {
      kind: 'letter',
      letterId: row.letter_id,
      correspondenceId: row.correspondence_id,
      otherPseudonym: row.other_pseudonym,
      createdAt: row.created_at,
      excerpt: row.excerpt ?? '',
    }
  }
  return null
}

export function toSearchResults(rows: SearchLetterboxRow[]): SearchResult[] {
  return rows.map(toSearchResult).filter((r): r is SearchResult => r !== null)
}

export type ExcerptSegment = { text: string; highlighted: boolean }

const START_MARKER = '⟦⟦'
const END_MARKER = '⟧⟧'

/**
 * Pure: splits a search_letterbox excerpt — plain text with ⟦⟦/⟧⟧
 * sentinel markers around each matched span, from ts_headline's
 * StartSel/StopSel options in the RPC — into plain-text segments,
 * tagging which ones fall inside a matched span. Deliberately never
 * produces HTML: the caller renders a highlighted segment as a real
 * React <mark> element, never dangerouslySetInnerHTML.
 */
export function parseExcerptMarkers(excerpt: string): ExcerptSegment[] {
  const segments: ExcerptSegment[] = []
  const parts = excerpt.split(new RegExp(`(${START_MARKER}|${END_MARKER})`))
  let highlighted = false

  for (const part of parts) {
    if (part === START_MARKER) {
      highlighted = true
      continue
    }
    if (part === END_MARKER) {
      highlighted = false
      continue
    }
    if (part === '') continue
    segments.push({ text: part, highlighted })
  }

  return segments
}
