'use client'

import { useEffect, useState } from 'react'
import { helperTextClass, sectionLabelClass, inputClass, secondaryButtonClass } from '@/app/profile/ui'
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
function PostcardCard({ postcard, onSelect }: { postcard: PostcardCatalogEntry; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="group overflow-hidden rounded-lg border border-foreground/12 bg-background text-left transition hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span className="relative block aspect-[9/16] w-full overflow-hidden bg-foreground/[0.04]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={postcard.frontImagePath}
          alt=""
          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
        />
        {postcard.motionSrc && (
          <span className="absolute bottom-2 right-2 rounded-full bg-background/90 px-2 py-1 text-[10px] font-medium shadow-sm">
            Living
          </span>
        )}
      </span>
      <span className="block p-2.5">
        <span className="block truncate text-[13px] font-semibold text-foreground">{postcard.title}</span>
        <span className="mt-0.5 block truncate text-[11px] text-muted">{postcard.location}</span>
      </span>
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
  const [visibleCount, setVisibleCount] = useState(12)
  const filtered = filterPostcardCatalog(postcards, query)
  const visible = filtered.slice(0, visibleCount)

  useEffect(() => setVisibleCount(12), [query])

  return (
    <div className="mx-auto w-full max-w-2xl space-y-4 rounded-lg border border-foreground/10 bg-background p-4 sm:p-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className={sectionLabelClass}>Postcards</p>
          <p className="mt-1 text-sm text-muted">Choose a place for your letter.</p>
        </div>
        {postcards.length > 0 && <span className="text-xs text-muted">{filtered.length} available</span>}
      </div>

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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
          {visible.map((postcard) => (
            <PostcardCard key={postcard.key} postcard={postcard} onSelect={() => onSelect(postcard.key)} />
          ))}
        </div>
      )}

      {visibleCount < filtered.length && (
        <button
          type="button"
          className={`w-full ${secondaryButtonClass}`}
          onClick={() => setVisibleCount((count) => count + 12)}
        >
          Show 12 more
        </button>
      )}

      <button type="button" onClick={onCancel} className={helperTextClass}>
        Cancel
      </button>
    </div>
  )
}
