import { helperTextClass } from '@/app/profile/ui'

/**
 * Release Polish Pass — a restrained, intentional empty state for
 * Keepsakes → Your Postcards, replacing a single explanatory line of
 * text sitting alone on an otherwise-enormous blank canvas. A small
 * line-art Postcard motif (same stroke-icon language as every other
 * icon in this app) sits above two short lines — no gamification, no
 * rarity/counters/collection-progress language, no purchase UI, no
 * fake placeholder Postcards.
 */
function PostcardMotif() {
  return (
    <svg
      viewBox="0 0 64 44"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-11 w-16 text-foreground/25"
      aria-hidden="true"
    >
      <rect x="1" y="1" width="62" height="42" rx="3" />
      <line x1="34" y1="1" x2="34" y2="43" />
      <line x1="42" y1="10" x2="56" y2="10" />
      <line x1="42" y1="17" x2="56" y2="17" />
      <line x1="42" y1="24" x2="50" y2="24" />
      <rect x="44" y="30" width="12" height="9" rx="1" />
    </svg>
  )
}

export default function KeepsakesEmptyState() {
  return (
    <div className="flex flex-col items-center gap-3 rounded-md border border-foreground/10 px-6 py-14 text-center">
      <PostcardMotif />
      <div className="space-y-1">
        <p className="text-[15px] font-medium text-foreground">No Postcards here yet.</p>
        <p className={helperTextClass}>When someone sends you one, it will appear here after it arrives.</p>
      </div>
    </div>
  )
}
