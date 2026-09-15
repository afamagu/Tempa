'use client'

import { type Reply } from '@/lib/replies'
import { sectionTitleClass, helperTextClass } from '@/app/profile/ui'
import ReplyRow from './reply-row'
import ReplyComposer from './reply-composer'

/**
 * Board Experience Phase 2B — "Replies" beneath a Dispatch. Deliberately
 * NOT called Comments/Threads/Reactions anywhere in this UI. No Reply
 * count is shown here or on any Board/Home card — see the checkpoint's
 * own locked product decisions. `initialReplies` arrives already
 * ordered for display (lib/replies.ts's orderRepliesForDisplay) — one
 * visual indentation level only, applied per-row by ReplyRow itself
 * based on `rootReplyId`, never by anything here.
 */
export default function RepliesSection({
  dispatchId,
  viewerId,
  initialReplies,
}: {
  dispatchId: string
  viewerId: string
  initialReplies: Reply[]
}) {
  // router.refresh() (triggered from ReplyComposer/ReplyRow after a
  // successful post/removal) re-renders this Server Component subtree
  // with fresh data — initialReplies is simply the current prop value
  // on every render, not local state that could drift from the server.
  const replies = initialReplies

  return (
    <div className="space-y-4">
      <p className={sectionTitleClass}>Replies</p>

      {replies.length === 0 ? (
        <p className={helperTextClass}>No replies yet.</p>
      ) : (
        <div className="space-y-5">
          {replies.map((reply) => (
            <ReplyRow key={reply.id} reply={reply} viewerId={viewerId} dispatchId={dispatchId} />
          ))}
        </div>
      )}

      <ReplyComposer dispatchId={dispatchId} triggerLabel="Reply" />
    </div>
  )
}
