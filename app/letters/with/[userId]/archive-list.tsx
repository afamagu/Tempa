import Link from 'next/link'
import { helperTextClass } from '@/app/profile/ui'
import { formatDateTimeCompact } from '@/lib/format-date'
import { letterPreviewText, isRichBody, resolveLetterDirection, type ArchiveLetter } from '@/lib/letters'
import FormattedText from '@/app/letters/formatted-text'

// A restrained camera/photo glyph, matching this codebase's existing
// stroke-icon convention (viewBox 0 0 24 24, strokeWidth 1.5). Shown
// only when this specific letter contains at least one Photo Moment —
// never a combined photo+postcard count the way the old Letterbox row
// indicator was.
function PhotoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3 w-3 text-foreground/45"
      aria-hidden="true"
    >
      <rect x="3.5" y="5.5" width="17" height="14" rx="1.5" />
      <circle cx="9" cy="11" r="2" />
      <path d="m5 17 4.5-4.5c.6-.6 1.4-.6 2 0L15 16l1.5-1.5c.6-.6 1.4-.6 2 0L21 17" />
    </svg>
  )
}

// Letterbox Postcard indicator (pre-beta UX polish batch 1) — a small
// TRADITIONAL HORIZONTAL postcard: a wide outlined card, a tiny stamp
// square at the upper right, and two short address lines beneath it.
// Deliberately never PhotoIcon's tall 9:16-ish photo-frame silhouette
// (this one is wide, not tall), never a phone (no rounded-corner
// vertical body/notch), and never a video/player glyph (no play
// triangle) — see letter.hasLetterPostcard in lib/letters.ts, sourced
// from the NEW letter-level Postcard table, never the old inline
// Moment Postcard rows momentCounts.postcard counts.
function PostcardIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-3 w-3 text-foreground/45"
      aria-hidden="true"
    >
      <rect x="2.5" y="6" width="19" height="12" rx="1.5" />
      <rect x="15.5" y="8" width="4" height="3.2" rx="0.4" />
      <path d="M5 13h6" />
      <path d="M5 15.5h4" />
    </svg>
  )
}

// Compact, portrait, tappable — a single item in a collection, not a
// row in a feed. Proportion/repetition/spacing/typography carry the
// "collection of exchanged letters" feeling; nothing here draws an
// actual envelope, stamp, or paper texture. A card is a preview/
// navigation surface, never a reading surface: the body preview is the
// letter's first paragraph (letterPreviewText, lib/letters.ts),
// CSS-clamped to 2 lines on top of that — recognition, not reading, is
// the point at this level, and a long letter must not grow this card.
function ArchiveCard({
  letter,
  viewerId,
  pseudonymById,
}: {
  letter: ArchiveLetter
  viewerId: string
  pseudonymById: Map<string, string>
}) {
  // Direction is resolved the same objectively-correct way as
  // everywhere else in this app (resolveLetterDirection, never a
  // viewer-relative branch, and never inferred from the letter's own
  // body text) — "You" is purely a display substitution for the
  // viewer's own already-correct name, not a second way of deciding
  // who sent it.
  const { senderName } = resolveLetterDirection(letter, pseudonymById)
  const senderLabel = letter.senderId === viewerId ? 'You' : senderName
  // is_unread is already scoped to "I am the recipient and haven't
  // opened it" by letters_for_participant itself — never true for the
  // viewer's own sent letters, so no extra direction check is needed
  // here.
  const unread = letter.isUnread

  return (
    <Link
      href={`/letters/${letter.id}`}
      aria-label={unread ? `${senderLabel} — unread` : senderLabel}
      className={`flex aspect-[3/4] flex-col rounded-md border p-2.5 transition-colors hover:bg-foreground/[.02] ${
        unread ? 'border-accent/50 bg-accent/[.04] hover:border-accent/70' : 'border-foreground/10 hover:border-foreground/25'
      }`}
    >
      <div className="flex items-baseline justify-between gap-1">
        <span
          className={`flex min-w-0 items-center gap-1 truncate text-[11px] ${
            unread ? 'font-semibold text-foreground' : 'font-medium text-foreground/75'
          }`}
        >
          {unread && (
            <span aria-hidden="true" className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
          )}
          {senderLabel}
        </span>
        <span className="shrink-0 text-[10px] text-muted">{formatDateTimeCompact(letter.createdAt)}</span>
      </div>

      <div className="mt-1.5 flex-1 rounded bg-surface-shell p-1.5">
        <p
          className={`line-clamp-2 whitespace-pre-wrap font-serif text-[12px] leading-snug ${
            unread ? 'text-foreground/85' : 'text-foreground/70'
          }`}
        >
          <FormattedText text={letterPreviewText(letter.body)} isRich={isRichBody(letter.body)} />
        </p>
      </div>

      {(letter.momentCounts.photo > 0 || letter.hasLetterPostcard) && (
        <div className="mt-auto flex justify-end gap-1 pt-1">
          {letter.momentCounts.photo > 0 && (
            <span role="img" aria-label="Contains photos" title="Contains photos">
              <PhotoIcon />
            </span>
          )}
          {letter.hasLetterPostcard && (
            <span role="img" aria-label="Contains a Postcard" title="Contains a Postcard">
              <PostcardIcon />
            </span>
          )}
        </div>
      )}
    </Link>
  )
}

/**
 * Letterbox Level 2 — a compact grid of this person's exchanged
 * letters, each its own small portrait card (a collection to browse
 * and recognize, not a feed to scroll). Never a flattened chat
 * transcript. Clicking a card opens the existing, unmodified
 * individual-letter reader at /letters/[letterId].
 */
export default function ArchiveList({
  letters,
  viewerId,
  otherUserId,
  otherPseudonym,
  viewerPseudonym,
}: {
  letters: ArchiveLetter[]
  viewerId: string
  otherUserId: string
  otherPseudonym: string
  viewerPseudonym: string
}) {
  const pseudonymById = new Map([
    [viewerId, viewerPseudonym],
    [otherUserId, otherPseudonym],
  ])

  if (letters.length === 0) {
    return <p className={helperTextClass}>No visible letters with {otherPseudonym} yet.</p>
  }

  return (
    <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 sm:gap-3 md:grid-cols-5 lg:grid-cols-6">
      {letters.map((letter) => (
        <ArchiveCard key={letter.id} letter={letter} viewerId={viewerId} pseudonymById={pseudonymById} />
      ))}
    </div>
  )
}
