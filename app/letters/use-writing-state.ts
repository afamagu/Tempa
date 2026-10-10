'use client'

import { useEditorState, type Editor } from '@tiptap/react'
import type { Node } from '@tiptap/pm/model'
import { docToPlainBody, type LetterDocJSON } from '@/lib/letter-editor-doc'

const contentCache = new WeakMap<Node, boolean>()
const countCache = new WeakMap<Node, number>()

/** Subscribe to eligibility, not the entire document or every selection. */
export function useWritingState(editor: Editor | null, countCharacters = false) {
  return useEditorState({
    editor,
    selector: ({ editor: current }) => {
      if (!current) return { hasContent: false, charCount: 0 }
      const doc = current.state.doc
      let hasContent = contentCache.get(doc)
      let charCount = countCharacters ? countCache.get(doc) : 0
      if (hasContent === undefined) {
        hasContent = false
        doc.descendants((node) => {
          if (hasContent) return false
          if ((node.isText && node.text?.trim()) || node.type.name === 'photoMoment' || node.type.name === 'postcardMoment') hasContent = true
          return !hasContent
        })
        contentCache.set(doc, hasContent)
      }
      if (charCount === undefined) {
        charCount = Array.from(docToPlainBody(doc.toJSON() as LetterDocJSON)).length
        countCache.set(doc, charCount)
      }
      // Do not rerender the first-letter page for a hidden counter.
      return { hasContent, charCount: (charCount ?? 0) >= 1750 ? charCount! : 0 }
    },
  }) ?? { hasContent: false, charCount: 0 }
}
