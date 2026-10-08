'use client'

import { useEffect, useState } from 'react'
import { Node, mergeAttributes } from '@tiptap/core'
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react'
import { createClient } from '@/lib/supabase/client'
import { resolveLetterPhotoUrl } from '@/lib/draft-photo-url'

export const VideoMoment = Node.create({
  name: 'videoMoment',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,
  addAttributes() {
    return {
      imagePath: { default: null },
      previewUrl: { default: null },
      trimStartSeconds: { default: 0 },
      durationSeconds: { default: 10 },
    }
  },
  parseHTML() { return [{ tag: 'span[data-video-moment]' }] },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes({ 'data-video-moment': '' }, HTMLAttributes)]
  },
  addNodeView() { return ReactNodeViewRenderer(VideoMomentView) },
})

function VideoMomentView({ node, deleteNode, updateAttributes }: NodeViewProps) {
  const { imagePath, previewUrl, trimStartSeconds, durationSeconds } = node.attrs as {
    imagePath: string
    previewUrl: string | null
    trimStartSeconds: number
    durationSeconds: number
  }
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (previewUrl || !imagePath) return
    let cancelled = false
    resolveLetterPhotoUrl(createClient(), imagePath).then(({ url }) => {
      if (cancelled) return
      if (url) updateAttributes({ previewUrl: url })
      else setFailed(true)
    })
    return () => { cancelled = true }
  }, [imagePath, previewUrl, updateAttributes])

  function remove() {
    if (previewUrl?.startsWith('blob:')) URL.revokeObjectURL(previewUrl)
    deleteNode()
  }

  return (
    <NodeViewWrapper as="span" contentEditable={false} className="relative mx-0.5 inline-flex align-middle">
      {previewUrl && !failed ? (
        <video
          src={previewUrl}
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={(e) => { e.currentTarget.currentTime = trimStartSeconds }}
          onTimeUpdate={(e) => {
            if (e.currentTarget.currentTime >= trimStartSeconds + durationSeconds) {
              e.currentTarget.pause()
              e.currentTarget.currentTime = trimStartSeconds
            }
          }}
          className="h-7 w-10 rounded object-cover"
        />
      ) : (
        <span className="flex h-7 w-10 items-center justify-center rounded bg-foreground/10 text-[12px]">▶</span>
      )}
      <button type="button" onClick={remove} aria-label="Remove this video" className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-foreground text-xs leading-none text-background">×</button>
    </NodeViewWrapper>
  )
}
