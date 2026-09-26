'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { searchMembers, type MemberSearchResult } from '@/lib/admin'
import { inputClass } from '@/app/profile/ui'

/** Find a member by pseudonym; selecting navigates to `${basePath}?member=<id>`. */
export default function MemberPicker({ basePath, label = 'Find a member' }: { basePath: string; label?: string }) {
  const router = useRouter()
  const [q, setQ] = useState('')
  const [results, setResults] = useState<MemberSearchResult[]>([])
  useEffect(() => {
    const query = q.trim()
    if (query.length < 2) return
    let live = true
    const t = window.setTimeout(async () => {
      const { data } = await searchMembers(createClient(), query)
      if (live) setResults(data.slice(0, 8))
    }, 250)
    return () => {
      live = false
      window.clearTimeout(t)
    }
  }, [q])
  const shown = q.trim().length < 2 ? [] : results
  return (
    <div className="space-y-2">
      <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Pseudonym…" aria-label={label} className={`${inputClass} sm:max-w-sm`} />
      {shown.length > 0 && (
        <ul className="divide-y divide-foreground/10 rounded-md border border-foreground/10 sm:max-w-sm">
          {shown.map((m) => (
            <li key={m.id}>
              <button type="button" className="w-full px-3 py-2 text-left text-[15px] hover:bg-foreground/[.03]" onClick={() => router.push(`${basePath}?member=${m.id}`)}>
                {m.pseudonym}
                {m.country ? <span className="text-muted"> · {m.country}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
