import Image from 'next/image'

// Brand asset correction (2026-09-24) — the full poster-style master
// lockup (public/brand/tempa-logo-master.png) did not read as premium
// pasted above the /sign-in card: visible outer canvas, a tagline
// baked in too small to matter, too much separation from the actual
// interface. public/brand/tempa-emblem.png is a tight, undistorted crop
// of ONLY the rounded coloured field + dove from that same approved
// source (no wordmark, no tagline, no large outer margin) — meant for
// SMALL, compact placements where a live text wordmark sits beside it,
// never at poster size. The full master lockup stays in the repo as
// the marketing/master asset; it is not rendered anywhere in app UI.
export default function TempaEmblem({
  size = 32,
  priority = false,
  className = '',
}: {
  /** Rendered width AND height in CSS pixels (the source is square). */
  size?: number
  priority?: boolean
  className?: string
}) {
  return (
    <Image
      src="/brand/tempa-emblem.png"
      alt=""
      aria-hidden="true"
      width={size}
      height={size}
      priority={priority}
      className={className}
    />
  )
}
