'use client'

import { useEffect, useState } from 'react'
import ProfileIdentityMark from '@/app/profile-identity-mark'

export default function ProfileMarkViewer({ identifier, markUrl, pseudonym }: {
  identifier: string
  markUrl: string | null
  pseudonym: string
}) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  if (!markUrl) return <ProfileIdentityMark identifier={identifier} markUrl={null} size="lg" />

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-label={`View ${pseudonym}’s Mark`} className="shrink-0 rounded-md transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
        <ProfileIdentityMark identifier={identifier} markUrl={markUrl} label={`${pseudonym}’s Mark`} size="lg" />
      </button>
      {open && (
        <div role="dialog" aria-modal="true" aria-labelledby="profile-mark-title" onClick={() => setOpen(false)} className="fixed inset-0 z-[110] flex items-center justify-center bg-background/95 p-5 backdrop-blur-sm">
          <button type="button" onClick={() => setOpen(false)} aria-label="Close Mark" className="absolute right-5 top-5 flex h-10 w-10 items-center justify-center rounded-full border border-foreground/15 text-xl text-foreground/70 transition-colors hover:text-foreground">×</button>
          <div onClick={(event) => event.stopPropagation()} className="flex w-full max-w-xl flex-col items-center gap-7">
            <h2 id="profile-mark-title" className="font-serif text-[24px] text-foreground sm:text-[30px]">{pseudonym}’s Mark</h2>
            <ProfileIdentityMark identifier={identifier} markUrl={markUrl} label={`${pseudonym}’s Mark`} size="xl" className="!h-auto !w-full max-w-[34rem]" />
          </div>
        </div>
      )}
    </>
  )
}
