'use client'

import { useState, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import type { DiscoveryRequest } from '@/lib/discovery'
import DiscoveryResults, { type DiscoveryEntry } from './discovery-results'
import { loadMorePeople } from './discovery-actions'
import { secondaryButtonClass } from '@/app/profile/ui'

export function appendDistinctPeople(current: DiscoveryEntry[], incoming: DiscoveryEntry[]) {
  const seen = new Set(current.map((entry) => entry.userId))
  return [...current, ...incoming.filter((entry) => {
    if (seen.has(entry.userId)) return false
    seen.add(entry.userId)
    return true
  })]
}

export default function PeopleBrowser({ initialEntries, initialHasMore, request, returnTo, profileLed = false }: {
  initialEntries: DiscoveryEntry[]; initialHasMore: boolean; request: DiscoveryRequest; returnTo: string; profileLed?: boolean
}) {
  const t = useTranslations('Discovery')
  const [entries, setEntries] = useState(initialEntries)
  const [hasMore, setHasMore] = useState(initialHasMore)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()
  function more() {
    startTransition(async () => {
      setError(null)
      try {
        const next = await loadMorePeople(request, entries.map((entry) => entry.userId), profileLed)
        if (next.error) { setError(t(next.error)); return }
        setEntries((previous) => appendDistinctPeople(previous, next.entries))
        setHasMore(next.hasMore)
      } catch { setError(t('failed')) }
    })
  }
  return (
    <div className="space-y-6">
      <DiscoveryResults entries={entries} returnTo={returnTo} profileLed={profileLed} />
      {error && <p role="alert" className="text-sm text-foreground/70">{error}</p>}
      {hasMore && entries.length < 600 && <div className="flex justify-center"><button type="button" disabled={pending} onClick={more} className={secondaryButtonClass}>{pending ? t('loading') : t('more')}</button></div>}
      {hasMore && entries.length >= 600 && <p role="status" className="text-center text-sm text-foreground/55">{t('windowEnd')}</p>}
      {!hasMore && entries.length > 0 && <p role="status" className="text-center text-sm text-foreground/55">{t('end')}</p>}
    </div>
  )
}
