'use client'

import { useState } from 'react'
import { findCountryIsoCode } from '@/app/profile/data'
import Tooltip from '@/app/profile/tooltip'

/**
 * Where the local flag SVGs live — copied once from the `country-flag-
 * icons` package (MIT, node_modules/country-flag-icons/3x2/*.svg) into
 * public/flags/ at development time, never fetched from node_modules at
 * runtime and never hotlinked from an external host. One small static
 * SVG file per ISO 3166-1 alpha-2 code, served like any other static
 * asset — the browser fetches only the flags actually shown on a page,
 * cached indefinitely afterward.
 */
const FLAG_BASE_PATH = '/flags'

/** Pure: the local static asset path for a given ISO code — exported
 * separately so the mapping itself is directly testable without
 * rendering anything. */
export function flagAssetPath(isoCode: string): string {
  return `${FLAG_BASE_PATH}/${isoCode.toUpperCase()}.svg`
}

/**
 * A compact country flag beside a member's pseudonym — "Pseudonym [flag]
 * · Date" (Board usability visual follow-up, 2026-09-09). Reuses
 * EXISTING data/utilities: `country` is the same plain country name
 * already shown as text elsewhere (Recommended Minds, the public
 * profile's demographics line); `findCountryIsoCode` (app/profile/
 * data.ts) already existed for the profile country picker's own ISO
 * lookup, reused here unchanged rather than duplicating a name→code
 * table.
 *
 * Visual-fidelity pass (2026-09-10): previously rendered the flag as a
 * Unicode Regional Indicator Symbol emoji — a live-test report found
 * this rendering as bare two-letter text ("BR", "NG") on some Windows/
 * browser combinations that lack flag-emoji glyphs, rather than a
 * graphical flag. Replaced with an actual vector asset (a local static
 * SVG per ISO code, package-backed, never hotlinked) so rendering is
 * deterministic across every platform/browser, at the cost of needing a
 * real image element instead of a text glyph. Fixed dimensions
 * (`h-[9px] w-[13px]`, a 3:2 flag aspect ratio) so a flag that fails to
 * load — an unmapped/garbled country value, or a future ISO code this
 * app hasn't copied an asset for — collapses to nothing instead of
 * shifting the surrounding identity row; `onError` hides the element
 * entirely rather than showing a broken-image icon.
 *
 * The country name is never shown permanently — only the flag — but is
 * always available: the button's own `aria-label` carries it
 * unconditionally (so a screen reader announces it regardless of
 * whether the visual disclosure is open), and Tooltip
 * (app/profile/tooltip.tsx) supplies the same hover/focus-on-desktop,
 * tap-to-toggle-on-mobile, outside-click/Escape-to-dismiss behavior
 * already used for every other icon-only control in this codebase —
 * never a bare HTML `title` attribute, which has no dependable mobile
 * interaction. Never exposes anything more precise than country (no
 * city/region/coordinates).
 *
 * Fails gracefully: renders nothing when `country` is null/empty, when
 * it doesn't resolve to a known ISO code, or when the asset itself
 * fails to load — the identity line's own flex layout closes the gap
 * correctly on its own, no reserved space needed.
 */
export default function CountryFlag({ country }: { country: string | null }) {
  const [broken, setBroken] = useState(false)

  if (!country) return null
  const isoCode = findCountryIsoCode(country)
  if (!isoCode || broken) return null

  return (
    <Tooltip label={country}>
      <button
        type="button"
        aria-label={`Country: ${country}`}
        className="inline-flex shrink-0 items-center justify-center rounded p-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- a tiny
            local static asset, not a candidate for next/image's
            optimization pipeline */}
        <img
          src={flagAssetPath(isoCode)}
          alt=""
          aria-hidden="true"
          className="h-[9px] w-[13px] shrink-0 rounded-[1px] object-cover"
          onError={() => setBroken(true)}
        />
      </button>
    </Tooltip>
  )
}
