'use client'

import { useState } from 'react'
import TempaNote from '@/app/tempa-note'

const SEEN_KEY_PREFIX = 'tempa:moment-hint-seen:'

function alreadySeenThisSession(dispatchId: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return Boolean(window.sessionStorage.getItem(SEEN_KEY_PREFIX + dispatchId))
  } catch {
    // Private-browsing/storage-blocked: fall back to always showing it
    // once per page load rather than erroring.
    return false
  }
}

/**
 * A restrained, one-time explanation that a Dispatch has small inline
 * photo Moments — originally built for the external `/d/[shareToken]`
 * reader (Board live-test corrections, 2026-09-10), where a first-time
 * visitor has no other way to discover this at all. Visual-fidelity
 * pass (2026-09-10): the external hint "live-tested beautifully," so
 * the SAME component is now also shown to AUTHENTICATED readers opening
 * a Dispatch with a resolved Moment (app/board/[dispatchId]/page.tsx) —
 * one shared component rather than separate internal/external copies,
 * since the underlying need (a member may not yet know Dispatches can
 * carry inline photo Moments) is identical either way. This is
 * explicitly recorded as an early-launch education treatment that may
 * be retired later once usage data shows it is no longer needed.
 *
 * Writing stays primary: a single quiet line above the reading surface,
 * never a modal, never a blocking walkthrough, never per-image, no
 * attention-grabbing animation. Never shown on a Board/Home listing
 * card (dispatch-card.tsx, board-shelf-card.tsx never import this) —
 * only inside an actually-opened Dispatch, external or authenticated.
 *
 * Dispatch Culture Polish Pass: rendered through the shared TempaNote
 * primitive (app/tempa-note.tsx) rather than its own bespoke neutral
 * box — this is exactly the "Tempa explains something in one sentence"
 * shape TempaNote exists for.
 *
 * Reader Polish Checkpoint (final copy pass): copy rewritten to say more
 * than a mechanical image instruction — Moments are small glimpses into
 * the writer's world encountered while reading, not just a tap target.
 * Uses "a Moment," the real product term (see e.g. MomentsAvailableNotice's
 * own "You can now add Moments"), never "a small image." Deliberately
 * still says nothing about a Postcard: this component's own visibility
 * gate (both call sites — app/board/[dispatchId]/page.tsx and app/d/
 * [shareToken]/shared-dispatch-view.tsx — pass `moments.some(m =>
 * m.imageUrl)`/`hasMoments`) is about photo Moments only, never about
 * whether a Dispatch has an attached Postcard (a separate, independent
 * condition rendered just below this, via LetterheadPostcard). Claiming
 * to explain a Postcard here would be true only sometimes — this note
 * only ever shows because of a photo Moment, so its copy stays truthful
 * to that; that visibility semantics is deliberately UNCHANGED by this
 * pass.
 *
 * Session-scoped only via sessionStorage, keyed per Dispatch — closing
 * the tab or opening a different Dispatch shows it again; there is
 * deliberately no database persistence for this in either context. The
 * seen check runs as a lazy `useState` initializer (reading `window`
 * directly, guarded for SSR) rather than in a `useEffect` that calls
 * `setState` — the same synchronous-read-at-init pattern already used
 * by app/sign-in/page.tsx's own initial-state helpers — so a repeat
 * visit never flashes the hint in and back out.
 */
export default function MomentHint({ dispatchId }: { dispatchId: string }) {
  const [dismissed, setDismissed] = useState(() => alreadySeenThisSession(dispatchId))

  function dismiss() {
    setDismissed(true)
    try {
      window.sessionStorage.setItem(SEEN_KEY_PREFIX + dispatchId, '1')
    } catch {
      // No persistence available — the hint simply reappears next load,
      // which is an acceptable fallback, not a failure.
    }
  }

  if (dismissed) return null

  return (
    <TempaNote onDismiss={dismiss} dismissLabel="Dismiss this hint">
      <p>Little glimpses from the writer&rsquo;s world may appear along the way. Tap a Moment to open it.</p>
    </TempaNote>
  )
}
