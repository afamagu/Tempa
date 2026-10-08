'use client'

import { useEffect, useRef, useState } from 'react'
import { primaryButtonClass, secondaryButtonClass, helperTextClass } from '@/app/profile/ui'

export const VIDEO_MOMENT_MAX_SECONDS = 10

export default function VideoMomentTrimDialog({
  src,
  duration,
  onCancel,
  onConfirm,
}: {
  src: string
  duration: number
  onCancel: () => void
  onConfirm: (trimStartSeconds: number, durationSeconds: number) => void
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const maxStart = Math.max(0, duration - VIDEO_MOMENT_MAX_SECONDS)
  const clipDuration = Math.min(duration, VIDEO_MOMENT_MAX_SECONDS)
  const [start, setStart] = useState(0)

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.currentTime = start
  }, [start])

  function handleTimeUpdate() {
    const video = videoRef.current
    if (!video) return
    if (video.currentTime >= start + clipDuration) {
      video.pause()
      video.currentTime = start
    }
  }

  return (
    <div className="safe-overlay-pad fixed inset-0 z-[70] flex items-center justify-center bg-foreground/55">
      <div className="w-full max-w-md space-y-4 rounded-xl bg-background p-4 shadow-xl">
        <div>
          <h2 className="font-serif text-xl">Choose your Moment</h2>
          <p className={helperTextClass}>
            {duration > VIDEO_MOMENT_MAX_SECONDS
              ? 'Move the window to choose the 10 seconds you want to share.'
              : 'Preview the clip before attaching it.'}
          </p>
        </div>
        <video
          ref={videoRef}
          src={src}
          controls
          playsInline
          preload="metadata"
          onTimeUpdate={handleTimeUpdate}
          className="max-h-[55vh] w-full rounded-lg bg-black object-contain"
        />
        {maxStart > 0 && (
          <label className="block space-y-2">
            <span className={helperTextClass}>Start at {start.toFixed(1)}s · ends at {(start + clipDuration).toFixed(1)}s</span>
            <input
              type="range"
              min={0}
              max={maxStart}
              step={0.1}
              value={start}
              onChange={(e) => {
                const next = Number(e.target.value)
                setStart(next)
                const video = videoRef.current
                if (video) {
                  video.pause()
                  video.currentTime = next
                }
              }}
              className="w-full"
              aria-label="Choose video Moment start time"
            />
          </label>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>Cancel</button>
          <button type="button" onClick={() => onConfirm(start, clipDuration)} className={primaryButtonClass}>Attach video</button>
        </div>
      </div>
    </div>
  )
}
