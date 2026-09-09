'use client'

import { useEffect } from 'react'

/**
 * The tiny token's tap target: a plain full-screen overlay, not a
 * navigation — closing it removes the overlay and leaves the letter
 * exactly where it was, at whatever scroll position the reader was
 * already at. One instance per letter body, reused for whichever token
 * was tapped, rather than one per Moment.
 */
export default function PhotoMomentViewer({
  src,
  alt,
  onClose,
}: {
  src: string
  alt: string
  onClose: () => void
}) {
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/90 p-4"
    >
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 flex h-9 w-9 items-center justify-center rounded-full bg-black/40 text-lg text-white"
      >
        ×
      </button>
      <img
        src={src}
        alt={alt}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full rounded-md object-contain"
      />
    </div>
  )
}
