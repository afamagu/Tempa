'use client'

import { stateLabel, type CatalogueItem, type ItemState } from '@/lib/marketplace'

/**
 * One compact marketplace tile: the STILL front only (never motion),
 * cropped to a compact 3:4 window for browsing density (the full 9:16
 * Postcard is shown, uncropped, in product detail),
 * a short title, a quiet line of context and exactly one state —
 * Complimentary, Yours, or a Credit price. The image is lazy-loaded and
 * decoded off the main thread so hundreds of tiles stay light.
 */
export default function CatalogueTile({
  item,
  state,
  onOpen,
  showState,
}: {
  item: CatalogueItem
  state: ItemState
  onOpen: () => void
  showState: boolean
}) {
  const label = stateLabel(state, item.credits)
  const context = item.collection || item.location
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="catalogue-tile"
      data-key={item.key}
      data-state={state}
      aria-label={[item.title, context, showState && label ? label : ''].filter(Boolean).join(', ')}
      className="group flex flex-col overflow-hidden rounded-md text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-background"
    >
      <span className="relative block aspect-[3/4] w-full overflow-hidden rounded-md border border-foreground/10 bg-foreground/[0.04] shadow-sm transition group-hover:shadow-md">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={item.thumbnailSrc}
          alt=""
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover object-[center_60%] transition duration-300 group-hover:scale-[1.02] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
        />
      </span>
      <span className="mt-2 block min-w-0 px-0.5">
        <span className="block truncate text-[13px] font-medium leading-snug text-foreground">{item.title}</span>
        {context && <span className="block truncate text-[11px] leading-snug text-muted">{context}</span>}
        {showState && label && (
          <span
            aria-hidden="true"
            className={`mt-0.5 block text-[11px] leading-snug ${state === 'owned' ? 'font-medium text-accent' : state === 'available' ? 'text-foreground/80' : 'text-muted'}`}
          >
            {label}
          </span>
        )}
      </span>
    </button>
  )
}
