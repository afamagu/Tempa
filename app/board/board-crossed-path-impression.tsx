'use client'

import { useEffect, useRef } from 'react'
import { markIntroductionPresented } from '@/app/introduction-actions'

export default function BoardCrossedPathImpression({
  candidateId,
  children,
}: {
  candidateId: string
  children: React.ReactNode
}) {
  const root = useRef<HTMLDivElement>(null)
  const recorded = useRef(false)

  useEffect(() => {
    const node = root.current
    if (!node || recorded.current || !('IntersectionObserver' in window)) return

    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0]
      if (!entry?.isIntersecting || entry.intersectionRatio < 0.6 || recorded.current) return
      recorded.current = true
      observer.disconnect()
      void markIntroductionPresented(candidateId)
    }, { threshold: 0.6 })

    observer.observe(node)
    return () => observer.disconnect()
  }, [candidateId])

  return <div ref={root}>{children}</div>
}
