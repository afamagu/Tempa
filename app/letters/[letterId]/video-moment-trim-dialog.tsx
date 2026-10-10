'use client'

import { useEffect, useRef, useState } from 'react'
import { primaryButtonClass, secondaryButtonClass, helperTextClass } from '@/app/profile/ui'

export const VIDEO_MOMENT_MAX_SECONDS = 10

export default function VideoMomentTrimDialog({ src, duration, onCancel, onConfirm, busy = false, progress, error }: {
  src: string
  duration: number
  onCancel: () => void
  onConfirm: (trimStartSeconds: number, durationSeconds: number) => void
  busy?: boolean
  progress?: string | null
  error?: string | null
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const maxStart = Math.max(0, duration - VIDEO_MOMENT_MAX_SECONDS)
  const clipDuration = Math.min(duration, VIDEO_MOMENT_MAX_SECONDS)
  const [start, setStart] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  useEffect(() => {
    const video = videoRef.current
    if (video) { video.pause(); video.currentTime = start }
  }, [start])
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [])

  function enforceWindow() {
    const video = videoRef.current
    if (!video) return
    if (video.currentTime < start || video.currentTime >= start + clipDuration) {
      video.pause()
      video.currentTime = start
    }
  }
  async function preview() {
    const video = videoRef.current
    if (!video) return
    if (!video.paused) { video.pause(); return }
    setPreviewError(null)
    video.currentTime = start
    try { await video.play() } catch { setPreviewError('Preview could not play. Try again or choose a different video.') }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="video-trim-title" className="safe-overlay-pad fixed inset-0 z-[70] overflow-y-auto bg-foreground/55">
      <div className="mx-auto my-4 w-full max-w-md space-y-4 rounded-xl bg-background p-4 shadow-xl">
        <div>
          <h2 id="video-trim-title" className="font-serif text-xl">Choose your Moment</h2>
          <p className={helperTextClass}>Move the highlighted window to choose up to 10 seconds. Only this clip will be shared.</p>
        </div>
        <video ref={videoRef} src={src} playsInline preload="auto"
          onLoadedMetadata={() => { if (videoRef.current) videoRef.current.currentTime = start }}
          onTimeUpdate={enforceWindow} onSeeking={enforceWindow}
          onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)}
          onError={() => setPreviewError('This browser cannot preview this video. Choose another video or export it as MP4.')}
          className="max-h-[45dvh] w-full rounded-lg bg-black object-contain" />
        <button type="button" disabled={busy} onClick={preview} className={secondaryButtonClass}>{playing ? 'Pause preview' : 'Preview selected clip'}</button>
        <div className="space-y-2">
          <p className={helperTextClass}>Selected: {start.toFixed(1)}s – {(start + clipDuration).toFixed(1)}s · {clipDuration.toFixed(1)} seconds</p>
          <div aria-hidden="true" className="relative h-10 overflow-hidden rounded-md bg-foreground/15">
            <div className="absolute inset-y-0 rounded border-2 border-accent bg-accent/30" style={{ left: `${start / duration * 100}%`, width: `${clipDuration / duration * 100}%` }} />
          </div>
          <input type="range" min={0} max={maxStart} step={0.1} value={start} disabled={busy || maxStart === 0}
            onChange={(event) => setStart(Number(event.target.value))} className="h-10 w-full"
            aria-label="Choose video Moment start time" aria-valuetext={`${start.toFixed(1)} to ${(start + clipDuration).toFixed(1)} seconds`} />
          <div className={`flex justify-between ${helperTextClass}`}><span>0s</span><span>{duration.toFixed(1)}s</span></div>
        </div>
        {previewError && <p role="alert" className="text-sm text-red-600">{previewError}</p>}
        {progress && <p role="status" aria-live="polite" className={helperTextClass}>{progress}</p>}
        {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className={secondaryButtonClass}>Cancel</button>
          <button type="button" disabled={busy || Boolean(previewError)} onClick={() => { videoRef.current?.pause(); onConfirm(start, clipDuration) }} className={primaryButtonClass}>{busy ? 'Adding video…' : error ? 'Retry attach' : 'Attach video'}</button>
        </div>
      </div>
    </div>
  )
}
