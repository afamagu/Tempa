'use client'

import type { Editor } from '@tiptap/react'
import { iconButtonClass } from '@/app/profile/ui'
import Tooltip from '@/app/profile/tooltip'
import EmojiPicker from './emoji-picker'

function BoldIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M7 5.5h6a3.25 3.25 0 0 1 0 6.5H7z" />
      <path d="M7 12h6.5a3.25 3.25 0 0 1 0 6.5H7z" />
    </svg>
  )
}

function ItalicIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M10 5.5h7" />
      <path d="M7 18.5h7" />
      <path d="M13 5.5 11 18.5" />
    </svg>
  )
}

function toggleButtonClass(active: boolean) {
  return `${iconButtonClass} ${active ? 'bg-foreground/[.08] text-foreground' : ''}`
}

/**
 * TEMPA's one deliberately small writing toolbar — Bold, Italic,
 * Emoji, nothing else (see docs/tempa-build-guide.md's writing-
 * essentials section for the explicit "not a word processor"
 * boundary). Shared by every letter composer (first contact, the
 * first-contact reply, and Write Anytime) so the exact same three
 * controls, active-state logic, and keyboard shortcuts appear
 * everywhere a member writes to another person.
 *
 * Uses Tiptap's own recommended chained-command pattern
 * (`editor.chain().focus().toggleBold().run()`) throughout — `focus()`
 * restores focus to the editor's CURRENT selection rather than
 * resetting it, which is what keeps a toolbar click from collapsing or
 * relocating the text the member had selected (see the checkpoint's
 * own "toolbar interaction must preserve selection" requirement).
 * Keyboard shortcuts (Cmd/Ctrl+B, Cmd/Ctrl+I) are Bold/Italic's own
 * default Tiptap keybindings — nothing extra is wired here.
 */
export default function WritingToolbar({ editor }: { editor: Editor | null }) {
  function insertEmoji(emoji: string) {
    editor?.chain().focus().insertContent(emoji).run()
  }

  return (
    <div className="flex items-center gap-1 border-b border-foreground/10 pb-2">
      <Tooltip label="Bold (Cmd/Ctrl+B)">
        <button
          type="button"
          onClick={() => editor?.chain().focus().toggleBold().run()}
          disabled={!editor}
          aria-label="Bold"
          aria-pressed={editor?.isActive('bold') ?? false}
          className={toggleButtonClass(editor?.isActive('bold') ?? false)}
        >
          <BoldIcon />
        </button>
      </Tooltip>
      <Tooltip label="Italic (Cmd/Ctrl+I)">
        <button
          type="button"
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          disabled={!editor}
          aria-label="Italic"
          aria-pressed={editor?.isActive('italic') ?? false}
          className={toggleButtonClass(editor?.isActive('italic') ?? false)}
        >
          <ItalicIcon />
        </button>
      </Tooltip>
      <EmojiPicker onSelect={insertEmoji} />
    </div>
  )
}
