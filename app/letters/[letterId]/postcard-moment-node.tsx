'use client'

import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { POSTCARD_CATALOG } from '@/lib/moments'

/**
 * A Postcard Moment as a real, atomic inline node — restores the
 * Postcard entry point to the Write Anytime composer (postcard-
 * picker.tsx was defined but never reachable from any composer after
 * the continuous-editor rewrite; see moments-composer.tsx's own "Add a
 * postcard" affordance). Same architecture as PhotoMoment
 * (photo-moment-node.tsx) — a genuine ProseMirror child of the
 * paragraph it belongs to, so its position is never a separately-
 * tracked index that can drift. Deliberately NOT available in a
 * Dispatch composer: Postcards remain private-correspondence-only (see
 * the Build Guide's Dispatches section) — this node type is imported
 * only by the private letter composer.
 */
export const PostcardMoment = Node.create({
  name: 'postcardMoment',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      postcardKey: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-postcard-moment]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-postcard-moment': '' }, HTMLAttributes)]
  },

  addNodeView() {
    return ReactNodeViewRenderer(PostcardMomentView)
  },
})

function PostcardMomentView({ node, deleteNode }: NodeViewProps) {
  const { postcardKey } = node.attrs as { postcardKey: string }
  const postcard = POSTCARD_CATALOG[postcardKey]

  return (
    <NodeViewWrapper as="span" contentEditable={false} className="relative mx-0.5 inline-flex align-middle">
      {postcard ? (
        <img src={postcard.frontImagePath} alt="" className="h-7 w-7 rounded object-cover" />
      ) : (
        <span className="flex h-7 w-7 items-center justify-center rounded bg-foreground/10 text-[13px]">
          ✉️
        </span>
      )}
      <button
        type="button"
        onClick={() => deleteNode()}
        aria-label="Remove this postcard"
        className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-xs leading-none text-background"
      >
        ×
      </button>
    </NodeViewWrapper>
  )
}
