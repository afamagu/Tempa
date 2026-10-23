'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useLocale } from 'next-intl'
import { HOME_NUDGE_COPY, writingLocale } from '@/lib/guided-writing-copy'
const STORAGE_PREFIX = 'tempa:first-letter-nudge-dismissed:'

export default function HomeWritingInvitation({ memberId }: { memberId: string }) {
  const copy = HOME_NUDGE_COPY[writingLocale(useLocale())]
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    let active=true
    queueMicrotask(()=>{
      if(!active)return
      try { setVisible(localStorage.getItem(STORAGE_PREFIX + memberId) !== '1') }
      catch { setVisible(true) }
    })
    return ()=>{active=false}
  }, [memberId])
  if (!visible) return null
  return (
    <aside aria-label={copy.heading} className="mt-6 rounded-xl border border-accent/25 bg-surface-shell px-5 py-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="font-serif text-[21px] leading-snug">{copy.heading}</h2>
          <p className="mt-2 text-sm leading-relaxed text-foreground/70">{copy.body}</p>
        </div>
        <button type="button" aria-label={copy.dismiss} onClick={()=>{
          try { localStorage.setItem(STORAGE_PREFIX + memberId,'1') } catch {}
          setVisible(false)
        }} className="min-h-11 min-w-11 rounded-md text-foreground/60 focus-visible:outline-2 focus-visible:outline-accent">✕</button>
      </div>
      <div className="mt-4 flex flex-wrap gap-4">
        <Link href="/board/write/guide" className="inline-flex min-h-11 items-center rounded-md bg-accent px-5 text-sm text-accent-foreground">{copy.help} ↗</Link>
        <Link href="/board/write" className="inline-flex min-h-11 items-center text-sm underline underline-offset-4">{copy.freely}</Link>
      </div>
    </aside>
  )
}
