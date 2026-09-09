'use client'

import { useState, type FormEvent } from 'react'
import { useRouter } from 'next/navigation'
import { inputClass } from '@/app/profile/ui'

/**
 * The Board's one search entry point — title + topics + body (see
 * search_dispatches). A plain submit, not live-as-you-type: Board is a
 * deliberate destination a member chooses to look something up in, not
 * a feed that reorders itself while they're mid-keystroke.
 */
export default function DispatchSearch({ initialQuery }: { initialQuery: string }) {
  const router = useRouter()
  const [value, setValue] = useState(initialQuery)

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const trimmed = value.trim()
    router.push(trimmed ? `/board?q=${encodeURIComponent(trimmed)}` : '/board')
  }

  return (
    <form onSubmit={handleSubmit} className="flex gap-2">
      <input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Search title, topics, or writing…"
        aria-label="Search the Board"
        className={`flex-1 ${inputClass}`}
      />
    </form>
  )
}
