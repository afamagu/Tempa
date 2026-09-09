/**
 * A restrained envelope-in-motion glyph — the one visual for "mail on
 * the way" across Home and Letterbox Level 1. Same stroke-icon
 * language as every other icon in this app (viewBox 0 0 24 24,
 * strokeWidth 1.5, round caps/joins, currentColor) — never a raw
 * emoji. The three trailing lines are the only "motion" cue; the
 * envelope itself stays a plain, legible shape at small sizes.
 */
export default function MailInTransitIcon({
  className = 'h-4 w-4',
}: {
  className?: string
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      <rect x="2.5" y="6.5" width="13" height="10" rx="1.5" />
      <path d="m2.5 7.5 6.5 4.5 6.5-4.5" />
      <path d="M18 10.5h3.5M18 13h3M18 15.5h2.5" />
    </svg>
  )
}
