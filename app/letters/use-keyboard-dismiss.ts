'use client'

import { useEffect, type RefObject } from 'react'

// Mobile keyboard dismissal for the letter composers. On a touch device:
//   - a TAP outside the active writing field (on the page, not on a
//     control) blurs it, so the native keyboard closes;
//   - starting an intentional VERTICAL drag/scroll of the letter blurs
//     it too, so the member can read and move around the draft.
// Only focus changes: the draft, its selection (kept in the editor's own
// state), autosave and scroll position are untouched, and nothing calls
// preventDefault, so native scrolling and taps behave exactly as before.
// Taps on real controls (Add Moment, attachments, Preview letter, Back,
// Send, links, other fields) are never intercepted. No-op with a mouse.

/** Anything the member taps on purpose. A tap here is never "outside". */
export const KEYBOARD_CONTROL_SELECTOR = [
  'button',
  'a[href]',
  'input',
  'select',
  'textarea',
  'label',
  'summary',
  '[role="button"]',
  '[role="menuitem"]',
  '[role="option"]',
  '[role="dialog"]',
  '[contenteditable="true"]',
  '[data-keep-keyboard]',
].join(', ')

const NON_TEXT_INPUTS = new Set(['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'range', 'color', 'image'])

/** A field that raises the on-screen keyboard. */
export function isTextEntryElement(el: Element | null): el is HTMLElement {
  if (!el || typeof HTMLElement === 'undefined' || !(el instanceof HTMLElement)) return false
  if (el.isContentEditable) return true
  if (el.tagName === 'TEXTAREA') return true
  return el.tagName === 'INPUT' && !NON_TEXT_INPUTS.has((el as HTMLInputElement).type)
}

/** A tap on `target` should dismiss the keyboard held by `active`. */
export function shouldDismissOnTap(target: Element | null, active: Element | null): boolean {
  if (!target || !isTextEntryElement(active)) return false
  if (active.contains(target)) return false
  return target.closest(KEYBOARD_CONTROL_SELECTOR) === null
}

/** Movement that is a deliberate vertical scroll, not a tap, a sideways
 * swipe, or a long-press text-selection drag (which starts only after a
 * pause). */
export const DRAG_MIN_PX = 12
export const DRAG_MAX_START_MS = 450

export function isIntentionalVerticalDrag(dx: number, dy: number, msSinceTouchStart: number): boolean {
  return Math.abs(dy) >= DRAG_MIN_PX && Math.abs(dy) > Math.abs(dx) * 1.5 && msSinceTouchStart <= DRAG_MAX_START_MS
}

/** A drag starting on a plain field (textarea/input) scrolls that field
 * itself; only drags starting on the letter / page may dismiss. */
export function dragMayDismiss(startTarget: Element | null): boolean {
  if (!startTarget) return true
  return startTarget.closest('input, textarea, select, [data-keep-keyboard]') === null
}

const TAP_SLOP_PX = 10

export function useKeyboardDismiss(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return
    const coarse = typeof window.matchMedia === 'function' && window.matchMedia('(pointer: coarse)').matches
    if (!coarse) return

    let start: { x: number; y: number; t: number; target: Element | null } | null = null
    let moved = false
    let dismissedThisGesture = false

    const activeField = (): HTMLElement | null => {
      const active = document.activeElement
      const root = rootRef.current
      return isTextEntryElement(active) && root && root.contains(active) ? active : null
    }

    const onStart = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (!touch || e.touches.length > 1) {
        start = null
        return
      }
      start = { x: touch.clientX, y: touch.clientY, t: performance.now(), target: e.target as Element | null }
      moved = false
      dismissedThisGesture = false
    }

    const onMove = (e: TouchEvent) => {
      const touch = e.touches[0]
      if (!start || !touch) return
      const dx = touch.clientX - start.x
      const dy = touch.clientY - start.y
      if (Math.abs(dx) > TAP_SLOP_PX || Math.abs(dy) > TAP_SLOP_PX) moved = true
      if (dismissedThisGesture || !dragMayDismiss(start.target)) return
      if (!isIntentionalVerticalDrag(dx, dy, performance.now() - start.t)) return
      const field = activeField()
      if (field) {
        field.blur()
        dismissedThisGesture = true
      }
    }

    const onEnd = (e: TouchEvent) => {
      if (start && !moved) {
        const field = activeField()
        if (field && shouldDismissOnTap(e.target as Element | null, field)) field.blur()
      }
      start = null
    }

    document.addEventListener('touchstart', onStart, { passive: true })
    document.addEventListener('touchmove', onMove, { passive: true })
    document.addEventListener('touchend', onEnd, { passive: true })
    return () => {
      document.removeEventListener('touchstart', onStart)
      document.removeEventListener('touchmove', onMove)
      document.removeEventListener('touchend', onEnd)
    }
  }, [rootRef])
}
