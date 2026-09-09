import Link from 'next/link'
import Tooltip from '@/app/profile/tooltip'

function QuillIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-5 w-5"
      aria-hidden="true"
    >
      <path d="M19 5c-4 0-9.5 2-12.5 8.5C5.2 15.9 4.5 18 4 20c2-.5 4.1-1.2 6.5-2.5C17 14.5 19 9 19 5Z" />
      <path d="M11 13 5.5 18.5" />
    </svg>
  )
}

/**
 * The restrained, always-reachable "write to this person" affordance
 * on their archive — a small floating circular action, not a large
 * text button, positioned to stay clear of the archive grid and the
 * mobile bottom nav (fixed inset-x-0 bottom-0 z-40 in app-shell.tsx).
 * The icon alone is never the accessibility mechanism: a real
 * aria-label carries it regardless of whether the Tooltip renders.
 */
export default function WriteQuillButton({ otherUserId, otherPseudonym }: { otherUserId: string; otherPseudonym: string }) {
  const label = `Write to ${otherPseudonym}`
  return (
    <Tooltip label={label}>
      <Link
        href={`/letters/with/${otherUserId}/write`}
        aria-label={label}
        className="fixed bottom-20 right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-lg transition-transform hover:scale-105 sm:bottom-8 sm:right-8"
      >
        <QuillIcon />
      </Link>
    </Tooltip>
  )
}
