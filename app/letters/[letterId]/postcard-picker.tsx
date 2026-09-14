'use client'

import { useState } from 'react'
import { helperTextClass, sectionLabelClass, inputClass } from '@/app/profile/ui'
import { filterPostcardCatalog, type PostcardCatalogEntry } from '@/lib/postcards'

/**
 * Tempa's own postcard catalog — never the device photo library. Admin
 * Phase 2A-2 — `postcards` is the live, ACTIVE DB-backed catalogue
 * (lib/postcards.ts's getActivePostcards), fetched once by the caller
 * (moments-composer.tsx) rather than a hand-maintained TypeScript list:
 * a Postcard added entirely through Admin appears here with zero
 * picker changes.
 *
 * Release Polish Pass — simplified into an honest catalogue for first
 * release: the previous Featured/My Postcards/Places/Collections
 * section scaffolding (three of which were permanent "nothing here
 * yet" placeholders) read as an unfinished product and is removed.
 * Received Keepsakes are deliberately NOT surfaced as a "My Postcards"
 * section here — receiving a Postcard never implies the recipient now
 * "owns" a design they may send; that would blur Keepsakes (a
 * received-mail archive) with the send-time catalogue. A restrained
 * search field (matching the same fields as Admin's own catalogue
 * search) is added ahead of the catalogue eventually holding scores of
 * Postcards.
 */
function PostcardCard({
  postcard,
  onSelect,
}: {
  postcard: PostcardCatalogEntry
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex flex-col items-start gap-1 rounded-md border border-foreground/15 p-2 text-left transition-colors hover:border-accent"
    >
      <img
        src={postcard.frontImagePath}
        alt=""
        className="h-20 w-full rounded object-cover"
      />
      <span className="truncate text-[12px] font-medium text-foreground">{postcard.title}</span>
      <span className="truncate text-[11px] text-muted">{postcard.location}</span>
    </button>
  )
}

export default function PostcardPicker({
  postcards,
  onSelect,
  onCancel,
}: {
  /** The live, active DB catalogue — fetched by the caller. An empty
   * array (fetch still pending, or genuinely nothing active yet) shows
   * an honest empty state rather than stale hard-coded cards. */
  postcards: PostcardCatalogEntry[]
  onSelect: (postcardKey: string) => void
  onCancel: () => void
}) {
  const [query, setQuery] = useState('')
  const filtered = filterPostcardCatalog(postcards, query)

  return (
    <div className="mx-auto w-full max-w-sm space-y-4 rounded-md border border-foreground/10 p-4">
      <p className={sectionLabelClass}>Postcards</p>

      {postcards.length > 0 && (
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search Postcards…"
          aria-label="Search Postcards"
          className={inputClass}
        />
      )}

      {postcards.length === 0 ? (
        <p className={helperTextClass}>No postcards available right now.</p>
      ) : filtered.length === 0 ? (
        <p className={helperTextClass}>No Postcards match &ldquo;{query.trim()}&rdquo;.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {filtered.map((postcard) => (
            <PostcardCard key={postcard.key} postcard={postcard} onSelect={() => onSelect(postcard.key)} />
          ))}
        </div>
      )}

      <button type="button" onClick={onCancel} className={helperTextClass}>
        Cancel
      </button>
    </div>
  )
}
