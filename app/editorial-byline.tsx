/**
 * The editorial byline beneath a house account's pseudonym — a quill and
 * "Tempa House Columnist" (or whatever editorial_title Tempa set), in the
 * wordmark's serif, small caps, brand plum. Deliberately a newspaper-style
 * byline, never a "verified" badge: no fill, no border, no pill.
 *
 * Renders nothing without a title, so ordinary members are untouched and
 * any future house writer gets it automatically (lib/editorial-byline.ts).
 */
export default function EditorialByline({
  title,
  rule = false,
  wrap = false,
  className = '',
}: {
  title: string | null | undefined
  /** A 1px low-opacity plum hairline above — the full profile page only. */
  rule?: boolean
  /** For very narrow cards (Recommended minds): the quill sits centred
   * above the words, which wrap onto a balanced second line, instead of
   * truncating the disclosure or breaking raggedly beside the icon. */
  wrap?: boolean
  className?: string
}) {
  const text = title?.trim()
  if (!text) return null

  return (
    <span
      data-editorial-byline=""
      className={`flex min-w-0 font-serif text-[0.75rem] font-normal leading-tight tracking-[0.08em] text-plum [font-variant-caps:small-caps] ${
        wrap ? 'flex-col items-center gap-0.5 text-center [text-wrap:balance]' : 'max-w-full items-center gap-1'
      } ${rule ? 'mt-2 w-fit border-t border-plum/25 pt-1.5' : 'mt-0.5'} ${className}`}
    >
      <QuillIcon />
      <span className={wrap ? 'min-w-0' : 'min-w-0 truncate'}>{text}</span>
    </span>
  )
}

/** A simple feather pen: vane, rachis and nib, drawn in currentColor. */
function QuillIcon() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className="shrink-0"
    >
      <path d="M13.8 2.2C9.6 2.5 6.3 5 5 9.2l-.6 2.4 2.4-.6c4.2-1.3 6.7-4.6 7-8.8Z" />
      <path d="M13.8 2.2 6.6 9.4" />
      <path d="M9.3 4.4l.4 1.9M7.4 6.4l.5 1.7" />
      <path d="M4.4 11.6 2.2 13.8" />
    </svg>
  )
}
