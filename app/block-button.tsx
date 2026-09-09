'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { blockUser, unblockUser, type BlockScope } from '@/lib/blocking'
import { helperTextClass, secondaryButtonClass, destructiveButtonClass } from '@/app/profile/ui'

const STOP_LETTERS_COPY =
  "Neither of you will be able to start or continue letters while this is active. You can still see each other’s public writing on TEMPA. Mail already on the way will still arrive."

const BLOCK_EVERYWHERE_COPY =
  "You won’t be shown to each other across TEMPA, and neither of you will be able to write to the other. Existing letters remain in your Letterbox unless you remove them."

export type PostBlockNavigation = { kind: 'replace'; path: string } | { kind: 'refresh' }

/**
 * Pure: what BlockButton does with the router after a SUCCESSFUL
 * blockUser call — extracted (same pattern as canWriteToMind in
 * app/minds/[userId]/page.tsx) so the live-tested regression this
 * fixes (a full block on the public profile immediately 404ing via
 * router.refresh(), since the profile becomes invisible to the caller
 * the instant the block lands) can be proven without a DOM. Never
 * called on a failed blockUser call — handleChoose below returns
 * before reaching this on error, so a failed RPC never navigates
 * anywhere.
 */
export function resolvePostBlockNavigation(
  chosenScope: BlockScope,
  fullBlockRedirect: string | undefined
): PostBlockNavigation {
  if (chosenScope === 'full' && fullBlockRedirect) {
    return { kind: 'replace', path: fullBlockRedirect }
  }
  return { kind: 'refresh' }
}

/**
 * Safety & Trust — the one V1 way to block another member, now with
 * two scopes (Checkpoint 1C). Shared between the public profile page
 * and an existing correspondence's action menu (app/letters/[letterId]/
 * letter-action-menu.tsx) so both use identical copy and behavior.
 *
 * Server enforcement (block_user RPC, docs/sql/2026-09-12-scoped-
 * blocking-and-fixes.sql) is the actual boundary — this component
 * exists for a restrained, honest presentation, never as the
 * authorization mechanism itself. Renders its own inline choice (the
 * established pattern — see RemoveFromLetterbox), never a native
 * window.confirm(). The blocked member is never notified; there is no
 * "you were blocked" surface anywhere in this product, and the copy
 * below never reveals which of the two of you initiated it.
 *
 * `initialScope` is the CALLER's own current block against this
 * specific person (fetched server-side via getBlockScope before this
 * component renders) — null when no block exists yet. This lets the
 * same control render the right state everywhere it appears: a
 * 'letters' block keeps the target's profile fully reachable (so this
 * control can still legitimately render there), while a 'full' block
 * only ever reaches this component from a context that still has
 * historical access despite the block (e.g. an existing letter
 * thread's action menu) — a fully blocked pair's public_profiles
 * lookup for each other already returns nothing, so this component
 * never renders unreachable on a page that would 404 first.
 *
 * `fullBlockRedirect` (live-test correction, 2026-09-13) — the ONE
 * navigation decision that differs by call site, made explicit rather
 * than guessed from pathname. A FULL block makes the pair mutually
 * invisible immediately, so `router.refresh()`'ing the CURRENT route
 * right after choosing "Block everywhere" can turn a successful action
 * into an accidental 404 if the current route depends on the
 * now-blocked profile being visible (the public `/minds/[userId]`
 * page's own `public_profiles` lookup, specifically). Pass a path here
 * ONLY from a call site where the current route would itself become
 * invalid after a full block (the public profile) — `router.replace()`
 * (never `push`) takes the member there instead of refreshing in
 * place, so Back doesn't land them straight back on the now-invalid
 * profile as the very next history entry. Leave this unset at a call
 * site whose page stays a valid record regardless of block state (an
 * existing letter's action menu — historical correspondence access is
 * deliberately preserved through a full block), where the pre-existing
 * `router.refresh()` behavior remains correct. A 'letters' scope never
 * uses this at all: it never affects profile/page visibility, so
 * refreshing in place is always safe.
 */
export default function BlockButton({
  blockedId,
  blockedPseudonym,
  triggerClassName,
  initialScope = null,
  fullBlockRedirect,
}: {
  blockedId: string
  blockedPseudonym: string
  triggerClassName: string
  initialScope?: BlockScope | null
  /** See the component doc comment above. Omit when the current page
   * remains a valid, readable record regardless of block state. */
  fullBlockRedirect?: string
}) {
  const router = useRouter()
  const [scope, setScope] = useState<BlockScope | null>(initialScope)
  const [choosing, setChoosing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleChoose(chosenScope: BlockScope) {
    if (busy) return
    setBusy(true)
    setError(null)

    const { error: blockError } = await blockUser(createClient(), blockedId, chosenScope)

    setBusy(false)

    if (blockError) {
      setError('Could not update this block. Please try again.')
      return
    }

    const navigation = resolvePostBlockNavigation(chosenScope, fullBlockRedirect)

    if (navigation.kind === 'replace') {
      // The current route is about to become invalid for this viewer —
      // replace, not push, so Back doesn't land them straight back on
      // the now-inaccessible page as the very next history entry.
      router.replace(navigation.path)
      return
    }

    setScope(chosenScope)
    setChoosing(false)
    router.refresh()
  }

  async function handleUnblock() {
    if (busy) return
    setBusy(true)
    setError(null)

    const { error: unblockError } = await unblockUser(createClient(), blockedId)

    setBusy(false)

    if (unblockError) {
      setError('Could not update this block. Please try again.')
      return
    }

    setScope(null)
    router.refresh()
  }

  // Already fully blocked — the block-management surface for this state
  // is Settings → Safety → Blocked minds; this inline control just
  // stays honest about the state and offers the one reversing action.
  if (scope === 'full') {
    return (
      <div className="space-y-1">
        <p className={helperTextClass}>{blockedPseudonym} is blocked everywhere.</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button type="button" onClick={handleUnblock} disabled={busy} className={secondaryButtonClass}>
          {busy ? 'Unblocking…' : 'Unblock'}
        </button>
      </div>
    )
  }

  // Already letters-stopped — offer both reversing (restore letters)
  // and escalating (block everywhere) actions from the same control.
  if (scope === 'letters') {
    return (
      <div className="space-y-2">
        <p className={helperTextClass}>Letters are stopped with {blockedPseudonym}.</p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={handleUnblock} disabled={busy} className={secondaryButtonClass}>
            Restore letters
          </button>
          <button
            type="button"
            onClick={() => handleChoose('full')}
            disabled={busy}
            className={destructiveButtonClass}
          >
            Block everywhere
          </button>
        </div>
      </div>
    )
  }

  if (choosing) {
    return (
      <div className="space-y-3">
        <p className={helperTextClass}>Block {blockedPseudonym}?</p>

        <div className="space-y-1.5 rounded-md border border-foreground/10 p-3">
          <p className="text-[14px] font-medium text-foreground">Stop letters</p>
          <p className={helperTextClass}>{STOP_LETTERS_COPY}</p>
          <button
            type="button"
            onClick={() => handleChoose('letters')}
            disabled={busy}
            className={secondaryButtonClass}
          >
            {busy ? 'Working…' : 'Stop letters'}
          </button>
        </div>

        <div className="space-y-1.5 rounded-md border border-foreground/10 p-3">
          <p className="text-[14px] font-medium text-foreground">Block everywhere</p>
          <p className={helperTextClass}>{BLOCK_EVERYWHERE_COPY}</p>
          <button
            type="button"
            onClick={() => handleChoose('full')}
            disabled={busy}
            className={destructiveButtonClass}
          >
            {busy ? 'Working…' : 'Block everywhere'}
          </button>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <button type="button" onClick={() => setChoosing(false)} disabled={busy} className={helperTextClass}>
          Cancel
        </button>
      </div>
    )
  }

  return (
    <button type="button" onClick={() => setChoosing(true)} className={triggerClassName}>
      Block {blockedPseudonym}
    </button>
  )
}
