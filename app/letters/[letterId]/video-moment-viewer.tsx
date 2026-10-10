'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { resolveLetterPhotoUrl } from '@/lib/draft-photo-url'
import type { Moment } from '@/lib/moments'

export default function VideoMomentViewer({ moment, onClose }: { moment: Moment; onClose: () => void }) {
  const [src, setSrc] = useState(moment.imageUrl)
  const [error, setError] = useState<string | null>(null)
  const [retrying, setRetrying] = useState(false)
  useEffect(() => {
    const before = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', escape)
    return () => { document.body.style.overflow = before; window.removeEventListener('keydown', escape) }
  }, [onClose])
  async function retry() {
    if (!moment.imagePath || retrying) return
    setRetrying(true)
    try {
      const result = await resolveLetterPhotoUrl(createClient(), moment.imagePath)
      if (result.url) { setSrc(result.url); setError(null) }
      else setError('This video could not be loaded. Check your connection and try again.')
    } finally { setRetrying(false) }
  }
  return <div role="dialog" aria-modal="true" aria-label="Video Moment" className="safe-overlay-pad fixed inset-0 z-50 flex items-center justify-center bg-foreground/60">
    <button type="button" aria-label="Close video" className="absolute inset-0" onClick={onClose} />
    <div className="relative z-10 max-h-[90vh] w-full max-w-lg rounded-lg bg-background p-3">
      {src && !error && <video key={src} src={src} controls autoPlay playsInline
        onError={() => setError('This video could not be loaded. Check your connection and try again.')}
        onLoadedMetadata={(event) => { event.currentTarget.currentTime = moment.trimStartSeconds ?? 0 }}
        onTimeUpdate={(event) => {
          const start = moment.trimStartSeconds ?? 0
          if (event.currentTarget.currentTime >= start + (moment.durationSeconds ?? 10)) {
            event.currentTarget.pause()
            event.currentTarget.currentTime = start
          }
        }}
        className="max-h-[80dvh] w-full rounded-lg bg-black object-contain" />}
      {error && <div className="space-y-3 p-4"><p role="alert" className="text-sm">{error}</p><button type="button" onClick={retry} disabled={retrying} className="underline">{retrying ? 'Loading…' : 'Retry video'}</button></div>}
      <button type="button" onClick={onClose} aria-label="Close" className="absolute -right-3 -top-3 flex h-11 w-11 items-center justify-center rounded-full bg-background text-lg text-foreground">×</button>
    </div>
  </div>
}
