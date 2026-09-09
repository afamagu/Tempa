/**
 * A restrained "take this out of my tray" glyph for the compact
 * Remove from my Letterbox control — an open tray/letterbox slot with
 * an outward arrow. Deliberately NOT a trash-can silhouette (no lid,
 * no shred lines): this hides a correspondence from the viewer's OWN
 * Letterbox only and never destroys anything (see
 * remove-from-letterbox.tsx), so the icon must never read as delete/
 * destroy. Same stroke-icon language as every other icon in this app
 * (viewBox 0 0 24 24, strokeWidth 1.5, round caps/joins, currentColor).
 */
export default function RemoveFromLetterboxIcon({
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
      <path d="M4.5 13.5h4l1.4 2h4.2l1.4-2h4" />
      <path d="M4.5 13.5v5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5v-5" />
      <path d="M12 10.5V3" />
      <path d="M9 6l3-3 3 3" />
    </svg>
  )
}
