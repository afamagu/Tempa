'use client'

import { useEffect, useRef } from 'react'
import Link from 'next/link'
import ProfileIdentityMark from '@/app/profile-identity-mark'
import EditorialByline from '@/app/editorial-byline'
import { helperTextClass, metadataTextClass, sectionLabelClass } from '@/app/profile/ui'
import type { DiscoveryEntry } from '@/app/room/discovery-results'
import { markIntroductionPresented } from '@/app/introduction-actions'

export default function FamiliarFaces({
  entries,
  returnTo,
  quiet = false,
}: {
  entries: DiscoveryEntry[]
  returnTo: string
  quiet?: boolean
}) {
  const root = useRef<HTMLDivElement>(null)
  const recorded = useRef(new Set<string>())

  useEffect(() => {
    const container = root.current
    if (!container || !entries.length || !('IntersectionObserver' in window)) return

    const cards = Array.from(container.querySelectorAll<HTMLElement>('[data-familiar-face]'))
    const ids = new Map(
      cards
        .map((card) => [card, card.dataset.familiarFace] as const)
        .filter((pair): pair is readonly [HTMLElement, string] => Boolean(pair[1]))
    )
    const observer = new IntersectionObserver((records) => {
      for (const record of records) {
        if (!record.isIntersecting || record.intersectionRatio < 0.6) continue
        const candidateId = ids.get(record.target as HTMLElement)
        if (!candidateId || recorded.current.has(candidateId)) continue
        recorded.current.add(candidateId)
        observer.unobserve(record.target)
        void markIntroductionPresented(candidateId)
      }
    }, { threshold: 0.6 })

    cards.forEach((card) => observer.observe(card))
    return () => observer.disconnect()
  }, [entries])

  if (!entries.length) return null

  return (
    <div ref={root} className={quiet ? 'space-y-2 border-t border-foreground/10 pt-5' : 'space-y-3'}>
      <div>
        <p className={sectionLabelClass}>Familiar faces</p>
        <p className={`mt-1 ${helperTextClass}`}>You’ve crossed paths before.</p>
      </div>
      <div className={quiet ? 'divide-y divide-foreground/10' : 'grid gap-2 sm:grid-cols-3'}>
        {entries.map((entry) => {
          const params = new URLSearchParams({ returnTo, answer: entry.response.id })
          return (
            <Link
              key={entry.userId}
              data-familiar-face={entry.userId}
              href={`/room/${entry.userId}?${params}`}
              className={quiet
                ? 'flex items-center gap-3 py-3 transition-colors hover:bg-foreground/[.02]'
                : 'flex min-w-0 items-center gap-3 rounded-md border border-foreground/10 px-3 py-3 transition-colors hover:border-foreground/20'}
            >
              <ProfileIdentityMark
                identifier={entry.userId}
                markUrl={entry.markUrl}
                label={entry.markUrl ? `${entry.pseudonym}'s Mark` : undefined}
                size="md"
              />
              <div className="min-w-0">
                <p className="truncate text-[14px] font-medium text-foreground">{entry.pseudonym}</p>
                <EditorialByline title={entry.editorialTitle} />
                <p className={`truncate ${metadataTextClass}`}>
                  {[entry.country, entry.ageRange].filter(Boolean).join(' · ')}
                </p>
              </div>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
