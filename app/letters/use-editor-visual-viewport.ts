'use client'

import { useEffect, type RefObject } from 'react'

const CARET_MARGIN_PX = 28
const KEYBOARD_THRESHOLD_PX = 80

/**
 * Keeps Tempa's writing surface inside the REAL visible area when a mobile
 * on-screen keyboard is open. Modern mobile browsers often shrink/offset only
 * the Visual Viewport, while the layout viewport remains taller behind the
 * keyboard. The editor therefore needs explicit scroll room and caret
 * correction rather than assuming 100vh means "what the writer can see".
 *
 * No UA/device sniffing: Android Chrome and iOS Safari both expose
 * VisualViewport. Desktop (or an unsupported browser) is a no-op.
 */
export function useEditorVisualViewport(rootRef: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (typeof window === 'undefined') return
    const viewport = window.visualViewport
    const root = rootRef.current
    if (!viewport || !root) return

    const originalPaddingBottom = root.style.paddingBottom
    let frame = 0

    function keyboardInset() {
      return Math.max(0, window.innerHeight - (viewport!.height + viewport!.offsetTop))
    }

    function selectionBelongsToRoot(): Range | null {
      const selection = window.getSelection()
      if (!selection || selection.rangeCount === 0) return null
      const range = selection.getRangeAt(0)
      const node = range.commonAncestorContainer
      const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement
      if (!element || !root!.contains(element)) return null
      if (!element.closest('[contenteditable="true"]')) return null
      return range
    }

    function keepCaretVisible() {
      const range = selectionBelongsToRoot()
      if (!range) return

      const rects = range.getClientRects()
      const rect = rects.length > 0 ? rects[rects.length - 1] : range.getBoundingClientRect()
      if (!rect || (rect.width === 0 && rect.height === 0)) return

      const visibleTop = viewport!.offsetTop + CARET_MARGIN_PX
      const visibleBottom = viewport!.offsetTop + viewport!.height - CARET_MARGIN_PX

      if (rect.bottom > visibleBottom) {
        window.scrollBy({ top: rect.bottom - visibleBottom, behavior: 'auto' })
      } else if (rect.top < visibleTop) {
        window.scrollBy({ top: rect.top - visibleTop, behavior: 'auto' })
      }
    }

    function syncViewport() {
      window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        const inset = keyboardInset()
        root!.style.paddingBottom =
          inset >= KEYBOARD_THRESHOLD_PX ? `${inset + CARET_MARGIN_PX}px` : originalPaddingBottom
        keepCaretVisible()
      })
    }

    viewport.addEventListener('resize', syncViewport)
    viewport.addEventListener('scroll', syncViewport)
    document.addEventListener('selectionchange', syncViewport)
    window.addEventListener('focusin', syncViewport)

    syncViewport()

    return () => {
      window.cancelAnimationFrame(frame)
      viewport.removeEventListener('resize', syncViewport)
      viewport.removeEventListener('scroll', syncViewport)
      document.removeEventListener('selectionchange', syncViewport)
      window.removeEventListener('focusin', syncViewport)
      root.style.paddingBottom = originalPaddingBottom
    }
  }, [rootRef])
}
