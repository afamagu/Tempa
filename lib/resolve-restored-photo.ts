import type { ResolvedPhotoUrl } from './draft-photo-url'

/**
 * Live-repair checkpoint (2026-09-08), second pass — PhotoMomentView's
 * previous fix (one retry, 1.5s later) turned out to be an
 * UNRECOVERABLE ceiling: live testing showed the editor's restored
 * Photos still stuck on their placeholder after both the initial
 * attempt and the retry, while the exact same canonical resolver
 * (resolveLetterPhotoUrl), called later from Preview's own on-demand
 * click handler, succeeds every time against the same imagePath in the
 * same authenticated page. Every other candidate on this checkpoint's
 * own investigation checklist — NodeView recreation, cancellation
 * misfiring, stale closures, dependency-array churn, `updateAttributes`
 * targeting a stale position, object-URL cleanup — traces out clean:
 * this file's `cancelled` guard, primitive effect deps, and per-call
 * `getPos()` resolution inside Tiptap's own `updateAttributes` are all
 * exactly the documented-correct pattern for an async NodeView.
 *
 * What IS demonstrably true from the code alone, independent of the
 * exact underlying cause: the previous version had a HARD CEILING of
 * exactly one retry (a ~1.5s window) with no way to try again short of
 * a full page reload — which just repeats the same narrow window. That
 * is a real defect regardless of whether the transient condition is
 * session hydration, a cold connection, or something else entirely:
 * once both attempts land inside that window, the Photo is
 * PERMANENTLY stuck for the rest of that page's life. This module
 * removes the ceiling on two axes — a longer bounded backoff, and (in
 * photo-moment-node.tsx) an explicit user-triggered retry — so a
 * restored Photo's recoverability never depends on guessing the right
 * number of milliseconds.
 *
 * Deliberately a plain, dependency-free async function (no React, no
 * DOM) so it can be tested directly with a fake resolver and a fake
 * `wait`, per this checkpoint's own instruction not to rely on
 * source-text inspection for logic that can reasonably be extracted
 * and tested for real.
 */
export const RESTORED_PHOTO_RETRY_DELAYS_MS = [1000, 2000, 4000]

export type RestoredPhotoResolution =
  | { status: 'resolved'; url: string }
  | { status: 'unresolved'; error: string | null }
  | { status: 'cancelled' }

export async function resolveRestoredPhotoWithRetries(
  imagePath: string,
  resolvePhotoUrl: (imagePath: string) => Promise<ResolvedPhotoUrl>,
  options: {
    /** Delay before each retry, in order. Defaults to a short bounded
     * backoff (~7s total across 3 retries) — bounded so a genuinely
     * dead photo doesn't retry forever, but long enough to survive a
     * slow first request without the member needing to intervene. */
    retryDelaysMs?: number[]
    /** Injected so tests never need real timers. */
    wait?: (ms: number) => Promise<void>
    /** Polled between attempts/delays — lets a caller (the NodeView's
     * own unmount/attrs-changed cleanup) stop this loop from applying
     * a result that's no longer relevant, without needing to cancel
     * the underlying network call itself. */
    isCancelled?: () => boolean
  } = {}
): Promise<RestoredPhotoResolution> {
  const retryDelaysMs = options.retryDelaysMs ?? RESTORED_PHOTO_RETRY_DELAYS_MS
  const wait = options.wait ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))
  const isCancelled = options.isCancelled ?? (() => false)
  const totalAttempts = retryDelaysMs.length + 1

  let lastError: string | null = null

  for (let attempt = 0; attempt < totalAttempts; attempt++) {
    if (attempt > 0) await wait(retryDelaysMs[attempt - 1])
    if (isCancelled()) return { status: 'cancelled' }

    const { url, error } = await resolvePhotoUrl(imagePath)
    if (isCancelled()) return { status: 'cancelled' }
    if (url) return { status: 'resolved', url }
    lastError = error
  }

  return { status: 'unresolved', error: lastError }
}
