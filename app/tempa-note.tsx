import type { ReactNode } from 'react'
import { systemBodyClass } from '@/app/profile/ui'

/**
 * Dispatch Culture Polish Pass — TEMPA's one recognizable "the house is
 * speaking" object: a terse, 1–2 sentence explanation where TEMPA
 * itself is telling the member something, generalized from the closed-
 * letter status notice's own clay-left-rule prototype
 * (app/letters/[letterId]/closure-status-notice.tsx). A short --clay
 * left rule (the ONE restrained secondary accent, app/globals.css) plus
 * a tiny uppercase "Tempa Note" label — restrained spacing, no
 * bordered/filled card chrome.
 *
 * NOT for buttons, field labels, ordinary form errors, toasts,
 * onboarding walkthroughs, marketing copy, decision/CTA cards, or an
 * ordinary empty state — those already have their own established
 * patterns. In particular this does not replace app/system-message.tsx,
 * whose `notice`/`warning` variants carry an optional action row this
 * component deliberately does not support.
 *
 * Reader Polish Checkpoint — the explanatory copy is italic, on top of
 * systemBodyClass's already-smaller-than-letter-prose sans-serif
 * treatment, so it reads as quiet editorial guidance even when it sits
 * directly above real (serif, non-italic) correspondence — never the
 * "Tempa Note" label itself, which stays upright, uppercase, and
 * clearly legible as the one identifying marker.
 */
export default function TempaNote({
  children,
  onDismiss,
  dismissLabel = 'Dismiss',
  className = '',
}: {
  children: ReactNode
  onDismiss?: () => void
  dismissLabel?: string
  className?: string
}) {
  return (
    <div className={`flex items-start justify-between gap-3 border-l-2 border-clay/50 pl-3 ${className}`}>
      <div className="space-y-1">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-clay">Tempa Note</p>
        <div className={`italic ${systemBodyClass}`}>{children}</div>
      </div>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          aria-label={dismissLabel}
          className="shrink-0 text-foreground/40 transition-colors hover:text-foreground/70"
        >
          ×
        </button>
      )}
    </div>
  )
}
