'use client'

/**
 * A finished letter's read-only counterpart to the composer's inline
 * photo token (photo-moment-node.tsx) — deliberately the same rough
 * size and inline placement at the end of its paragraph, never a large
 * block between paragraphs. Tapping it opens the full photo via
 * `onOpen`; the actual full-screen viewer lives once per letter body
 * (see photo-moment-viewer.tsx), not once per token.
 */
export default function PhotoMomentToken({ src, onOpen }: { src: string; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Open this photo"
      className="ml-1 inline-block h-7 w-7 shrink-0 overflow-hidden rounded align-middle"
    >
      <img src={src} alt="" className="h-full w-full object-cover" />
    </button>
  )
}
