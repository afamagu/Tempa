'use client'

import { useEffect, useRef, useState } from 'react'
import { iconButtonClass, focusRingClass } from '@/app/profile/ui'
import Tooltip from '@/app/profile/tooltip'

// A small, curated, restrained set — this is punctuation for a letter,
// not a sticker system, so there is no search and no attempt at
// exhaustive Unicode coverage. Each entry needs its own accessible
// name since a bare emoji glyph reads as nothing useful to a screen
// reader. Grouped loosely by feeling rather than formal Unicode
// categories; a small postal/travel group nods at the product's own
// metaphor without forcing it.
const EMOJI_GROUPS: { label: string; items: { char: string; name: string }[] }[] = [
  {
    label: 'Smiling',
    items: [
      { char: '🙂', name: 'Slightly smiling face' },
      { char: '😊', name: 'Smiling face with smiling eyes' },
      { char: '😄', name: 'Grinning face with smiling eyes' },
      { char: '😂', name: 'Face with tears of joy' },
      { char: '🥹', name: 'Face holding back tears' },
      { char: '😉', name: 'Winking face' },
      { char: '😌', name: 'Relieved face' },
      { char: '🤔', name: 'Thinking face' },
    ],
  },
  {
    label: 'Warmth',
    items: [
      { char: '❤️', name: 'Red heart' },
      { char: '🥰', name: 'Smiling face with hearts' },
      { char: '🤗', name: 'Hugging face' },
      { char: '🙏', name: 'Folded hands' },
      { char: '✨', name: 'Sparkles' },
      { char: '🌟', name: 'Glowing star' },
      { char: '🥲', name: 'Smiling face with a tear' },
      { char: '👋', name: 'Waving hand' },
    ],
  },
  {
    label: 'Nature',
    items: [
      { char: '🌿', name: 'Herb' },
      { char: '🌊', name: 'Water wave' },
      { char: '🌅', name: 'Sunrise' },
      { char: '🌙', name: 'Crescent moon' },
      { char: '☕', name: 'Hot beverage' },
      { char: '🍂', name: 'Fallen leaf' },
      { char: '🌧️', name: 'Cloud with rain' },
      { char: '☀️', name: 'Sun' },
    ],
  },
  {
    label: 'Post & travel',
    items: [
      { char: '✉️', name: 'Envelope' },
      { char: '📮', name: 'Postbox' },
      { char: '📚', name: 'Books' },
      { char: '🗺️', name: 'World map' },
      { char: '🧭', name: 'Compass' },
      { char: '🚂', name: 'Locomotive' },
      { char: '🪴', name: 'Potted plant' },
      { char: '🕊️', name: 'Dove' },
    ],
  },
]

function EmojiTriggerIcon() {
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
      <circle cx="12" cy="12" r="9" />
      <path d="M8.5 14.5c1 1.2 2.2 1.8 3.5 1.8s2.5-.6 3.5-1.8" />
      <path d="M9 9.5h.01" />
      <path d="M15 9.5h.01" />
    </svg>
  )
}

/**
 * A restrained Unicode emoji picker — plain characters only, never a
 * custom sticker image. `onSelect` receives just the emoji string;
 * this component has no idea whether it's inserting into a Tiptap
 * editor or a plain textarea, so the same picker serves both (see
 * writing-toolbar.tsx for the editor case and app/question/question-
 * answer.tsx for the plain-textarea case). Closes itself immediately
 * after a pick — this is a considered addition to a letter, not a
 * stream of reactions.
 */
export default function EmojiPicker({ onSelect }: { onSelect: (emoji: string) => void }) {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    function handlePointerDown(e: PointerEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  function pick(emoji: string) {
    setOpen(false)
    onSelect(emoji)
  }

  return (
    <div ref={wrapperRef} className="relative">
      <Tooltip label="Insert emoji">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-label="Insert emoji"
          aria-expanded={open}
          className={iconButtonClass}
        >
          <EmojiTriggerIcon />
        </button>
      </Tooltip>

      {open && (
        <div
          role="menu"
          aria-label="Emoji"
          className="absolute left-0 top-full z-20 mt-1 w-64 space-y-2 rounded-md border border-foreground/10 bg-background p-3 shadow-md"
        >
          {EMOJI_GROUPS.map((group) => (
            <div key={group.label}>
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted">
                {group.label}
              </p>
              <div className="flex flex-wrap gap-1">
                {group.items.map((item) => (
                  <button
                    key={item.char}
                    type="button"
                    role="menuitem"
                    onClick={() => pick(item.char)}
                    aria-label={item.name}
                    title={item.name}
                    className={`flex h-8 w-8 items-center justify-center rounded-md text-lg transition-colors hover:bg-foreground/[.06] ${focusRingClass}`}
                  >
                    <span aria-hidden="true">{item.char}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
