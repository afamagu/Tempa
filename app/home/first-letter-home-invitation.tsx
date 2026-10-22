'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { quietLinkClass, secondaryButtonClass } from '@/app/profile/ui'

export default function FirstLetterHomeInvitation({ userId }: { userId: string }) {
  const [hidden, setHidden] = useState(true)
  const key = `tempa:first-board-letter-invitation:${userId}`
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    try { setHidden(window.localStorage.getItem(key) === 'dismissed') }
    catch { setHidden(false) }
  }, [key])
  if (hidden) return null
  return (
    <section aria-label="Your first open letter" className="rounded-xl border border-accent/20 bg-accent/[.035] px-5 py-6">
      <p className="font-serif text-[22px] leading-snug">Someone could discover you through your words.</p>
      <p className="mt-2 text-[14px] leading-relaxed text-foreground/70">A little of your day might be enough to begin a correspondence.</p>
      <div className="mt-5 flex flex-wrap items-center gap-5">
        <Link href="/board/write/guided" className={secondaryButtonClass}>Help me start a letter ↗</Link>
        <button type="button" className={quietLinkClass} onClick={()=>{
          try {window.localStorage.setItem(key,'dismissed')} catch {}
          setHidden(true)
        }}>Not now</button>
      </div>
    </section>
  )
}
