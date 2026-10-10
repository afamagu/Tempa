'use client'

import { useEffect, useState } from 'react'
import { useEditorState, type Editor } from '@tiptap/react'
import { emojiSuggestionAt } from '@/lib/emoji-suggestions'

export default function EmojiSuggestions({ editor }: { editor: Editor | null }) {
  const [composing, setComposing] = useState(false)
  useEffect(() => {
    if (!editor) return
    const start = () => setComposing(true)
    const end = () => setComposing(false)
    const dom = editor.view.dom
    dom.addEventListener('compositionstart', start)
    dom.addEventListener('compositionend', end)
    return () => {
      dom.removeEventListener('compositionstart', start)
      dom.removeEventListener('compositionend', end)
    }
  }, [editor])
  const candidate = useEditorState({ editor, selector: ({ editor: current }) =>
    current?.isFocused && current.isEditable ? emojiSuggestionAt(current.state) : null,
  })
  if (!candidate || composing) return null
  return (
    <div role="group" aria-label={`Emoji suggestions for ${candidate.word}`} data-keep-keyboard className="flex min-h-11 flex-wrap items-center gap-1">
      <span className="mr-1 text-xs text-foreground/55">{candidate.word}</span>
      {candidate.choices.map(({ emoji, name }) => (
        <button key={emoji} type="button" aria-label={`Replace ${candidate.word} with ${name}`} className="flex h-11 min-w-11 items-center justify-center rounded-md text-xl hover:bg-foreground/5 focus-visible:outline-2 focus-visible:outline-accent"
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            if (!editor || editor.view.composing) return
            const live = emojiSuggestionAt(editor.state)
            if (!live || live.from !== candidate.from || live.to !== candidate.to || live.word !== candidate.word) return
            editor.chain().focus().insertContentAt({ from: live.from, to: live.to }, emoji).run()
          }}>
          {emoji}
        </button>
      ))}
    </div>
  )
}
