'use client'

import { useState } from 'react'
import { filterAdminPostcards, type AdminPostcard } from '@/lib/admin-postcards'
import { inputClass, sectionLabelClass } from '@/app/profile/ui'
import { adminMetadataClass } from '@/app/admin/admin-ui'
import PostcardRow from './postcard-row'

/**
 * Release Polish Pass — Admin → Content → Postcards' own catalogue
 * search, added ahead of the catalogue eventually holding scores/
 * hundreds of Postcards. Client-side filtering over the already-
 * fetched full list (filterAdminPostcards, lib/admin-postcards.ts) —
 * no new RPC/pagination, matching this checkpoint's own "smallest
 * clean implementation" instruction for the current catalogue size.
 * Active/Inactive sections are preserved exactly as before, just now
 * computed from the filtered list rather than the full one.
 */
export default function PostcardsCatalogue({ postcards }: { postcards: AdminPostcard[] }) {
  const [query, setQuery] = useState('')
  const filtered = filterAdminPostcards(postcards, query)
  const active = filtered.filter((p) => p.isActive)
  const inactive = filtered.filter((p) => !p.isActive)
  const isSearching = query.trim() !== ''

  return (
    <div className="space-y-6">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search Postcards…"
        aria-label="Search Postcards"
        className={inputClass}
      />

      {isSearching && filtered.length === 0 ? (
        <p className={adminMetadataClass}>No Postcards match &ldquo;{query.trim()}&rdquo;.</p>
      ) : (
        <>
          <div className="space-y-3">
            <p className={sectionLabelClass}>Active</p>
            {active.length === 0 ? (
              <p className={adminMetadataClass}>No active Postcards {isSearching ? 'match this search.' : 'yet.'}</p>
            ) : (
              <div className="space-y-3">
                {active.map((postcard) => (
                  <PostcardRow key={postcard.key} postcard={postcard} />
                ))}
              </div>
            )}
          </div>

          {inactive.length > 0 && (
            <div className="space-y-3">
              <p className={sectionLabelClass}>Inactive</p>
              <div className="space-y-3">
                {inactive.map((postcard) => (
                  <PostcardRow key={postcard.key} postcard={postcard} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
