import type { ReactNode } from 'react'
import { systemMarkerClass, systemHeadingClass, systemBodyClass } from './ui'

/**
 * Tempa's reusable system-voice introduction block — the marker,
 * heading, and body copy for a moment where the product itself is
 * speaking (walkthrough steps, permission prompts, onboarding
 * transitions, future feature introductions). Deliberately does not
 * own the action buttons below it — callers already have their own
 * button-row layout (e.g. the Moments walkthrough's Screen wrapper) and
 * this stays a content-only block so it composes into any of them.
 */
export default function SystemIntro({
  marker,
  heading,
  body,
}: {
  /** e.g. "⊕ Moments" — omit for a system screen with no specific
   * feature identity to sign. */
  marker?: string
  heading: string
  body: ReactNode
}) {
  return (
    <div className="space-y-4">
      {marker && <p className={systemMarkerClass}>{marker}</p>}
      <h1 className={systemHeadingClass}>{heading}</h1>
      <div className={`space-y-3 ${systemBodyClass}`}>{body}</div>
    </div>
  )
}
