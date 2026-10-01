import Link from 'next/link'
import QuillIcon from '@/app/quill-icon'

/**
 * The restrained, always-reachable "write to this person" affordance
 * on their archive — a small floating circular action, not a large
 * text button, positioned to stay clear of the archive grid and the
 * mobile bottom nav (fixed inset-x-0 bottom-0 z-40 in app-shell.tsx).
 *
 * A quiet text pill sits immediately to the quill's left and names the
 * action, persistently on every viewport (never hover/tooltip-only).
 * Pill + quill are ONE link — one hover/focus/pressed state, one
 * destination — so there is no second action beside it. The quill
 * glyph is aria-hidden; the link's accessible name is the same wording
 * as the visible label, so what's seen is what's announced.
 *
 * `replyToId` — set only from a single incoming letter (see
 * lib/letters.ts quillReplyToId): the composer then opens as a reply to
 * that exact letter and the label reads "Reply to this letter". The
 * archive's quill, and the one on the viewer's own sent letter, omit it
 * (a fresh letter) and read "Write to {name}".
 */
export default function WriteQuillButton({
  otherUserId,
  otherPseudonym,
  replyToId = null,
}: {
  otherUserId: string
  otherPseudonym: string
  replyToId?: string | null
}) {
  const label = replyToId ? 'Reply to this letter' : `Write to ${otherPseudonym}`
  const href = replyToId
    ? `/letters/with/${otherUserId}/write?replyTo=${encodeURIComponent(replyToId)}`
    : `/letters/with/${otherUserId}/write`
  return (
    <Link
      href={href}
      aria-label={label}
      className="group fixed bottom-20 right-4 z-40 flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-full sm:bottom-8 sm:right-8"
    >
      <span className="min-w-0 max-w-[16rem] truncate rounded-full border border-foreground/15 bg-background px-3 py-1.5 text-[13px] text-foreground/70 shadow-sm transition-colors group-hover:border-foreground/30 group-hover:text-foreground group-active:text-foreground">
        {label}
      </span>
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground shadow-lg transition-transform group-hover:scale-105 group-active:scale-100">
        <QuillIcon />
      </span>
    </Link>
  )
}
