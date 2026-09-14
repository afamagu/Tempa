/**
 * Release Polish Pass — TEMPA's one recognizable cross-product writing
 * mark, extracted from app/letters/with/[userId]/write-quill-button.tsx
 * (previously defined only there) so every "write/compose" affordance
 * across the app — the archive's own floating quill action, The
 * Board's "Write a Dispatch," and any future one — draws from the
 * exact same glyph rather than each surface inventing its own.
 */
export default function QuillIcon({ className = 'h-5 w-5' }: { className?: string }) {
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
      <path d="M19 5c-4 0-9.5 2-12.5 8.5C5.2 15.9 4.5 18 4 20c2-.5 4.1-1.2 6.5-2.5C17 14.5 19 9 19 5Z" />
      <path d="M11 13 5.5 18.5" />
    </svg>
  )
}
