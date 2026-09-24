import Image from 'next/image'

// Brand asset pass (2026-09-24) — the approved Tempa master logo is a
// FULL LOCKUP (dove emblem + TEMPA wordmark + tagline), never a small
// icon. Use this ONLY where there is genuine room for it to breathe —
// a substantial logged-out/public branding area — never squeezed into
// nav/sidebar chrome, never as a favicon, never with its aspect ratio
// distorted. The compact textual wordmark elsewhere in the app (e.g.
// app/legal-shell.tsx's own small italic "Tempa" link) remains correct
// for those tighter contexts and is left exactly as it was.
//
// Source is a square 1254x1254 PNG (public/brand/tempa-logo-master.png,
// copied byte-for-byte from the approved local asset, no recompression).
// width/height are passed through directly as the INTENDED rendered
// size (not the full source resolution) — this is what lets next/image
// request an appropriately small optimized file instead of always
// fetching near the full 1254px source for what may only ever be
// displayed at ~180px, while still preventing layout shift and always
// preserving the source's own 1:1 ratio (height === width, so the
// lockup can never be stretched).
export default function TempaBrandLogo({
  width = 180,
  priority = false,
  className = '',
}: {
  /** Rendered width AND height in CSS pixels (the source is square) —
   * the tagline baked into the source image becomes illegible well
   * below ~140px; do not go smaller than that without a genuine
   * reason. */
  width?: number
  priority?: boolean
  className?: string
}) {
  return (
    <Image
      src="/brand/tempa-logo-master.png"
      alt="Tempa — A more human way to connect"
      width={width}
      height={width}
      priority={priority}
      className={className}
    />
  )
}
