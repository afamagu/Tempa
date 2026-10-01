'use client'

import { useState, useTransition, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { inputClass, secondaryButtonClass } from '@/app/profile/ui'

export default function DispatchSearch({ initialQuery, sessionStartedAt, seed }: { initialQuery: string; sessionStartedAt?: string; seed?: string }) {
  const router = useRouter()
  const [value, setValue] = useState(initialQuery)
  const [pending, startTransition] = useTransition()
  function navigate(query: string) {
    const params = new URLSearchParams()
    if (query) params.set('q', query)
    if (sessionStartedAt) params.set('s', sessionStartedAt)
    if (seed) params.set('seed', seed)
    startTransition(() => { if (query === initialQuery) router.refresh(); else router.push(`/board${params.size ? `?${params}` : ''}`) })
  }
  function handleSubmit(event: FormEvent) { event.preventDefault(); navigate(value.trim()) }
  function clear() { setValue(''); navigate('') }
  return <form onSubmit={handleSubmit} className="flex w-full flex-wrap items-center gap-2" role="search" aria-label="Search the Board">
    <div className="relative min-w-0 flex-1">
      <input type="search" value={value} onChange={event => { const next = event.target.value; setValue(next); if (!next.trim() && initialQuery) navigate('') }} placeholder="Search title, topics, or writing…" aria-label="Search the Board" className={`w-full pr-12 ${inputClass}`} />
      {value && <button type="button" onClick={clear} aria-label="Clear search" className="absolute inset-y-0 right-0 px-3 text-foreground/60">×</button>}
    </div>
    <button type="submit" disabled={pending} className={secondaryButtonClass}>{pending ? 'Searching…' : 'Search'}</button>
    <span className="sr-only" role="status">{pending ? 'Loading results' : ''}</span>
  </form>
}
