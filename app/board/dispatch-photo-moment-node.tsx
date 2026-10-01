'use client'

import { useEffect, useRef, useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { createClient } from '@/lib/supabase/client'
import { resolveDispatchPhotoUrl } from '@/lib/draft-photo-url'
import { resolveRestoredPhotoWithRetries } from '@/lib/resolve-restored-photo'

// Drafts persist imagePath, not the page-local preview. Restore via the
// canonical Dispatch resolver and the same bounded backoff as letters.
// A successfully signed URL can still fail to load in the browser; that
// case re-signs once and then exposes a retry without losing the Moment.
export const DispatchPhotoMoment = Node.create({
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
    return ReactNodeViewRenderer(DispatchPhotoMomentView)
  },
})

export function DispatchPhotoMomentView({ node, deleteNode, updateAttributes }: NodeViewProps) {
  const { imagePath, previewUrl } = node.attrs as { imagePath: string; previewUrl: string | null }
  const [resolveFailed, setResolveFailed] = useState(false)
  // Bumped only by the member's own "tap to retry" — a genuinely new
  // resolution attempt, distinct from imagePath/previewUrl (which never
  // change on their own once a photo is attached) — is what re-arms the
  // effect below after every automatic attempt has already failed.
  const [retryToken, setRetryToken] = useState(0)
  const cancelledRef = useRef(false)
  const imageLoadRetries = useRef(0)

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
    if (previewUrl || !imagePath || resolveFailed) return
    cancelledRef.current = false

    async function run() {
      const supabase = createClient()
      const result = await resolveRestoredPhotoWithRetries(imagePath, (path) => resolveDispatchPhotoUrl(supabase, path), {
        isCancelled: () => cancelledRef.current,
      })
      if (result.status === 'cancelled') return

      if (result.status === 'resolved') {
        updateAttributes({ previewUrl: result.url })
        return
      }

      console.error('[dispatch moments] could not resolve a restored photo Moment after retries', {
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
  }, [imagePath, previewUrl, retryToken, resolveFailed])

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
    imageLoadRetries.current = 0
    setResolveFailed(false)
    setRetryToken((n) => n + 1)
  }

  function handleImageError() {
    // Signing may succeed even when the browser cannot load the URL.
    // Re-sign once from the durable path, then leave a manual recovery
    // control rather than looping or discarding the attached Moment.
    if (imageLoadRetries.current >= 1) setResolveFailed(true)
    imageLoadRetries.current += 1
    updateAttributes({ previewUrl: null })
  }

  return (
    <NodeViewWrapper as="span" contentEditable={false} className="relative mx-0.5 inline-flex align-middle">
      {previewUrl ? (
        <img src={previewUrl} onError={handleImageError} onLoad={() => { imageLoadRetries.current = 0 }} alt="" className="h-7 w-7 rounded object-cover" />
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
