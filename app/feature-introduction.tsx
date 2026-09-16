'use client'

import { useState, type ReactNode } from 'react'
import { createClient } from '@/lib/supabase/client'
import { markGuideCompleted, type GuideKey } from '@/lib/guide'
import { systemBodyClass } from '@/app/profile/ui'

/**
 * Onboarding & First-Use checkpoint — the one small, shared architecture
 * for a distinctive Tempa concept introducing itself the moment a member
 * first encounters it (People, Board, the Dispatch composer, Postcards —
 * see each call site's own doc comment for exactly where). Deliberately
 * NOT a sequence of popups fired all at once after signup, and
 * deliberately separate from MomentHint (app/board/moment-hint.tsx),
 * which stays exactly as it already was — this checkpoint does not
 * modify it.
 *
 * Visually a small, quiet, self-contained card — warm and a little more
 * "visually intentional" than TempaNote's plain inline note (this is a
 * genuine first encounter with a concept, not a passing status aside),
 * but still restrained: no icon, no illustration, no modal, no
 * full-screen takeover, never `alert()`.
 *
 * Persistence is per-ACCOUNT, not per-browser-session — reusing the
 * exact existing guide_completions architecture (lib/guide.ts) that
 * already powers the Moments/Minds walkthroughs, rather than a second
 * persistence system. Each caller is responsible for the read side
 * (checking hasCompletedGuide server-side and only mounting this
 * component when not yet completed — see e.g. app/minds/page.tsx); this
 * component only ever owns the WRITE (dismiss → markGuideCompleted).
 * A Guide replay page (app/you/guide/*) mounts this unconditionally,
 * bypassing that read-side gate entirely — the exact same pattern
 * app/you/guide/minds/replay.tsx already established for the full
 * walkthroughs, never a second "seen" flag of its own.
 */
export default function FeatureIntroduction({
  guideKey,
  title,
  children,
  ctaLabel,
  onDismiss,
}: {
  guideKey: GuideKey
  title: string
  children: ReactNode
  ctaLabel: string
  /** Called after the completion write settles (success or failure —
   * dismissal always proceeds locally either way, matching every other
   * dismissible notice in this codebase, e.g. MomentHint's own "no
   * persistence available" fallback). Guide replay pages use this to
   * navigate back to /you/guide once acknowledged again. */
  onDismiss?: () => void
}) {
  const [dismissed, setDismissed] = useState(false)

  if (dismissed) return null

  async function dismiss() {
    setDismissed(true)
    const supabase = createClient()
    const { error } = await markGuideCompleted(supabase, guideKey)
    if (error) {
      console.error('[feature-introduction] completion write failed', { guideKey, ...error })
    }
    onDismiss?.()
  }

  return (
    <div className="space-y-3 rounded-lg border border-accent/20 bg-accent/[.05] p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="font-serif text-lg italic text-foreground">{title}</p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss"
          className="shrink-0 text-foreground/40 transition-colors hover:text-foreground/70"
        >
          ×
        </button>
      </div>
      <div className={`space-y-2 ${systemBodyClass}`}>{children}</div>
      <button
        type="button"
        onClick={dismiss}
        className="inline-flex items-center justify-center rounded-md bg-accent text-accent-foreground px-4 py-2 text-[14px] font-medium transition-colors hover:bg-accent/90"
      >
        {ctaLabel}
      </button>
    </div>
  )
}
