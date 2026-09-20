'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

const SHOW_DELAY_MS = 300

/**
 * A minimal, restrained tooltip/popover for icon-only controls — dark
 * neutral background, small, short delay, no animation spectacle.
 * Reveals on hover and on keyboard focus for pointer-capable devices,
 * AND on tap for touch — never hover-only, since touch devices have no
 * hover state to trigger it. A tap toggles it open/closed; a follow-up
 * tap anywhere outside, or pressing Escape while open, closes it,
 * matching a small popover's expected behavior. This is supplementary
 * either way: the wrapped control must still carry its own aria-label
 * regardless of whether this ever renders, which remains the actual
 * accessibility mechanism.
 *
 * `toggle` calls `preventDefault()` on the triggering event — harmless
 * for a plain `<button type="button">` (every existing caller), but
 * load-bearing for a control that might sit inside an ANCESTOR `<a>`
 * (e.g. a compact country flag inside an identity link, see
 * app/country-flag.tsx): without it, tapping the wrapped control would
 * also follow the surrounding link's href, since a descendant calling
 * only `stopPropagation()` does not stop an ancestor anchor's own
 * default navigation.
 */
export default function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const [visible, setVisible] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const wrapperRef = useRef<HTMLSpanElement | null>(null)

  function show() {
    timeoutRef.current = setTimeout(() => setVisible(true), SHOW_DELAY_MS)
  }

  function hide() {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setVisible(false)
  }

  function toggle(e: { preventDefault: () => void }) {
    e.preventDefault()
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setVisible((v) => !v)
  }

  useEffect(() => {
    if (!visible) return
    function handlePointerDown(e: PointerEvent) {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setVisible(false)
      }
    }
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setVisible(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [visible])

  return (
    <span
      ref={wrapperRef}
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onClick={toggle}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className="pointer-events-none fixed inset-x-3 bottom-3 z-50 mx-auto w-fit max-w-[calc(100vw-1.5rem)] rounded-md bg-foreground px-3 py-2 text-left text-[11px] font-medium leading-snug text-background shadow-md sm:absolute sm:inset-x-auto sm:bottom-auto sm:-top-8 sm:left-1/2 sm:w-max sm:max-w-[240px] sm:-translate-x-1/2 sm:px-2 sm:py-1 sm:shadow-sm"
        >
          {label}
        </span>
      )}
    </span>
  )
}
