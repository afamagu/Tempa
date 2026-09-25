'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  consumeIntroduction,
  isForwardSwipe,
  isVisitHandled,
  loadMemberIntroductions,
  markIntroductionPresented,
  markVisitHandled,
  sessionIdFromAccessToken,
  type IntroductionCard,
  type IntroductionConsumeReason,
} from '@/lib/member-introductions'
import { contextQuestionClass, helperTextClass, primaryButtonClass, proseBodyClass, quietLinkClass } from '@/app/profile/ui'
import ProfileIdentityMark from '@/app/profile-identity-mark'

type Supabase = ReturnType<typeof createClient>

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

/**
 * "People to meet" — a floating, forward-only introduction stack shown at
 * most once per visit on ordinary member surfaces (mounted by AppShell,
 * which onboarding, sign-in, admin and compose screens never use).
 *
 * Loaded lazily AFTER the page itself has rendered and failing open: any
 * error simply means nothing appears. Presented = the card became the
 * active card; consumed = advanced past, or Write / View profile.
 */
export default function MemberIntroductions() {
  const [cards, setCards] = useState<IntroductionCard[]>([])
  const [index, setIndex] = useState(0)
  const [open, setOpen] = useState(false)
  const supabaseRef = useRef<Supabase | null>(null)

  useEffect(() => {
    let cancelled = false
    const run = async () => {
      try {
        const supabase = createClient()
        supabaseRef.current = supabase
        const { data } = await supabase.auth.getSession()
        const sessionId = sessionIdFromAccessToken(data.session?.access_token)
        if (!sessionId || cancelled) return
        const storage = sessionStore()
        if (isVisitHandled(storage, sessionId)) return
        const loaded = await loadMemberIntroductions(supabase)
        if (cancelled) return
        // Handled for this visit from the moment a result arrives —
        // refresh / navigation never re-shows it, even mid-stack.
        markVisitHandled(storage, sessionId)
        if (loaded.length > 0) {
          setCards(loaded)
          setIndex(0)
          setOpen(true)
        }
      } catch {
        // Fail open.
      }
    }
    // Never compete with the page's own first render.
    const idle = typeof window.requestIdleCallback === 'function'
    const handle = idle ? window.requestIdleCallback(() => void run(), { timeout: 2000 }) : window.setTimeout(() => void run(), 300)
    return () => {
      cancelled = true
      if (idle) window.cancelIdleCallback(handle)
      else window.clearTimeout(handle)
    }
  }, [])

  if (!open || cards.length === 0) return null
  return (
    <IntroductionDialog
      cards={cards}
      index={index}
      onIndexChange={setIndex}
      onClose={() => setOpen(false)}
      supabase={() => supabaseRef.current ?? createClient()}
    />
  )
}

export function IntroductionDialog({
  cards,
  index,
  onIndexChange,
  onClose,
  supabase,
}: {
  cards: IntroductionCard[]
  index: number
  onIndexChange: (next: number) => void
  onClose: () => void
  supabase: () => Supabase
}) {
  const router = useRouter()
  const pathname = usePathname()
  const panelRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const touchStartRef = useRef<{ x: number; y: number } | null>(null)
  const busyRef = useRef(false)
  const card = cards[index]
  const isLast = index === cards.length - 1

  // Presented: only when a card actually becomes the active card.
  useEffect(() => {
    if (card) void markIntroductionPresented(supabase(), card.candidateId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.candidateId])

  // Each new card starts at its top; focus moves to the new card.
  useEffect(() => {
    scrollRef.current?.scrollTo?.({ top: 0 })
    panelRef.current?.focus()
  }, [index])

  // Modal behaviour: background inert + scroll-locked; focus restored on close.
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null
    const host = panelRef.current?.closest('[data-member-introductions]')
    const siblings = Array.from(document.body.children).filter((el) => el !== host && !el.hasAttribute('inert'))
    siblings.forEach((el) => el.setAttribute('inert', ''))
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      siblings.forEach((el) => el.removeAttribute('inert'))
      document.body.style.overflow = previousOverflow
      previousFocus?.focus?.()
    }
  }, [])

  const advance = useCallback(() => {
    if (!card || busyRef.current) return
    void consumeIntroduction(supabase(), card.candidateId, 'advanced')
    if (isLast) onClose()
    else onIndexChange(index + 1)
  }, [card, index, isLast, onClose, onIndexChange, supabase])

  const leaveTo = useCallback(
    async (reason: Exclude<IntroductionConsumeReason, 'advanced'>, href: string) => {
      if (!card || busyRef.current) return
      busyRef.current = true
      await consumeIntroduction(supabase(), card.candidateId, reason)
      onClose()
      router.push(href)
    },
    [card, onClose, router, supabase]
  )

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose()
      } else if (e.key === 'ArrowRight') {
        e.preventDefault()
        advance()
      }
      // ArrowLeft intentionally does nothing — there is no previous card.
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [advance, onClose])

  if (!card) return null

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0]
    touchStartRef.current = t ? { x: t.clientX, y: t.clientY } : null
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touchStartRef.current
    touchStartRef.current = null
    const t = e.changedTouches[0]
    if (!start || !t) return
    if (isForwardSwipe(t.clientX - start.x, t.clientY - start.y)) advance()
  }

  const titleId = `intro-name-${card.candidateId}`
  const profileHref = `/minds/${card.candidateId}?returnTo=${encodeURIComponent(pathname || '/home')}`
  const writeHref = `/write/${card.candidateId}?a=${card.answerId}`
  const hasCommon = card.sharedLanguages.length > 0 || card.sharedIntents.length > 0

  const dialog = (
    <div data-member-introductions="" className="fixed inset-0 z-[60] flex items-center justify-center p-4 sm:p-8">
      {/* Dim, translucent — Tempa stays visible behind. Not a close target. */}
      <div className="absolute inset-0 bg-foreground/35" aria-hidden="true" />
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        className="relative flex max-h-[82dvh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-foreground/10 bg-background shadow-xl outline-none sm:max-h-[85vh]"
      >
        <header className="flex items-center justify-between gap-3 border-b border-foreground/10 py-2 pl-5 pr-2">
          <p className={helperTextClass} aria-live="polite">
            People to meet · {index + 1} of {cards.length}
          </p>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close introductions"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-2xl leading-none text-foreground transition-colors hover:bg-foreground/[.06]"
          >
            ×
          </button>
        </header>

        {/* Subtle slide/fade per card (keyed remount); none under reduced motion. */}
        <style>{'@keyframes tempa-intro-in{from{opacity:0;transform:translateX(8px)}to{opacity:1;transform:none}}'}</style>
        <div
          key={card.candidateId}
          ref={scrollRef}
          data-testid="introduction-body"
          className="flex-1 overflow-y-auto overscroll-contain px-5 py-5 motion-safe:animate-[tempa-intro-in_200ms_ease-out]"
        >
          <div className="flex items-center gap-4">
            <ProfileIdentityMark
              identifier={card.candidateId}
              markUrl={card.markUrl}
              label={card.markUrl ? `${card.pseudonym}'s Mark` : undefined}
              size="lg"
            />
            <div className="min-w-0">
              <h2 id={titleId} className="truncate font-serif text-xl text-foreground">
                {card.pseudonym}
              </h2>
              {card.identityLine && <p className={helperTextClass}>{card.identityLine}</p>}
              {card.languages.length > 0 && <p className={helperTextClass}>Speaks {card.languages.join(', ')}</p>}
            </div>
          </div>

          {hasCommon && (
            <p className={`mt-4 ${helperTextClass}`} data-testid="introduction-in-common">
              <span className="text-foreground/80">In common:</span>{' '}
              {[...card.sharedLanguages, ...card.sharedIntents].join(' · ')}
            </p>
          )}

          {card.intents.length > 0 && (
            <p className={`mt-2 ${helperTextClass}`}>
              <span className="text-foreground/80">Here for:</span> {card.intents.join(' · ')}
            </p>
          )}

          <div className="mt-6 space-y-3">
            {card.prompt && <p className={contextQuestionClass}>{card.prompt}</p>}
            <div className="rounded-md bg-surface-shell p-4">
              <p className={`whitespace-pre-wrap ${proseBodyClass}`}>{card.body}</p>
            </div>
          </div>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-foreground/10 px-5 py-3">
          <button type="button" onClick={() => void leaveTo('profile', profileHref)} className={quietLinkClass}>
            View {card.pseudonym}&rsquo;s profile
          </button>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={advance}
              aria-label={isLast ? 'Finish introductions' : 'Next person'}
              className="rounded-full px-4 py-2 text-[14px] text-foreground/80 transition-colors hover:bg-foreground/[.06]"
            >
              {isLast ? 'Done' : 'Next →'}
            </button>
            <button type="button" onClick={() => void leaveTo('write', writeHref)} className={primaryButtonClass}>
              Write to {card.pseudonym}
            </button>
          </div>
        </footer>
      </section>
    </div>
  )

  return typeof document === 'undefined' ? null : createPortal(dialog, document.body)
}
