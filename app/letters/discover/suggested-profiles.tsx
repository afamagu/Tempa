'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import DiscoveryResults, { type DiscoveryEntry } from '@/app/room/discovery-results'

export default function SuggestedProfiles({ entries, returnTo }: { entries: DiscoveryEntry[]; returnTo: string }) {
  const t = useTranslations('Discovery')
  const rail = useRef<HTMLDivElement>(null)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(entries.length <= 1)
  function updateEnds() {
    const el = rail.current
    if (!el) return
    setAtStart(el.scrollLeft <= 1)
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1)
  }
  function move(direction: number) {
    const el = rail.current
    if (el) el.scrollBy({ left: direction * 272, behavior: 'smooth' })
  }
  useEffect(() => {
    const el = rail.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      setAtStart(el.scrollLeft <= 1)
      setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1)
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return <section aria-label={t('suggested')} className="space-y-3">
    <div className="flex items-center justify-between gap-3">
      <h2 className="font-serif text-xl">{t('suggested')}</h2>
      <div className="flex gap-2">
        <button type="button" disabled={atStart} onClick={() => move(-1)} aria-label={t('previousPeople')} className="rounded-full border border-foreground/15 px-3 py-2 disabled:opacity-30">←</button>
        <button type="button" disabled={atEnd} onClick={() => move(1)} aria-label={t('nextPeople')} className="rounded-full border border-foreground/15 px-3 py-2 disabled:opacity-30">→</button>
      </div>
    </div>
    <div ref={rail} onScroll={updateEnds} tabIndex={0} aria-label={t('suggested')} className="overflow-x-auto overscroll-x-contain snap-x snap-mandatory pb-2">
      <DiscoveryResults entries={entries.slice(0, 6)} returnTo={returnTo} profileLed horizontal />
    </div>
  </section>
}
