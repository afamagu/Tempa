'use client'

import { useEffect } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { createClient } from '@/lib/supabase/client'

const PHOTO_SIGNED_URL_TTL_SECONDS = 60 * 10

/**
 * A still-image Moment inside a Dispatch — deliberately a SEPARATE node
 * type from the private letter composer's PhotoMoment
 * (app/letters/[letterId]/photo-moment-node.tsx), not a shared/
 * parameterized one: the only difference is which storage bucket it
 * signs URLs against ('dispatch-photos', never 'letter-photos'), and
 * keeping that as a hardcoded, separate small file makes it structurally
 * impossible for a Dispatch photo to ever be signed against — or
 * confused with — the private, consent-gated letter-photos bucket. Same
 * atomic-ProseMirror-node architecture and grammar otherwise (see that
 * file's own doc comment). No postcard equivalent exists here —
 * Postcards remain private-correspondence-only.
 */
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

function DispatchPhotoMomentView({ node, deleteNode, updateAttributes }: NodeViewProps) {
  const { imagePath, previewUrl } = node.attrs as { imagePath: string; previewUrl: string | null }

  useEffect(() => {
    if (previewUrl || !imagePath) return
    let cancelled = false
    const supabase = createClient()
    supabase.storage
      .from('dispatch-photos')
      .createSignedUrl(imagePath, PHOTO_SIGNED_URL_TTL_SECONDS)
      .then(({ data }) => {
        if (!cancelled && data?.signedUrl) updateAttributes({ previewUrl: data.signedUrl })
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imagePath, previewUrl])

  function handleRemove() {
    if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
    deleteNode()
  }

  return (
    <NodeViewWrapper as="span" contentEditable={false} className="relative mx-0.5 inline-flex align-middle">
      {previewUrl ? (
        <img src={previewUrl} alt="" className="h-7 w-7 rounded object-cover" />
      ) : (
        <span className="flex h-7 w-7 items-center justify-center rounded bg-foreground/10 text-[13px]">
          📷
        </span>
      )}
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
