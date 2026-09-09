'use client'

import { useEffect, useRef, useState } from 'react'
import { helperTextClass, secondaryButtonClass } from '@/app/profile/ui'
import {
  clampRevealLine,
  POSTCARD_BACK_PLACEHOLDER,
  type PostcardData,
  type PostcardLivingReveal,
  type PostcardRevealLineAlignment,
} from '@/lib/moments'

/**
 * TEMPA Living Postcards V1, Checkpoint 1 — the reusable Postcard visual
 * object, extracted from app/letters/moment-display.tsx so it can be
 * shared by a historical Moment postcard (type='postcard' rows, still
 * fully supported — see the Build Guide), a future letter-level
 * Postcard, or a preview, without any of them duplicating the approved
 * front/back card, flip, or reduced-motion handling. This checkpoint
 * does NOT change what that card looks like or how it flips — it only
 * moves that existing behavior here unmodified, and adds an entirely
 * OPTIONAL Living Reveal on top of it.
 *
 * A PostcardData with no `living` field renders and behaves EXACTLY
 * like today's static Postcard — every historical/catalog Postcard,
 * including POSTCARD_CATALOG.essaouira, has no `living` data and is
 * therefore untouched by anything below.
 *
 * `hasRevealedBefore` is caller-supplied, per-viewer, in-memory state —
 * there is no database persistence in this checkpoint (a future
 * checkpoint decides how first-reveal state is actually stored). This
 * component only needs to know, at the moment it mounts (i.e. the
 * moment the member deliberately opens the Postcard — see
 * MomentDisplay, which only renders this while its own overlay is
 * open), whether THIS is the first time this viewer has ever seen the
 * Living Reveal:
 * - false/omitted → the Living Reveal plays automatically on open (this
 *   mount IS the deliberate open action; nothing here ever autoplays
 *   merely because a page loaded).
 * - true → the Postcard opens as a plain still object; a discreet
 *   "Replay" control lets the member watch it again, with no cooldown.
 */
export type PostcardObjectProps = {
  postcard: PostcardData
  hasRevealedBefore?: boolean
  /** Postcard editor live UX repair (2026-09-14) — root cause of "the
   * sender cannot type on the back": this component's own "Turn over"
   * flips to a PostcardBack that never received the `editable` prop
   * (PostcardObject had no way to forward one at all), so the writing
   * surface a live sender naturally tries to type into — the one they
   * just flipped to — was always the plain, non-editable read-only
   * rendering. The composer's editor worked around that by drawing a
   * SECOND, separate editable back further down the page, disconnected
   * from the actual flip interaction — confusing, and easy to miss
   * entirely. This prop is the real fix: when given (only by
   * postcard-editor.tsx), it's forwarded to EVERY internal PostcardBack
   * call below (both the reduced-motion branch and the 3D-flip branch),
   * so Turn over reveals the real, writable back directly — one card,
   * one back, one interaction. Omitted by every other caller (delivered
   * reader, Preview, historical Moment display), so their own rendering
   * is completely unaffected — this is purely additive. */
  editableBack?: { value: string; onChange: (value: string) => void; maxLength: number }
  /** Production back-editing UX defect (2026-09-15) — when the sender
   * reopens this editor specifically BECAUSE the back still needs
   * writing (Preview's blocked-Send control or its postcard thumbnail),
   * starting already turned over skips a redundant "Turn over" tap.
   * Read once, at mount, via a lazy useState initializer — never forces
   * the card to flip back if the sender later reopens it for an
   * unrelated reason (e.g. Change postcard), since a fresh mount is
   * required for this to take effect at all. Omitted (defaults to
   * false/front) by every other caller — historical Moment display,
   * the delivered reader, Preview's own read-only view. */
  initialShowingBack?: boolean
}

function usePrefersReducedMotion() {
  // Lazy initializer, not a setState call inside the effect — reads the
  // current value once at mount (guarded for SSR, where window doesn't
  // exist yet). The effect below only ever subscribes to future changes.
  const [reduced, setReduced] = useState(() =>
    typeof window === 'undefined'
      ? false
      : window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    function handleChange(e: MediaQueryListEvent) {
      setReduced(e.matches)
    }
    query.addEventListener('change', handleChange)
    return () => query.removeEventListener('change', handleChange)
  }, [])

  return reduced
}

// A restrained card-with-curved-arrow mark — deliberately not a plain
// refresh icon, so "Turn over" reads as a physical flip, not a reload.
function FlipIcon() {
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
      <rect x="3.5" y="7" width="11" height="14" rx="1.5" />
      <path d="M9 3.5h9a1.5 1.5 0 0 1 1.5 1.5v11" />
      <path d="M17 12.3l3 3.4-3.7.6" />
    </svg>
  )
}

// A plain circular-arrow mark for Replay — deliberately distinct from
// FlipIcon (a physical turn-over) since replaying the Living Reveal is a
// different action from turning the card over.
function ReplayIcon() {
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
      <path d="M4 12a8 8 0 1 1 2.5 5.8" />
      <path d="M4 17v-4h4" />
    </svg>
  )
}

// An extremely restrained hourglass motif — not a countdown, not a
// badge, not gamification. Two triangles and a waist, nothing else.
// Shown only during the FIRST Living Reveal (see isFirstReveal below),
// never on a manual replay and never on a static Postcard.
function HourglassIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.3}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M7 3.5h10M7 20.5h10" />
      <path d="M7.5 3.5c0 4 3 5.5 4.5 6.5c1.5-1 4.5-2.5 4.5-6.5" />
      <path d="M7.5 20.5c0-4 3-5.5 4.5-6.5c1.5 1 4.5 2.5 4.5 6.5" />
    </svg>
  )
}

const REVEAL_LINE_ALIGNMENT_CLASSES: Record<PostcardRevealLineAlignment, string> = {
  'top-left': 'left-2 top-2 items-start text-left',
  'top-center': 'left-1/2 top-2 -translate-x-1/2 items-center text-center',
  'top-right': 'right-2 top-2 items-end text-right',
  center: 'left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 items-center text-center',
  'bottom-left': 'bottom-2 left-2 items-start text-left',
  'bottom-center': 'bottom-2 left-1/2 -translate-x-1/2 items-center text-center',
  'bottom-right': 'bottom-2 right-2 items-end text-right',
}

/**
 * Letter-level Postcards V1 (2026-09-13) — `editable` is the ONLY
 * addition here, and it's entirely optional: every existing caller
 * (historical Moment postcards, the delivered reader, Preview) renders
 * byte-identical output to before, since none of them pass it. When
 * given (only by the composer's own Postcard editor,
 * postcard-editor.tsx), the static message paragraphs are replaced by a
 * borderless textarea styled with the SAME typography classes — the
 * sender writes directly into the real back layout (stamp, postmark,
 * divider all still rendered exactly as always) rather than a separate
 * generic form, satisfying "writing on stationery, not filling in
 * metadata" without needing a pixel-perfect overlay onto the animated
 * flip card (which PostcardObject itself still owns, unmodified).
 */
export function PostcardBack({
  postcard,
  editable,
}: {
  postcard: PostcardData
  editable?: { value: string; onChange: (value: string) => void; maxLength: number }
}) {
  return (
    <div className="grid h-full grid-cols-[1fr_auto_1fr] rounded-sm bg-background p-3">
      {/* Message side */}
      <div className="flex min-w-0 flex-col justify-between pr-3">
        {editable ? (
          <textarea
            value={editable.value}
            onChange={(e) => editable.onChange(e.target.value)}
            maxLength={editable.maxLength}
            placeholder={POSTCARD_BACK_PLACEHOLDER}
            aria-label="Postcard message"
            rows={5}
            className="w-full min-w-0 resize-none border-0 bg-transparent font-serif text-[12px] leading-relaxed text-foreground outline-none placeholder:text-muted sm:text-[13px]"
          />
        ) : (
          <div className="space-y-2">
            {postcard.backMessage.split('\n\n').map((paragraph, i) => (
              <p key={i} className="font-serif text-[12px] leading-relaxed text-foreground sm:text-[13px]">
                {paragraph}
              </p>
            ))}
          </div>
        )}
        {postcard.senderName && (
          <p className="mt-3 text-right font-serif text-[12px] italic text-foreground/80 sm:text-[13px]">
            — {postcard.senderName}
          </p>
        )}
      </div>

      {/* Divider, slightly right of center via the grid's own column split */}
      <div className="w-px bg-foreground/15" />

      {/* Stamp, postmark, address */}
      <div className="flex min-w-0 flex-col pl-3">
        <div className="relative flex h-12 justify-end">
          <div className="h-9 w-7 rounded-[2px] border border-foreground/30" />
          <div className="absolute right-4 top-1 flex h-10 w-10 -rotate-6 flex-col items-center justify-center rounded-full border border-foreground/40 text-center">
            {postcard.postmarkText.split('\n').map((line, i) => (
              <span
                key={i}
                className="text-[5.5px] font-medium uppercase leading-tight tracking-wide text-foreground/70"
              >
                {line}
              </span>
            ))}
          </div>
        </div>

        {(postcard.recipientLabel || postcard.recipientDetail) && (
          <div className="mt-5 space-y-1 text-[11px] sm:text-[12px]">
            {postcard.recipientLabel && (
              <>
                <p className={helperTextClass}>To:</p>
                <p className="font-serif text-foreground">{postcard.recipientLabel}</p>
              </>
            )}
            {postcard.recipientDetail && <p className="text-muted">{postcard.recipientDetail}</p>}
          </div>
        )}

        <div className="mt-auto text-right">
          {postcard.footerText && (
            <p className="text-[9px] italic text-muted">{postcard.footerText}</p>
          )}
          <p className="font-serif text-[10px] italic text-muted">Tempa</p>
        </div>
      </div>
    </div>
  )
}

// The front face's visual stack — poster, the motion asset (only while
// actually revealing), the first-reveal hourglass, and the Reveal Line.
// Declared at module scope (not inside PostcardObject) so it's a stable
// component identity across renders, never recreated on every render of
// its parent — recreating a component type on every render is exactly
// the "Cannot create components during render" mistake this deliberately
// avoids: React would otherwise treat it as a brand-new component every
// time, discarding and remounting it instead of reconciling in place.
function FrontVisual({
  posterSrc,
  alt,
  isRevealing,
  living,
  isFirstReveal,
  revealLineVisible,
  revealLine,
  revealLineAlignment,
  reducedMotion,
  onPlay,
  onEnded,
  onError,
}: {
  posterSrc: string
  alt: string
  isRevealing: boolean
  living: PostcardLivingReveal | null
  isFirstReveal: boolean
  revealLineVisible: boolean
  revealLine: string | undefined
  revealLineAlignment: PostcardRevealLineAlignment
  reducedMotion: boolean
  onPlay: () => void
  onEnded: () => void
  onError: () => void
}) {
  return (
    <div className="relative">
      <img src={posterSrc} alt={alt} className="block max-h-[75vh] w-full rounded-sm object-contain" />

      {/* The motion asset itself is only ever mounted while actually
          revealing — never eagerly rendered/preloaded on a list or
          list-adjacent surface, and `preload="none"` on top of that as
          a conservative hint to the browser. */}
      {isRevealing && living && (
        <video
          className="absolute inset-0 h-full max-h-[75vh] w-full rounded-sm object-contain"
          src={living.motionSrc}
          poster={posterSrc}
          autoPlay
          muted
          playsInline
          preload="none"
          onPlay={onPlay}
          onEnded={onEnded}
          onError={onError}
        />
      )}

      {isRevealing && isFirstReveal && (
        <div
          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-full bg-background/85 text-foreground/70"
          aria-hidden="true"
        >
          <HourglassIcon />
        </div>
      )}

      {/* Mounted whenever a Reveal Line exists at all (never for a plain
          static Postcard, which has no revealLine to begin with) —
          visibility is purely an opacity toggle so it can genuinely fade
          in and out, rather than abruptly appearing/disappearing as it
          would if mounted/unmounted on every visibility change. */}
      {revealLine && (
        <div
          className={`pointer-events-none absolute flex max-w-[85%] flex-col ${REVEAL_LINE_ALIGNMENT_CLASSES[revealLineAlignment]} ${
            reducedMotion ? '' : 'transition-opacity duration-700'
          } ${revealLineVisible ? 'opacity-100' : 'opacity-0'}`}
        >
          <span className="rounded bg-background/85 px-2 py-1 font-serif text-[13px] italic text-foreground">
            {clampRevealLine(revealLine)}
          </span>
        </div>
      )}
    </div>
  )
}

export default function PostcardObject({
  postcard,
  hasRevealedBefore = false,
  editableBack,
  initialShowingBack = false,
}: PostcardObjectProps) {
  const reducedMotion = usePrefersReducedMotion()
  const [showingBack, setShowingBack] = useState(initialShowingBack)
  // A failed motion asset permanently disables Living Reveal for this
  // mount — the Postcard itself is the durable object; motion is an
  // enhancement that must never trap or break it (see handleVideoError).
  const [videoFailed, setVideoFailed] = useState(false)

  // Never played for a reduced-motion viewer at all (see the accessible
  // fallback below) and never played once its own asset has failed.
  const living = postcard.living && !videoFailed && !reducedMotion ? postcard.living : null
  const hasLivingContent = Boolean(postcard.living) && !videoFailed

  // Deliberate-open auto-reveal: this component only ever mounts once
  // the member has actually tapped to open the Postcard (MomentDisplay
  // renders it only inside its own already-open overlay), so computing
  // these as the INITIAL state (lazy useState initializers, evaluated
  // exactly once, synchronously, during that same mount) is triggered by
  // that same deliberate open action — never a separate effect firing
  // afterward, and never merely because a page loaded. A reduced-motion
  // viewer never gets the video, but must still see the Reveal Line (if
  // any) as ordinary sender content — shown immediately, with no fade,
  // since a forced transition would itself be motion this viewer's OS
  // preference asked to avoid.
  const [isRevealing, setIsRevealing] = useState(() => Boolean(living) && !hasRevealedBefore)
  const [isFirstReveal, setIsFirstReveal] = useState(!hasRevealedBefore)
  const [revealLineVisible, setRevealLineVisible] = useState(
    () => reducedMotion && !hasRevealedBefore && Boolean(postcard.living?.revealLine)
  )
  const revealTimeoutsRef = useRef<number[]>([])

  function clearScheduledRevealLine() {
    revealTimeoutsRef.current.forEach((id) => window.clearTimeout(id))
    revealTimeoutsRef.current = []
  }

  // Cleanup only — never sets state itself, only clears pending timers on
  // unmount, so this never causes the cascading-render pattern the
  // set-state-in-effect check exists for.
  useEffect(() => {
    return () => clearScheduledRevealLine()
  }, [])

  function scheduleRevealLine(durationSeconds: number) {
    if (!postcard.living?.revealLine) return
    clearScheduledRevealLine()
    // Approximately the latter half of playback, fading out again
    // before the end — informational duration metadata only; the
    // video's own real `ended` event (handleEnded) is what actually
    // returns the card to its resting state, never this timer.
    const showAtMs = Math.max(durationSeconds * 0.55, 1) * 1000
    const hideAtMs = showAtMs + Math.max(durationSeconds * 0.35, 1.5) * 1000
    revealTimeoutsRef.current.push(
      window.setTimeout(() => setRevealLineVisible(true), showAtMs),
      window.setTimeout(() => setRevealLineVisible(false), hideAtMs)
    )
  }

  function handlePlay() {
    if (postcard.living) scheduleRevealLine(postcard.living.durationSeconds ?? 8)
  }

  function handleEnded() {
    clearScheduledRevealLine()
    setIsRevealing(false)
    setIsFirstReveal(false)
    setRevealLineVisible(false)
  }

  // A failed motion asset must never break the Postcard — fall back to
  // the still front permanently for this mount; flip keeps working
  // normally, the back stays fully readable, and nothing here surfaces
  // a raw browser video error or a trapped/broken state.
  function handleVideoError() {
    clearScheduledRevealLine()
    setVideoFailed(true)
    setIsRevealing(false)
    setRevealLineVisible(false)
  }

  // Discreet, deliberately not shown for reduced-motion (there is no
  // video to replay for that viewer) or while already revealing. No
  // cooldown of any kind — see the checkpoint's own locked rule.
  function handleReplay() {
    if (!hasLivingContent || reducedMotion || isRevealing) return
    setIsFirstReveal(false)
    setRevealLineVisible(false)
    setIsRevealing(true)
  }

  const posterSrc = postcard.living?.posterSrc ?? postcard.frontImagePath
  const revealLineAlignment = postcard.living?.revealLineAlignment ?? 'bottom-center'

  const frontVisual = (
    <FrontVisual
      posterSrc={posterSrc}
      alt={`${postcard.title} postcard`}
      isRevealing={isRevealing}
      living={living}
      isFirstReveal={isFirstReveal}
      revealLineVisible={revealLineVisible}
      revealLine={postcard.living?.revealLine}
      revealLineAlignment={revealLineAlignment}
      reducedMotion={reducedMotion}
      onPlay={handlePlay}
      onEnded={handleEnded}
      onError={handleVideoError}
    />
  )

  return (
    <div className="rounded-md border border-foreground/15 bg-background p-3">
      <span className="sr-only" aria-live="polite">
        {showingBack ? 'Back of postcard' : 'Front of postcard'}
      </span>

      {reducedMotion ? (
        showingBack ? (
          <PostcardBack postcard={postcard} editable={editableBack} />
        ) : (
          frontVisual
        )
      ) : (
        <div className="postcard-perspective">
          <div className="postcard-inner" data-flipped={showingBack}>
            <div className="postcard-face">{frontVisual}</div>
            <div className="postcard-face postcard-face-back">
              <PostcardBack postcard={postcard} editable={editableBack} />
            </div>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          onClick={() => setShowingBack((v) => !v)}
          aria-pressed={showingBack}
          aria-label={showingBack ? 'Turn over to see the front' : 'Turn over to see the back'}
          className={`inline-flex items-center gap-2 ${secondaryButtonClass}`}
        >
          <FlipIcon />
          Turn over
        </button>

        {hasLivingContent && !reducedMotion && !isRevealing && (
          <button
            type="button"
            onClick={handleReplay}
            aria-label="Play the Living Reveal again"
            className={`inline-flex items-center gap-2 ${secondaryButtonClass}`}
          >
            <ReplayIcon />
            Replay
          </button>
        )}
      </div>
    </div>
  )
}
