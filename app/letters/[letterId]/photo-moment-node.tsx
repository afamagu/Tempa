'use client'

import { useEffect, useRef, useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { createClient } from '@/lib/supabase/client'
import { resolveLetterPhotoUrl } from '@/lib/draft-photo-url'
import { resolveRestoredPhotoWithRetries } from '@/lib/resolve-restored-photo'

// Live-repair checkpoint (2026-09-08), second pass — the first fix (one
// retry, 1.5s later) was itself an unrecoverable ceiling: live testing
// showed restored Photos still stuck on their placeholder after BOTH
// the initial attempt and the retry, even though the identical
// canonical resolver, called later from Preview's own click handler in
// the same authenticated page, succeeds every time against the same
// imagePath. Every other candidate this checkpoint's own investigation
// checked (NodeView recreation, cancellation misfiring, stale closures,
// dependency-array churn, a stale `getPos()` inside `updateAttributes`,
// object-URL cleanup) traces out clean — this is the documented-correct
// async-NodeView pattern. What IS a real, provable defect regardless of
// the exact transient cause: the previous version had a HARD CEILING —
// exactly one retry, a ~1.5s window — with no way to recover short of a
// full reload, which just repeats the same narrow window. Fixed on two
// axes: resolveRestoredPhotoWithRetries (lib/resolve-restored-photo.ts)
// gives it a longer bounded backoff, and the failed placeholder below is
// now an explicit, user-triggered retry — so recoverability never
// depends on guessing the right number of milliseconds.

/**
 * A photo Moment as a real, atomic inline node inside the paragraph it
 * belongs to — not text, and never serialized into `p_body`
 * (docToPlainBody in lib/letter-editor-doc.ts skips every node type
 * except text/hardBreak). Because it's a genuine child of its paragraph
 * node, ProseMirror's own position-mapping keeps it correctly attached
 * to that exact paragraph through any edit anywhere else in the
 * document — there is no separately-tracked index for it to drift from.
 *
 * `previewUrl` is deliberately optional: a photo restored from a saved
 * draft only has `imagePath` (a `URL.createObjectURL` reference cannot
 * survive a page reload), so the node view below re-requests a fresh
 * signed URL for it on mount when `previewUrl` is missing — via the ONE
 * canonical resolver (resolveLetterPhotoUrl, lib/draft-photo-url.ts)
 * also used by the Preview-preparation layer, so the editor and Preview
 * can never invent two different answers for the same imagePath.
 */
export const PhotoMoment = Node.create({
  name: 'photoMoment',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      imagePath: { default: null },
      previewUrl: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-photo-moment]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-photo-moment': '' }, HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(PhotoMomentView)
  },
})

function PhotoMomentView({ node, deleteNode, updateAttributes }: NodeViewProps) {
  const { imagePath, previewUrl } = node.attrs as { imagePath: string; previewUrl: string | null }
  const [resolveFailed, setResolveFailed] = useState(false)
  // Bumped only by the member's own "tap to retry" — a genuinely new
  // resolution attempt, distinct from imagePath/previewUrl (which never
  // change on their own once a photo is attached) — is what re-arms the
  // effect below after every automatic attempt has already failed.
  const [retryToken, setRetryToken] = useState(0)
  const cancelledRef = useRef(false)

  // Restoring a draft only has imagePath (the real, already-uploaded
  // Storage path) — the actual file was never lost, only the transient
  // in-memory preview reference. Re-signing it here is the small,
  // deliberate async step lib/letter-editor-draft.ts's own comment
  // anticipates, kept local to the one node that needs it rather than
  // blocking the rest of the restore. Uses the ONE canonical resolver —
  // never a second, ad-hoc signing call — via resolveRestoredPhotoWithRetries
  // (lib/resolve-restored-photo.ts), which owns the bounded-backoff retry
  // loop itself so this component only has to react to its outcome.
  useEffect(() => {
    if (previewUrl || !imagePath) return
    cancelledRef.current = false

    async function run() {
      const supabase = createClient()
      const result = await resolveRestoredPhotoWithRetries(imagePath, (path) => resolveLetterPhotoUrl(supabase, path), {
        isCancelled: () => cancelledRef.current,
      })
      if (result.status === 'cancelled') return

      if (result.status === 'resolved') {
        updateAttributes({ previewUrl: result.url })
        return
      }

      console.error('[moments] could not resolve a restored photo Moment after retries', {
        imagePath,
        error: result.error,
      })
      setResolveFailed(true)
    }

    run()

    return () => {
      cancelledRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imagePath, previewUrl, retryToken])

  function handleRemove() {
    if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
    deleteNode()
  }

  // The member's own escape hatch: guarantees a stuck photo is always
  // recoverable without a full page reload (which would only repeat the
  // same automatic attempts), regardless of how long the underlying
  // transient condition takes to clear. Resetting resolveFailed here —
  // a plain click handler, never inside the effect itself — is what
  // re-arms the placeholder's visible state for the new attempt.
  function handleRetry() {
    setResolveFailed(false)
    setRetryToken((n) => n + 1)
  }

  return (
    <NodeViewWrapper as="span" contentEditable={false} className="relative mx-0.5 inline-flex align-middle">
      {previewUrl ? (
        <img src={previewUrl} alt="" className="h-7 w-7 rounded object-cover" />
      ) : resolveFailed ? (
        <button
          type="button"
          onClick={handleRetry}
          aria-label="Retry loading this photo"
          title="Could not load this photo — it is still attached and will still send. Tap to try again."
          className="flex h-7 w-7 items-center justify-center rounded bg-red-600/10 text-[13px]"
        >
          📷
        </button>
      ) : (
        <span className="flex h-7 w-7 items-center justify-center rounded bg-foreground/10 text-[13px]">📷</span>
      )}
      {/* Mobile tap-target audit (2026-09-05): the visual circle stays
          small (proportionate to the 28px thumbnail it sits on), but a
          16px hit area was genuinely too small to reliably tap on a
          touch device for a destructive action — enlarged to 24px. */}
      <button
        type="button"
        onClick={handleRemove}
        aria-label="Remove this photo"
        className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-xs leading-none text-background"
      >
        ×
      </button>
    </NodeViewWrapper>
  )
}
