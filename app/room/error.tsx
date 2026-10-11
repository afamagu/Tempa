'use client'

import { useEffect } from 'react'
import Link from 'next/link'

export default function RoomError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error('[room] failed to load letters', { digest: error.digest }) }, [error])
  return <main className="mx-auto flex min-h-[65vh] max-w-xl flex-col items-center justify-center gap-5 px-6 text-center">
    <p className="text-[11px] uppercase tracking-[.2em] text-foreground/55">The Board</p>
    <h1 className="font-serif text-3xl">The letters aren’t coming through right now.</h1>
    <p className="max-w-sm text-[14px] leading-relaxed text-foreground/70">Your place here hasn’t gone anywhere. Please try again.</p>
    <button type="button" onClick={reset} className="rounded-md border border-foreground/20 px-5 py-3 text-sm">Try again</button>
    <Link href="/home" className="text-sm underline underline-offset-4">Return to Home</Link>
  </main>
}
