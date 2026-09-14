/**
 * Release Polish Pass — a plain, static envelope glyph for quiet
 * correspondence-status notices (e.g. "This letter went unanswered").
 * Deliberately distinct from app/mail-in-transit-icon.tsx, which adds
 * motion lines specifically for "still travelling" — this one has none,
 * since an unanswered/closed letter is a settled state, not an
 * in-progress one. Same stroke-icon language as every other icon in
 * this app (viewBox 0 0 24 24, strokeWidth 1.5, round caps/joins,
 * currentColor).
 */
export default function EnvelopeIcon({ className = 'h-4 w-4' }: { className?: string }) {
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
      <rect x="2.5" y="5" width="19" height="14" rx="1.5" />
      <path d="m2.5 6 9.5 7 9.5-7" />
    </svg>
  )
}
