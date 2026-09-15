'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { deleteReply, type Reply } from '@/lib/replies'
import { formatDatePlain } from '@/lib/format-date'
import { helperTextClass } from '@/app/profile/ui'
import DispatchAuthorLink from '../dispatch-author-link'
import ReportButton from '@/app/report-button'
import ReplyComposer from './reply-composer'

/** A quiet, compact inline text action — Reply/Report/Remove sit in a
 * metadata-tier row beneath a Reply's body, deliberately smaller and
 * quieter than the shared tertiaryButtonClass (which is sized for a
 * standalone control, not a row of three inline actions). */
const inlineActionClass = 'text-[13px] font-medium text-foreground/50 transition-colors hover:text-foreground'

/** Production polish — long-Reply collapse: a tiny quiet chevron, never
 * "Read more" text/a modal/a box/a large button. Down when collapsed
 * (more to reveal), up when expanded (tap to collapse back). */
function ChevronIcon({ direction }: { direction: 'down' | 'up' }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-3.5 w-3.5 ${direction === 'up' ? 'rotate-180' : ''}`}
      aria-hidden="true"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

/**
 * One Reply. Indentation is binary, never staircased: a Reply renders
 * with one consistent left indent whenever it belongs to a thread
 * (`reply.rootReplyId !== null`), regardless of how many real hops its
 * own parentReplyId chain represents — B replying to A, C replying to
 * B, and D replying to C all render at the exact same indentation
 * level, per the checkpoint's own locked "no Reddit staircase" rule.
 *
 * A tombstoned Reply (isDeleted) shows only identity + timestamp +
 * "Reply removed" — no Reply/Report/Remove affordances, matching "quiet
 * styling, no engagement CTA."
 */
export default function ReplyRow({
  reply,
  viewerId,
  dispatchId,
}: {
  reply: Reply
  viewerId: string
  dispatchId: string
}) {
  const router = useRouter()
  const [replying, setReplying] = useState(false)
  const [confirmingRemove, setConfirmingRemove] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const bodyRef = useRef<HTMLParagraphElement>(null)
  const [bodyExpanded, setBodyExpanded] = useState(false)
  const [bodyOverflows, setBodyOverflows] = useState(false)

  const isOwn = reply.authorId === viewerId
  const isNested = reply.rootReplyId !== null

  // Production polish — long-Reply collapse: display-only, never a
  // different/truncated stored body. line-clamp-2 (below) is what
  // actually clips the text; this only decides whether the chevron
  // appears at all, by measuring the real rendered overflow at the
  // current viewport width — not a character-count heuristic, since
  // that wouldn't re-measure correctly across responsive/mobile widths.
  // While expanded, skip remeasuring (the clamp isn't applied, so
  // scrollHeight/clientHeight would trivially match) — bodyOverflows
  // simply keeps its last-known value, which is what makes the
  // collapse-back chevron stay visible.
  useEffect(() => {
    function measure() {
      const el = bodyRef.current
      if (!el || bodyExpanded) return
      setBodyOverflows(el.scrollHeight > el.clientHeight + 1)
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [reply.body, bodyExpanded])

  async function handleRemove() {
    if (busy) return
    setBusy(true)
    setError(null)
    const { error: removeError } = await deleteReply(createClient(), reply.id)
    setBusy(false)
    if (removeError) {
      setError('Could not remove this Reply. Please try again.')
      return
    }
    router.refresh()
  }

  return (
    <div className={isNested ? 'ml-6 border-l border-foreground/10 pl-4' : ''}>
      <div className="flex min-w-0 items-center gap-1.5">
        <DispatchAuthorLink authorId={reply.authorId} authorPseudonym={reply.authorPseudonym} authorCountry={reply.authorCountry} size="sm" />
        <p className={`shrink-0 ${helperTextClass}`}>· {formatDatePlain(reply.createdAt)}</p>
      </div>

      {reply.isDeleted ? (
        <p className={`mt-1 italic ${helperTextClass}`}>Reply removed</p>
      ) : (
        <>
          {reply.replyToUserId && reply.replyToPseudonym && (
            <p className={`mt-1 ${helperTextClass}`}>@{reply.replyToPseudonym}</p>
          )}
          <p
            ref={bodyRef}
            className={`mt-1 whitespace-pre-wrap text-[15px] leading-relaxed text-foreground ${bodyExpanded ? '' : 'line-clamp-2'}`}
          >
            {reply.body}
          </p>
          {bodyOverflows && (
            <button
              type="button"
              onClick={() => setBodyExpanded((v) => !v)}
              aria-expanded={bodyExpanded}
              aria-label={bodyExpanded ? 'Show less of this Reply' : 'Show the full Reply'}
              className="mt-1 text-foreground/40 transition-colors hover:text-foreground/70"
            >
              <ChevronIcon direction={bodyExpanded ? 'up' : 'down'} />
            </button>
          )}

          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            {!replying && (
              <button type="button" onClick={() => setReplying(true)} className={inlineActionClass}>
                Reply
              </button>
            )}
            {!isOwn && (
              <ReportButton
                targetType="reply"
                targetId={reply.id}
                triggerClassName={inlineActionClass}
                triggerLabel="Report"
              />
            )}
            {isOwn && !confirmingRemove && (
              <button type="button" onClick={() => setConfirmingRemove(true)} className={inlineActionClass}>
                Remove
              </button>
            )}
          </div>

          {isOwn && confirmingRemove && (
            <div className="mt-1.5 flex flex-wrap items-center gap-3">
              <p className={helperTextClass}>Remove this Reply?</p>
              <button type="button" onClick={handleRemove} disabled={busy} className="text-[13px] font-medium text-red-700">
                {busy ? 'Removing…' : 'Yes, remove'}
              </button>
              <button type="button" onClick={() => setConfirmingRemove(false)} disabled={busy} className={inlineActionClass}>
                Cancel
              </button>
            </div>
          )}

          {error && <p className="mt-1 text-sm text-red-600">{error}</p>}

          {replying && (
            <div className="mt-2">
              <ReplyComposer
                dispatchId={dispatchId}
                parentReplyId={reply.id}
                autoFocus
                onDone={() => setReplying(false)}
              />
            </div>
          )}
        </>
      )}
    </div>
  )
}
