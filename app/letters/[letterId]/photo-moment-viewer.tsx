'use client'

import { useEffect } from 'react'
import ReportButton from '@/app/report-button'

/**
 * The tiny token's tap target: a plain full-screen overlay, not a
 * navigation — closing it removes the overlay and leaves the letter
 * exactly where it was, at whatever scroll position the reader was
 * already at. One instance per letter body, reused for whichever token
 * was tapped, rather than one per Moment.
 *
 * `momentId` is optional so this stays usable anywhere a caller has no
 * reportable identity for the image yet — when present (every real
 * letter/Dispatch photo Moment call site), it renders a quiet Report
 * entry point; report_content itself (docs/sql/2026-09-17-reporting-
 * and-admin-moderation.sql) resolves whether the id names a letter or
 * Dispatch photo and derives the reported member server-side.
 */
export default function PhotoMomentViewer({
  src,
  alt,
  momentId,
  onClose,
}: {
  src: string
  alt: string
  momentId?: string
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
      {momentId && (
        <div
          onClick={(e) => e.stopPropagation()}
          className="absolute bottom-4 left-1/2 w-64 max-w-[calc(100%-2rem)] -translate-x-1/2"
        >
          <ReportButton
            targetType="photo_moment"
            targetId={momentId}
            triggerClassName="text-[13px] text-white/70 underline decoration-white/30 underline-offset-4 transition-colors hover:text-white"
            triggerLabel="Report this photo"
            panelClassName="rounded-md bg-background p-3 shadow-md"
          />
        </div>
      )}
    </div>
  )
}
