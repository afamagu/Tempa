'use client'

import { useEffect, type RefObject } from 'react'
import { isTextEntryElement } from './use-keyboard-dismiss'

export const KEYBOARD_THRESHOLD_PX = 80
export const KEYBOARD_GUTTER_PX = 24

/**
 * Difference between the layout viewport and the currently visible viewport.
 * On mobile browsers this is the useful fallback signal for an on-screen
 * keyboard when the browser resizes only VisualViewport.
 */
export function visualKeyboardInset(
  layoutViewportHeight: number,
  visualViewportHeight: number,
  visualViewportOffsetTop: number
) {
  return Math.max(
    0,
    layoutViewportHeight - (visualViewportHeight + visualViewportOffsetTop)
  )
}

/**
 * Gives a focused mobile editor enough document space to scroll above the
 * on-screen keyboard without ever taking control of scrolling from the user.
 *
 * Important: this hook deliberately does NOT scroll the page to the caret,
 * listen to VisualViewport scroll, or react to selectionchange. Safari can
 * report changing VisualViewport geometry during a finger drag, and forcing
 * programmatic scrolling from those events makes native scrolling fight the page.
 *
 * The browser remains responsible for caret movement and finger scrolling.
 * Tempa only reserves bottom space while a keyboard-owning field in this
 * writing surface is focused. Geometry updates are frozen while a finger is
 * down, so iOS/WebKit's transient viewport values cannot resize the document
 * in the middle of a drag.
 */
export function useEditorVisualViewport(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return

    const viewport = window.visualViewport
    const root = rootRef.current
    if (!viewport || !root) return

    const originalPaddingBottom = root.style.paddingBottom
    let frame = 0
    let touching = false
    let reservedInset = 0

    const syncViewport = (force = false) => {
      if (touching && !force) return

      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const active = document.activeElement
        const ownsKeyboardFocus =
          isTextEntryElement(active) && root.contains(active)

        const inset = visualKeyboardInset(
          window.innerHeight,
          viewport.height,
          viewport.offsetTop
        )

        if (!ownsKeyboardFocus || inset < KEYBOARD_THRESHOLD_PX) {
          reservedInset = 0
          root.style.paddingBottom = originalPaddingBottom
          return
        }

        // Never shrink the reserved keyboard space while focus stays in this
        // editor. WebKit can transiently report a taller visual viewport while
        // the user drags. Shrinking here would move content under their finger.
        reservedInset = Math.max(reservedInset, inset)
        root.style.paddingBottom = `${reservedInset + KEYBOARD_GUTTER_PX}px`
      })
    }

    const onViewportResize = () => syncViewport()
    const onFocusIn = () => syncViewport(true)
    const onFocusOut = () => syncViewport(true)
    const onTouchStart = () => {
      touching = true
    }
    const onTouchEnd = () => {
      touching = false
      syncViewport()
    }

    viewport.addEventListener('resize', onViewportResize)
    window.addEventListener('focusin', onFocusIn)
    window.addEventListener('focusout', onFocusOut)
    document.addEventListener('touchstart', onTouchStart, { passive: true })
    document.addEventListener('touchend', onTouchEnd, { passive: true })
    document.addEventListener('touchcancel', onTouchEnd, { passive: true })

    syncViewport()

    return () => {
      window.cancelAnimationFrame(frame)
      viewport.removeEventListener('resize', onViewportResize)
      window.removeEventListener('focusin', onFocusIn)
      window.removeEventListener('focusout', onFocusOut)
      document.removeEventListener('touchstart', onTouchStart)
      document.removeEventListener('touchend', onTouchEnd)
      document.removeEventListener('touchcancel', onTouchEnd)
      root.style.paddingBottom = originalPaddingBottom
    }
  }, [rootRef])
}
