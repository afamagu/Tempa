import { pickCurrentParagraph, estimateScrollFraction, type MeasuredParagraph } from '@/lib/reading-places'

// The DOM-touching half of Reading Places — everything here needs a
// live browser (getBoundingClientRect, getComputedStyle, real scroll
// containers), so none of it is unit-testable in this repo's `node`
// Vitest environment (vitest.config.mts) and is a live-test item, same
// established status as the IntersectionObserver-driven tracking it
// replaces (see letter-reader.test.tsx/dispatch-reader.test.tsx's own
// header comments). The actual "what paragraph/offset is this" decision
// logic lives in lib/reading-places.ts's pickCurrentParagraph — a pure
// function this module only ever feeds plain measurement data, so THAT
// logic (including the nested-scroll-root case — see findScrollRoot
// below) is unit-tested directly there.
//
// Shared by both app/letters/[letterId]/letter-reader.tsx and
// app/board/[dispatchId]/dispatch-reader.tsx's Saved-place tracking —
// the same reasons app/reading-place-controls.tsx is already shared
// between them.

/** Walks up from `el` to find the nearest actually-scrollable ancestor
 * — the source-Letter overlay (app/letters/[letterId]/source-letter-
 * panel.tsx) renders LetterReader inside its own `overflow-y-auto`
 * panel, which is NOT the browser window, so reading position there
 * must be measured relative to THAT element's own top edge, not
 * `window`/`document`. Returns null when no scrollable ancestor is
 * found short of the document itself — the ordinary case for the
 * normal, full-page Letter/Dispatch reader — and callers treat null as
 * "measure relative to the viewport" throughout this module. */
export function findScrollRoot(el: HTMLElement): HTMLElement | null {
  let node: HTMLElement | null = el.parentElement
  while (node) {
    const style = window.getComputedStyle(node)
    if ((style.overflowY === 'auto' || style.overflowY === 'scroll') && node.scrollHeight > node.clientHeight) {
      return node
    }
    node = node.parentElement
  }
  return null
}

function scrollRootTop(scrollRoot: HTMLElement | null): number {
  return scrollRoot ? scrollRoot.getBoundingClientRect().top : 0
}

function scrollRootScrollTop(scrollRoot: HTMLElement | null): number {
  return scrollRoot ? scrollRoot.scrollTop : window.scrollY || document.documentElement.scrollTop
}

/** Measures every tagged paragraph's current position relative to
 * `scrollRoot` (or the viewport, when null) — plain data, no DOM
 * objects, so the actual paragraph/offset decision (pickCurrentParagraph,
 * lib/reading-places.ts) never needs to know whether it was fed
 * viewport-relative or overlay-relative numbers. */
function measureParagraphs(container: HTMLElement, scrollRoot: HTMLElement | null): MeasuredParagraph[] {
  const rootTop = scrollRootTop(scrollRoot)
  const els = Array.from(container.querySelectorAll<HTMLElement>('[data-paragraph-index]'))
  return els.map((el) => {
    const rect = el.getBoundingClientRect()
    return {
      index: Number(el.dataset.paragraphIndex),
      top: rect.top - rootTop,
      height: rect.height,
      textLength: (el.textContent ?? '').length,
    }
  })
}

/** The member's current reading position, re-measured fresh from the
 * live DOM every call — never a ratcheting accumulator (see
 * pickCurrentParagraph's own doc comment for why that was the bug).
 * Callers use this both for periodic/unmount automatic-resume saves and
 * for "Save my place", so the deliberate action always saves what is
 * actually on screen at the moment it's clicked, not a stale value from
 * the last periodic tick. */
export function getCurrentReadingAnchor(
  container: HTMLElement,
  scrollRoot: HTMLElement | null
): { paragraphIndex: number; charOffset: number | null } | null {
  return pickCurrentParagraph(measureParagraphs(container, scrollRoot))
}

/** Scrolls to a stored (paragraph, charOffset) anchor in one combined
 * motion — computes the exact target scroll position up front rather
 * than chaining a coarse `scrollIntoView` with a separate corrective
 * `scrollBy`, which would fight a `behavior: 'smooth'` animation still
 * in flight. `charOffset` gracefully degrades to paragraph-only
 * automatically whenever the target paragraph has no measurable text
 * (estimateScrollFraction's own zero-length guard) — never a special
 * case here. */
export function scrollToAnchor(
  container: HTMLElement,
  scrollRoot: HTMLElement | null,
  paragraphIndex: number,
  charOffset: number | null,
  behavior: ScrollBehavior = 'auto'
): void {
  const target = container.querySelector<HTMLElement>(`[data-paragraph-index="${paragraphIndex}"]`)
  if (!target) return

  const rect = target.getBoundingClientRect()
  const rootTop = scrollRootTop(scrollRoot)
  const text = target.textContent ?? ''
  const fraction = charOffset !== null ? estimateScrollFraction(charOffset, text.length) : 0
  const delta = fraction * rect.height
  const targetScrollTop = scrollRootScrollTop(scrollRoot) + (rect.top - rootTop) + delta

  if (scrollRoot) {
    scrollRoot.scrollTo({ top: targetScrollTop, behavior })
  } else {
    window.scrollTo({ top: targetScrollTop, behavior })
  }
}
