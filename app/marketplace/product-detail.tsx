'use client'

import { useEffect, useId, useRef } from 'react'
import PostcardObject from '@/app/letters/postcard-object'
import { helperTextClass, iconButtonClass, primaryButtonClass, secondaryButtonClass, sectionLabelClass } from '@/app/profile/ui'
import { resolveLetterPostcardDisplay } from '@/lib/moments'
import { postcardEntryToBaseContent } from '@/lib/postcards'
import { isSendable, type CatalogueItem, type ItemState, type MemberContext } from '@/lib/marketplace'
import { useUnlock, type UnlockFn } from './use-unlock'

/**
 * Product detail — the Postcard at a readable size with its real
 * front/back object (the approved 9:16 artifact, unchanged), title,
 * story and ONE clear state/action. Motion never autoplays here: the
 * catalogue preview opens still, and preview_policy decides whether the
 * member may deliberately preview motion (controlled_full / teaser) or
 * sees the still only (still_only / none). Reduced-motion viewers never
 * get video (PostcardObject). No sound: the motion asset is always muted.
 */
export default function ProductDetail({
  item,
  state,
  context,
  mode,
  unlock,
  onUnlocked,
  onUse,
  onClose,
}: {
  item: CatalogueItem
  state: ItemState
  context: MemberContext
  mode: 'browse' | 'pick'
  unlock: UnlockFn
  onUnlocked: (productId: string, balance: number) => void
  onUse?: (postcardKey: string) => void
  onClose: () => void
}) {
  const titleId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const { status, begin, cancel, confirm } = useUnlock(unlock, onUnlocked)

  useEffect(() => {
    closeRef.current?.focus()
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const allowsMotion = item.previewPolicy === 'controlled_full' || item.previewPolicy === 'controlled_teaser'
  const postcard = item.entry
    ? (() => {
        const base = postcardEntryToBaseContent(item.entry)
        return resolveLetterPostcardDisplay(allowsMotion ? base : { ...base, living: undefined }, { revealLine: '', backMessage: '' })
      })()
    : null
  const context_ = item.collection || item.location
  const sendable = isSendable(state, item)
  const credits = item.credits ?? 0
  const shortBy = Math.max(credits - context.balance, 0)

  return (
    <div className="fixed inset-0 z-[60] flex items-stretch justify-center bg-foreground/30 sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onClick={(e) => e.stopPropagation()}
        className="relative flex max-h-full w-full flex-col overflow-y-auto overscroll-contain bg-background shadow-lg sm:max-w-3xl sm:rounded-lg"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-foreground/10 bg-background/95 px-4 py-2 backdrop-blur">
          <p className={sectionLabelClass}>{item.kind === 'gift' ? 'Gift' : 'Postcard'}</p>
          <button ref={closeRef} type="button" onClick={onClose} aria-label="Close" className={iconButtonClass}>
            <span aria-hidden="true" className="text-xl leading-none">×</span>
          </button>
        </div>

        <div className="grid gap-6 p-4 sm:grid-cols-[minmax(0,300px)_1fr] sm:p-6">
          <div className="mx-auto w-full max-w-[300px]">
            {postcard ? (
              <PostcardObject postcard={postcard} hasRevealedBefore motionControlLabel="Preview motion" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={item.thumbnailSrc} alt={`${item.title}`} className="block w-full rounded-md border border-foreground/10" />
            )}
          </div>

          <div className="min-w-0 space-y-4">
            <div className="space-y-1">
              {context_ && <p className="text-[13px] text-muted">{context_}</p>}
              <h2 id={titleId} className="font-serif text-2xl text-foreground">
                {item.title}
              </h2>
            </div>
            {item.description && <p className="text-[15px] leading-relaxed text-foreground/85">{item.description}</p>}
            {item.terms.filter((t) => t.facet !== 'tag').length > 0 && (
              <p className={helperTextClass}>
                {item.terms
                  .filter((t) => t.facet !== 'tag')
                  .map((t) => t.label)
                  .join(' · ')}
              </p>
            )}

            <div className="space-y-3 border-t border-foreground/10 pt-4" aria-live="polite">
              {state === 'complimentary' && <p className="text-[15px] text-foreground">Complimentary — anyone can send it.</p>}
              {(state === 'owned' || status.phase === 'done') && (
                <p className="text-[15px] font-medium text-accent">
                  {status.phase === 'done' ? 'Unlocked. It’s yours to send.' : 'Yours to send.'}
                </p>
              )}
              {state === 'unavailable' && <p className="text-[15px] text-muted">Not available right now.</p>}

              {state === 'available' && status.phase !== 'done' && (
                <UnlockPanel
                  credits={credits}
                  context={context}
                  shortBy={shortBy}
                  status={status}
                  onBegin={begin}
                  onCancel={cancel}
                  onConfirm={() => item.productId && confirm(item.productId)}
                />
              )}

              {mode === 'pick' && sendable && onUse && item.postcardKey && (
                <button type="button" className={`w-full sm:w-auto ${primaryButtonClass}`} onClick={() => onUse(item.postcardKey!)}>
                  Use this Postcard
                </button>
              )}
              {mode === 'browse' && sendable && state === 'owned' && (
                <p className={helperTextClass}>Choose it from Postcards when you write a Letter or Dispatch.</p>
              )}
              {item.kind === 'gift' && <p className={helperTextClass}>Gifts are sent from inside one of your correspondences.</p>}
            </div>

            {item.kind === 'postcard' && state !== 'complimentary' && (
              <p className={helperTextClass}>
                Receiving this Postcard from someone keeps it in your Keepsakes, but only unlocking it makes it yours to send.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function UnlockPanel({
  credits,
  context,
  shortBy,
  status,
  onBegin,
  onCancel,
  onConfirm,
}: {
  credits: number
  context: MemberContext
  shortBy: number
  status: ReturnType<typeof useUnlock>['status']
  onBegin: () => void
  onCancel: () => void
  onConfirm: () => void
}) {
  const label = `Unlock for ${credits} Credits`
  if (!context.spendEnabled) {
    return (
      <div className="space-y-2">
        <p className="text-[15px] text-foreground">{credits} Credits</p>
        <button type="button" disabled className={`w-full sm:w-auto ${secondaryButtonClass} cursor-not-allowed opacity-60`}>
          {label}
        </button>
        <p className={helperTextClass}>Unlocking with Credits isn’t open yet.</p>
      </div>
    )
  }
  if (shortBy > 0) {
    return (
      <div className="space-y-2">
        <p className="text-[15px] text-foreground">{credits} Credits</p>
        <button type="button" disabled className={`w-full sm:w-auto ${secondaryButtonClass} cursor-not-allowed opacity-60`}>
          {label}
        </button>
        <p className={helperTextClass}>
          You have {context.balance} Credits — {shortBy} more needed.
          {context.checkoutEnabled ? '' : ' Getting Credits isn’t available yet.'}
        </p>
      </div>
    )
  }
  if (status.phase === 'confirming' || status.phase === 'pending' || status.phase === 'error') {
    const pending = status.phase === 'pending'
    return (
      <div className="space-y-3 rounded-md border border-foreground/12 p-3">
        <p className="text-[15px] text-foreground">
          Spend {credits} of your {context.balance} Credits?
        </p>
        {status.phase === 'error' && (
          <p role="alert" className="text-[13px] text-red-700">
            {status.message}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primaryButtonClass} onClick={onConfirm} disabled={pending} aria-busy={pending}>
            {pending ? 'Unlocking…' : status.phase === 'error' ? 'Try again' : 'Confirm unlock'}
          </button>
          <button type="button" className={secondaryButtonClass} onClick={onCancel} disabled={pending}>
            Not now
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      <p className="text-[15px] text-foreground">{credits} Credits</p>
      <button type="button" className={`w-full sm:w-auto ${primaryButtonClass}`} onClick={onBegin}>
        {label}
      </button>
    </div>
  )
}
