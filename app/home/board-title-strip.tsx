'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'

const CYCLE_MS = 10000

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

/**
 * ON THE BOARD — a restrained ambient discovery strip, explicitly NOT
 * primary navigation (see app/home/page.tsx for where it sits — below
 * the card sections, never competing with them). One title visible at
 * a time, gentle cross-fade only (no slide/marquee/ticker motion, no
 * layout jumping — every title occupies the exact same fixed-height
 * row via CSS Grid stacking, only opacity changes), advancing roughly
 * every 10 seconds.
 *
 * Pauses while hovered, while keyboard focus is anywhere inside it, and
 * while touched — a reader actively looking at or reaching for a title
 * must never have it change under them. The pause flag lives in a ref,
 * not React state, so pausing/resuming never itself restarts the
 * interval or causes an extra render.
 *
 * prefers-reduced-motion disables the automatic cycle ENTIRELY (the
 * interval is never even started) rather than merely softening the
 * transition — a single static item renders instead, read via the same
 * lazy useState-initializer pattern already used elsewhere in this
 * codebase for a synchronous, SSR-safe browser-API read (see
 * app/board/moment-hint.tsx's alreadySeenThisSession).
 *
 * Deliberately no aria-live region of any kind: an automatically-
 * changing title must never be announced to assistive tech on its own.
 * Only the CURRENTLY visible title is even reachable by keyboard or
 * screen reader — every other title is `aria-hidden` and removed from
 * the tab order while inactive — so the cycling is silent by
 * construction, not merely polite-rather-than-assertive. Each title
 * remains an ordinary accessible link regardless of visibility state.
 */
export default function BoardTitleStrip({
  items,
}: {
  items: { id: string; title: string; href: string }[]
}) {
  const [index, setIndex] = useState(0)
  const [reducedMotion] = useState(prefersReducedMotion)
  const pausedRef = useRef(false)

  useEffect(() => {
    if (reducedMotion || items.length <= 1) return
    const intervalId = window.setInterval(() => {
      if (pausedRef.current) return
      setIndex((i) => (i + 1) % items.length)
    }, CYCLE_MS)
    return () => window.clearInterval(intervalId)
  }, [reducedMotion, items.length])

  if (items.length === 0) return null

  function pause() {
    pausedRef.current = true
  }
  function resume() {
    pausedRef.current = false
  }

  return (
    <div
      className="grid h-6 overflow-hidden"
      onMouseEnter={pause}
      onMouseLeave={resume}
      onFocus={pause}
      onBlur={resume}
      onTouchStart={pause}
      onTouchEnd={resume}
    >
      {items.map((item, i) => {
        const active = i === index
        return (
          <Link
            key={item.id}
            href={item.href}
            aria-hidden={!active}
            tabIndex={active ? 0 : -1}
            className={`[grid-area:1/1] flex items-center truncate text-[14px] text-foreground/70 underline decoration-foreground/25 underline-offset-4 transition-opacity duration-700 hover:text-foreground ${
              active ? 'opacity-100' : 'pointer-events-none opacity-0'
            }`}
          >
            {item.title}
          </Link>
        )
      })}
    </div>
  )
}
