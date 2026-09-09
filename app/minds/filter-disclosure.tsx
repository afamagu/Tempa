'use client'

import { useState } from 'react'
import DiscoveryFilters from './discovery-filters'
import { secondaryButtonClass, quietLinkClass } from '@/app/profile/ui'

/**
 * Desktop keeps the filters open (plenty of width). Mobile hides them
 * behind a compact "Filter" toggle instead of permanently consuming
 * vertical space above the writing — tapping it reveals the same
 * DiscoveryFilters in an inline panel, and applying or dismissing a
 * filter closes the panel again, returning straight to Explore.
 */
export default function FilterDisclosure({
  country,
  gender,
  ageRange,
}: {
  country: string
  gender: string
  ageRange: string
}) {
  const [open, setOpen] = useState(false)
  const activeCount = [country, gender, ageRange].filter(Boolean).length

  return (
    <div>
      <div className="sm:hidden">
        <button type="button" onClick={() => setOpen((o) => !o)} className={secondaryButtonClass}>
          Filter{activeCount > 0 ? ` (${activeCount})` : ''}
        </button>
        {open && (
          <div className="mt-4 space-y-4 rounded-md border border-foreground/10 p-4">
            <DiscoveryFilters
              country={country}
              gender={gender}
              ageRange={ageRange}
              onApply={() => setOpen(false)}
            />
            <button
              type="button"
              onClick={() => setOpen(false)}
              className={quietLinkClass}
            >
              Done
            </button>
          </div>
        )}
      </div>

      <div className="hidden sm:block">
        <DiscoveryFilters country={country} gender={gender} ageRange={ageRange} />
      </div>
    </div>
  )
}
