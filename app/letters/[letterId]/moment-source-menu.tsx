'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { secondaryButtonClass, helperTextClass } from '@/app/profile/ui'

const MENU_MARGIN = 8
const ANCHOR_GAP = 6

/**
 * Pure: clamps a preferred (top, left) box of the given size into the
 * viewport, flipping above the anchor when there isn't enough room
 * below it — extracted from the component so the flip/clamp arithmetic
 * is directly testable without mounting anything.
 */
export function positionMomentSourceMenu(
  anchorRect: { top: number; bottom: number; left: number; right: number },
  menuSize: { width: number; height: number },
  viewport: { width: number; height: number }
): { top: number; left: number } {
  const fitsBelow = anchorRect.bottom + ANCHOR_GAP + menuSize.height <= viewport.height - MENU_MARGIN
  const top = fitsBelow
    ? anchorRect.bottom + ANCHOR_GAP
    : Math.max(MENU_MARGIN, anchorRect.top - ANCHOR_GAP - menuSize.height)

  const maxLeft = viewport.width - menuSize.width - MENU_MARGIN
  const left = Math.min(Math.max(anchorRect.left, MENU_MARGIN), Math.max(maxLeft, MENU_MARGIN))

  return { top, left }
}

/**
 * The Moment source choice ("Choose from library" / "Take a photo" /
 * Cancel), spatially anchored to whichever ⊕ control was actually
 * tapped — a fixed-position popover near the trigger rather than a
 * sheet pinned to the bottom of a long composer, where a mobile writer
 * could tap ⊕ far up the page and never notice anything opened. Shared
 * by both letter Moments (moments-composer.tsx) and Dispatch Moments
 * (board/dispatch-composer.tsx) — one implementation, not a mobile/
 * desktop split, since fixed-viewport positioning already works
 * correctly at any width.
 *
 * Measured in two passes (render invisible, measure, then place) so the
 * flip-above/clamp math in positionMomentSourceMenu always uses the
 * menu's real rendered size rather than a guessed constant.
 */
export default function MomentSourceMenu({
  anchorRect,
  onChooseLibrary,
  onChooseCamera,
  onCancel,
}: {
  anchorRect: DOMRect
  onChooseLibrary: () => void
  onChooseCamera: () => void
  onCancel: () => void
}) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const [style, setStyle] = useState<{ top: number; left: number; visibility: 'hidden' | 'visible' }>({
    top: anchorRect.bottom + ANCHOR_GAP,
    left: anchorRect.left,
    visibility: 'hidden',
  })

  useLayoutEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const { width, height } = menu.getBoundingClientRect()
    const { top, left } = positionMomentSourceMenu(anchorRect, { width, height }, {
      width: window.innerWidth,
      height: window.innerHeight,
    })
    setStyle({ top, left, visibility: 'visible' })
    // anchorRect is a fresh DOMRect snapshot from the click that opened
    // this menu — never expected to change identity while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    function handlePointerDown(e: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) onCancel()
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel()
    }
    // A scroll while open would leave this fixed-position menu visually
    // detached from the trigger it was anchored to — closing rather
    // than re-anchoring is the same restrained behavior most anchored
    // menus use, and keeps this simple.
    function handleScroll() {
      onCancel()
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('scroll', handleScroll, { capture: true, passive: true })
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('scroll', handleScroll, { capture: true })
    }
  }, [onCancel])

  return (
    <div
      ref={menuRef}
      role="menu"
      style={{ position: 'fixed', top: style.top, left: style.left, visibility: style.visibility }}
      className="z-50 w-56 space-y-1 rounded-md border border-foreground/10 bg-background p-2 shadow-lg"
    >
      <button
        type="button"
        role="menuitem"
        onClick={onChooseLibrary}
        className={`w-full justify-start ${secondaryButtonClass}`}
      >
        Choose from library
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onChooseCamera}
        className={`w-full justify-start ${secondaryButtonClass}`}
      >
        Take a photo
      </button>
      <button
        type="button"
        role="menuitem"
        onClick={onCancel}
        className={`w-full px-2 py-1 text-left ${helperTextClass}`}
      >
        Cancel
      </button>
    </div>
  )
}
