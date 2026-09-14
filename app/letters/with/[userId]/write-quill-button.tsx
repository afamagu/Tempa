import Link from 'next/link'
import Tooltip from '@/app/profile/tooltip'
import QuillIcon from '@/app/quill-icon'

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
