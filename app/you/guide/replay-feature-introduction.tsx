'use client'

import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import FeatureIntroduction from '@/app/feature-introduction'
import type { GuideKey } from '@/lib/guide'

/**
 * Onboarding & First-Use checkpoint (Section O) — the shared replay
 * shell for a lightweight FeatureIntroduction, mirroring the existing
 * app/you/guide/minds/replay.tsx / moments/replay.tsx pattern for the
 * two full walkthroughs: the guide page ALWAYS mounts the introduction
 * directly, bypassing the normal completed-state read-side gate every
 * ordinary call site applies (app/minds/page.tsx etc. only mount
 * FeatureIntroduction when !hasCompletedGuide) — a member can revisit
 * the explanation any time, without any database state reset. Dismissing
 * it here (harmlessly, idempotently) re-confirms completion, same as it
 * already would be, then returns to /you/guide.
 */
export default function ReplayFeatureIntroduction({
  guideKey,
  title,
  ctaLabel,
  children,
}: {
  guideKey: GuideKey
  title: string
  ctaLabel: string
  children: ReactNode
}) {
  const router = useRouter()

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <div className="w-full max-w-md">
        <FeatureIntroduction
          guideKey={guideKey}
          title={title}
          ctaLabel={ctaLabel}
          onDismiss={() => router.push('/you/guide')}
        >
          {children}
        </FeatureIntroduction>
      </div>
    </main>
  )
}
