import { describe, it, expect, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import PostcardObject, { PostcardBack } from './postcard-object'
import {
  POSTCARD_CATALOG,
  POSTCARD_BACK_PLACEHOLDER,
  resolveLetterPostcardDisplay,
  type PostcardData,
  type PostcardBaseContent,
} from '@/lib/moments'

// TEMPA Living Postcards V1, Checkpoint 1 — PostcardObject is the
// reusable card extracted from moment-display.tsx. Same testing
// convention as the rest of this codebase: renderToStaticMarkup for
// whatever the INITIAL render actually shows (no jsdom, so effects never
// run — meaning the Living Reveal's own auto-trigger, which only fires
// inside a mount effect, is never observable this way), and direct
// source-text inspection for the wiring that only ever matters once an
// effect/event fires (video attributes, the failure-fallback handler,
// the hourglass's exact gating condition, the replay control's absence
// of any cooldown). This mirrors exactly how earlier checkpoints in this
// engagement verified equivalent effect-driven behavior (e.g.
// block-button.test.tsx's "choosing" panel, moments-walkthrough.test.tsx's
// screens 1-5).
const SOURCE_PATH = path.join(__dirname, 'postcard-object.tsx')
const source = readFileSync(SOURCE_PATH, 'utf8')

// As of Checkpoint 2, POSTCARD_CATALOG.essaouira is the canonical Living
// Postcard — it genuinely carries real `living` data now (see
// lib/moments.ts). Tests that specifically need a postcard with NO living
// data at all (proving the architecture for a plain static/historical
// Postcard, independent of whatever the real catalog happens to contain)
// use STATIC_ESSAOUIRA instead; tests about the real canonical asset use
// ESSAOUIRA directly.
const ESSAOUIRA = POSTCARD_CATALOG.essaouira
const STATIC_ESSAOUIRA: PostcardData = { ...ESSAOUIRA, living: undefined }

function livingPostcard(overrides: Partial<NonNullable<PostcardData['living']>> = {}): PostcardData {
  return {
    ...STATIC_ESSAOUIRA,
    living: {
      motionSrc: '/postcards/living/essaouira-motion.mp4',
      revealLine: 'Keep a little sea with you.',
      ...overrides,
    },
  }
}

// A. Existing static Postcard rendering still works — no `living` data
// at all (a plain historical/catalog Postcard with no Living Reveal).
describe('PostcardObject — A. existing static Postcard rendering unchanged', () => {
  it('renders the front image and the Turn over control', () => {
    const html = renderToStaticMarkup(<PostcardObject postcard={STATIC_ESSAOUIRA} />)
    expect(html).toContain(STATIC_ESSAOUIRA.frontImagePath)
    expect(html).toContain('Turn over')
    expect(html).toMatch(/aria-label="Turn over to see the back"/)
  })

  it('still renders both faces (front visible, back CSS-hidden via the 3D flip) exactly as before extraction', () => {
    const html = renderToStaticMarkup(<PostcardObject postcard={STATIC_ESSAOUIRA} />)
    expect(html).toContain('postcard-perspective')
    expect(html).toContain('postcard-inner')
    expect(html).toContain('data-flipped="false"')
  })
})

// K. Existing front/back/flip content remains represented and protected.
describe('PostcardObject — K. back content (message, sender, postmark) still renders', () => {
  it('renders the exact backMessage paragraphs, sender name, and postmark text', () => {
    const html = renderToStaticMarkup(<PostcardObject postcard={STATIC_ESSAOUIRA} />)
    expect(html).toContain('I took the long way to get bread this morning.')
    expect(html).toContain('— Youssef')
    expect(html).toContain('ESSAOUIRA')
  })

  it('the flip control announces the current face via an aria-live region', () => {
    const html = renderToStaticMarkup(<PostcardObject postcard={STATIC_ESSAOUIRA} />)
    expect(html).toMatch(/aria-live="polite"[^>]*>\s*Front of postcard/)
  })

  it('this back content is identical on the REAL canonical (now-living) Essaouira entry too — Checkpoint 2 did not change it', () => {
    const html = renderToStaticMarkup(<PostcardObject postcard={ESSAOUIRA} hasRevealedBefore />)
    expect(html).toContain('I took the long way to get bread this morning.')
    expect(html).toContain('— Youssef')
    expect(html).toContain('ESSAOUIRA')
  })

  // Post-onboarding corrections checkpoint (Section L) — a live smoke
  // test found the back message text very small. Audited against
  // profile/ui.ts's own documented type scale: text-[12px]/text-[13px]
  // sat BELOW even that scale's smallest ("metadata only," 13–14px)
  // tier despite being genuine reading content. Bumped one conservative
  // step to text-[13px]/text-[14px] — enough to clear that floor
  // without risking overflow in the narrow message column.
  it('the back message text is at least 13px/14px (profile/ui.ts\'s documented "metadata" floor), never the old sub-floor 12px/13px', () => {
    const html = renderToStaticMarkup(<PostcardObject postcard={STATIC_ESSAOUIRA} />)
    // Scoped to the message paragraph itself — the card's unrelated
    // address block legitimately uses its own separate text-[12px] a
    // few lines later, so a blanket "never 12px anywhere" check would
    // be a false positive against that unrelated element.
    expect(html).toMatch(
      /font-serif text-\[13px\] leading-relaxed text-foreground sm:text-\[14px\]">I took the long way/
    )
  })

  it('the same size applies to the editable back (composer) and the sender signature line, not just the static read view', () => {
    const editableHtml = renderToStaticMarkup(
      <PostcardObject
        postcard={STATIC_ESSAOUIRA}
        editableBack={{ value: 'A short note.', onChange: () => {}, maxLength: 200 }}
      />
    )
    expect(editableHtml).toContain('text-[13px]')
    expect(editableHtml).toContain('sm:text-[14px]')
  })
})

// B. Historical MomentDisplay type='postcard' delegates to PostcardObject
// rather than duplicating it.
describe('MomentDisplay — B. delegates its postcard branch to PostcardObject', () => {
  it('imports and renders PostcardObject, and no longer defines its own PostcardBack/flip markup', () => {
    const momentDisplaySource = readFileSync(path.join(__dirname, 'moment-display.tsx'), 'utf8')
    expect(momentDisplaySource).toContain("import PostcardObject from './postcard-object'")
    expect(momentDisplaySource).toContain('<PostcardObject postcard={props.postcard}')
    expect(momentDisplaySource).not.toContain('postcard-perspective')
    expect(momentDisplaySource).not.toContain('function PostcardBack')
  })

  // H/I — Postcard back copy + recipient cleanup (2026-09-14): a
  // historical Moment postcard is resolved by MomentDisplay's own caller
  // straight from POSTCARD_CATALOG[postcardKey] (see letter-body.tsx),
  // never through resolveLetterPostcardDisplay — the ONE explicit
  // boundary between the legacy and new resolution paths lives entirely
  // in that resolver, never scattered here. This structurally guarantees
  // a historical Moment postcard keeps receiving its ORIGINAL catalog
  // backMessage/recipientLabel/recipientDetail exactly as before —
  // proven by MomentDisplay never even importing the new resolver.
  it('H/I. never imports resolveLetterPostcardDisplay — historical rendering stays on the direct POSTCARD_CATALOG path, unaffected by the new suppression/placeholder rules', () => {
    const momentDisplaySource = readFileSync(path.join(__dirname, 'moment-display.tsx'), 'utf8')
    expect(momentDisplaySource).not.toContain('resolveLetterPostcardDisplay')
  })

  it('H/I. postcard-moment-node.tsx (the historical inline node) also never imports resolveLetterPostcardDisplay', () => {
    const postcardMomentNodeSource = readFileSync(
      path.join(__dirname, '[letterId]', 'postcard-moment-node.tsx'),
      'utf8'
    )
    expect(postcardMomentNodeSource).not.toContain('resolveLetterPostcardDisplay')
    expect(postcardMomentNodeSource).toContain('POSTCARD_CATALOG[postcardKey]')
  })
})

// C. Static Postcard has no video/reveal machinery visible when no
// motion asset exists — the exact "behaves exactly like today" rule.
describe('PostcardObject — C. no Living Reveal machinery for a static Postcard', () => {
  it('renders no <video>, no hourglass, no Reveal Line, and no Replay control', () => {
    const html = renderToStaticMarkup(<PostcardObject postcard={STATIC_ESSAOUIRA} />)
    expect(html).not.toContain('<video')
    expect(html).not.toContain('Replay')
    expect(html).not.toMatch(/aria-label="Play the Living Reveal again"/)
  })

  it('the REAL canonical Essaouira Postcard, opened as a later ordinary open, also shows no video/hourglass — only Replay is available', () => {
    const html = renderToStaticMarkup(<PostcardObject postcard={ESSAOUIRA} hasRevealedBefore />)
    expect(html).not.toContain('<video')
    expect(html).toContain('Replay')
  })
})

// D. Living Postcard supports poster + motion path + Reveal Line.
describe('PostcardObject — D. Living Reveal data is supported end to end', () => {
  it('uses living.posterSrc in place of frontImagePath when supplied', () => {
    const html = renderToStaticMarkup(
      <PostcardObject postcard={livingPostcard({ posterSrc: '/postcards/living/essaouira-poster.jpg' })} />
    )
    expect(html).toContain('/postcards/living/essaouira-poster.jpg')
  })

  it('falls back to frontImagePath as the poster when posterSrc is omitted', () => {
    const html = renderToStaticMarkup(<PostcardObject postcard={livingPostcard()} />)
    expect(html).toContain(ESSAOUIRA.frontImagePath)
  })

  it('the source wires living.motionSrc onto the <video> element', () => {
    expect(source).toMatch(/<video[\s\S]*?src=\{living\.motionSrc\}/)
  })

  it('the source renders the clamped Reveal Line text, never the raw unclamped value', () => {
    expect(source).toContain('{clampRevealLine(revealLine)}')
  })

  it('supports a typed alignment option for the Reveal Line, defaulting sensibly', () => {
    expect(source).toContain("postcard.living?.revealLineAlignment ?? 'bottom-center'")
    // 'center' is a valid bare object-key identifier (no hyphen), so it
    // appears unquoted in source; every other alignment contains a
    // hyphen and must be quoted.
    expect(source).toMatch(/\bcenter:/)
    for (const alignment of [
      'top-left',
      'top-center',
      'top-right',
      'bottom-left',
      'bottom-center',
      'bottom-right',
    ]) {
      expect(source).toContain(`'${alignment}'`)
    }
  })
})

// E. Video is muted, playsInline, non-looping, with no native controls.
describe('PostcardObject — E. video element rules', () => {
  const videoTagMatch = source.match(/<video[\s\S]*?\/>/)
  const videoTag = videoTagMatch?.[0] ?? ''

  it('the <video> tag is found in source', () => {
    expect(videoTag).not.toBe('')
  })

  it('is muted, playsInline, and has no native controls attribute', () => {
    expect(videoTag).toContain('muted')
    expect(videoTag).toContain('playsInline')
    expect(videoTag).not.toMatch(/\bcontrols\b/)
  })

  it('never loops', () => {
    expect(videoTag).not.toMatch(/\bloop\b/)
  })

  it('autoplays only because the component itself gates its own mounting on isRevealing (never eagerly rendered)', () => {
    expect(videoTag).toContain('autoPlay')
    // The <video> element is conditionally rendered by the FrontVisual
    // helper — never unconditionally present — so it can't be fetched
    // before a reveal is actually happening.
    expect(source).toMatch(/\{isRevealing && living && \(/)
  })

  it('uses preload="none" as a conservative loading hint', () => {
    expect(videoTag).toContain('preload="none"')
  })
})

// G. Failed motion gracefully falls back to still.
describe('PostcardObject — G. failure fallback', () => {
  it('has an onError handler that disables Living Reveal for this mount without throwing or trapping state', () => {
    expect(source).toContain('onError={handleVideoError}')
    const handlerStart = source.indexOf('function handleVideoError')
    const handlerEnd = source.indexOf('function handleReplay')
    const handlerBody = source.slice(handlerStart, handlerEnd)
    expect(handlerBody).toContain('setVideoFailed(true)')
    expect(handlerBody).toContain('setIsRevealing(false)')
  })

  it('the `living` value used everywhere else is null once videoFailed is true, so the video is never rendered again', () => {
    expect(source).toContain('postcard.living && !videoFailed && !reducedMotion ? postcard.living : null')
  })

  it('flip and back content are structurally independent of videoFailed — the postcard-perspective/back branch never checks it', () => {
    const flipBlockStart = source.indexOf('{reducedMotion ? (')
    const flipBlockEnd = source.indexOf('<div className="mt-3 flex flex-wrap')
    const flipBlock = source.slice(flipBlockStart, flipBlockEnd)
    expect(flipBlock).not.toContain('videoFailed')
  })
})

// H. Reduced-motion path retains sender text/content — verified by
// actually forcing usePrefersReducedMotion's lazy useState initializer
// to read `true`, which (unlike an effect) genuinely runs during a
// single renderToStaticMarkup pass.
describe('PostcardObject — H. reduced motion still renders full sender content', () => {
  afterEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    delete (globalThis as any).window
  })

  it('never renders the animated 3D flip container, but still renders full front content and the flip control', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(globalThis as any).window = {
      matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    }
    const html = renderToStaticMarkup(<PostcardObject postcard={livingPostcard()} />)
    expect(html).not.toContain('postcard-perspective')
    expect(html).toContain(ESSAOUIRA.frontImagePath)
    expect(html).toContain('Turn over')
  })

  it('the reduced-motion Reveal Line path is computed as initial state (no timer), true precisely when reducedMotion, first-open, and a revealLine all hold', () => {
    // Computed synchronously as the component mounts (a lazy useState
    // initializer, not an effect+setTimeout) — this is what lets a
    // reduced-motion viewer see it immediately, with no fade-in delay.
    expect(source).toContain(
      'useState(\n    () => reducedMotion && !hasRevealedBefore && Boolean(postcard.living?.revealLine)\n  )'
    )
  })
})

// I. Replay is possible without a time cooldown.
describe('PostcardObject — I. replay has no cooldown', () => {
  it('handleReplay contains no cooldown/timestamp/date gating', () => {
    const start = source.indexOf('function handleReplay')
    const end = source.indexOf('const posterSrc')
    const body = source.slice(start, end)
    expect(body.toLowerCase()).not.toContain('cooldown')
    expect(body).not.toContain('Date.now')
    expect(body).not.toContain('setTimeout')
  })

  it('the Replay control is only gated on living content existing, motion being enabled, and not already revealing — nothing time-based', () => {
    expect(source).toContain('{hasLivingContent && !reducedMotion && !isRevealing && (')
  })
})

// J. Hourglass/reveal indicator is first-reveal-only and is not a
// countdown.
describe('PostcardObject — J. hourglass is first-reveal-only, not a countdown', () => {
  it('is gated on isFirstReveal in addition to isRevealing — never shown on a replay', () => {
    expect(source).toContain('{isRevealing && isFirstReveal && (')
  })

  it('the hourglass SVG contains no numbers/text nodes — a motif, not a countdown', () => {
    const start = source.indexOf('function HourglassIcon')
    const end = source.indexOf('const REVEAL_LINE_ALIGNMENT_CLASSES')
    const body = source.slice(start, end)
    expect(body).not.toMatch(/<text/)
    expect(body).not.toMatch(/\d+(?:\.\d+)?s\b/) // no seconds-remaining style content
  })

  it('disappears once the reveal completes (tied to isRevealing, which handleEnded sets false)', () => {
    const handledEndStart = source.indexOf('function handleEnded')
    const handledEndEnd = source.indexOf('function handleVideoError')
    const body = source.slice(handledEndStart, handledEndEnd)
    expect(body).toContain('setIsRevealing(false)')
  })
})

// L is protected by the full suite (letter-body.test.tsx, moments.test.ts,
// photo-consent*.test.tsx, etc.) continuing to pass unchanged — see the
// checkpoint report rather than duplicating those tests here.

// ============================================================
// TEMPA LIVING POSTCARDS V1, CHECKPOINT 2 — the canonical, real (not
// test-fixture) Essaouira motion asset, live-wired via
// POSTCARD_CATALOG.essaouira. The generic engine tests above (using a
// synthetic livingPostcard() fixture) already cover the mechanism in the
// abstract; these specifically prove the REAL production data flows
// through it correctly, and add the checkpoint's new explicit
// requirements (no video-player chrome of any kind, no play icon).
// ============================================================

// C/D. No video-player chrome whatsoever, on the real asset.
describe('PostcardObject — Checkpoint 2: no video-player chrome on the real Essaouira Living Postcard', () => {
  const videoTagMatch = source.match(/<video[\s\S]*?\/>/)
  const videoTag = videoTagMatch?.[0] ?? ''

  it('exposes no native controls, and the resting front is a plain <img> — no player UI wraps it', () => {
    expect(videoTag).not.toMatch(/\bcontrols\b/)
    // The always-present poster is a plain <img>, not a <video> — the
    // resting state is visually indistinguishable from an ordinary
    // still Postcard whether or not living data exists.
    expect(source).toMatch(/<img src=\{posterSrc\}/)
  })

  it('defines no play-icon/play-triangle component anywhere in the file', () => {
    // Word-boundary matches, deliberately — a plain substring check for
    // "playicon" would false-positive against "ReplayIcon" (Checkpoint
    // 1's Replay control icon, a circular-arrow mark, not a play button).
    expect(source).not.toMatch(/\bPlayIcon\b/)
    expect(source.toLowerCase()).not.toContain('play-icon')
    expect(source.toLowerCase()).not.toContain('play triangle')
    expect(source).not.toContain('polygon points') // the classic play-triangle SVG shape
  })

  it('the real Essaouira Postcard, on a first open, renders no play icon of any kind alongside its structural reveal state', () => {
    const html = renderToStaticMarkup(<PostcardObject postcard={ESSAOUIRA} />)
    expect(html).not.toMatch(/aria-label="Play"/i)
    expect(html).not.toContain('▶')
  })
})

// E/F/G. One deliberate open is sufficient — autoPlay, muted, playsInline,
// no loop — confirmed specifically against the real canonical asset.
describe('PostcardObject — Checkpoint 2: first-reveal playback is autoPlay + muted + playsInline + non-looping for the real asset', () => {
  it('POSTCARD_CATALOG.essaouira has no hasRevealedBefore-independent second trigger — mounting alone (the deliberate open) is what starts it', () => {
    // isRevealing's initial state is a lazy useState initializer keyed
    // only on `living`/`hasRevealedBefore` — no click handler, no second
    // "play" affordance exists to separately start playback.
    expect(source).toContain('useState(() => Boolean(living) && !hasRevealedBefore)')
  })

  it('the <video> wired to living.motionSrc carries autoPlay, muted, and playsInline together, with no loop and no controls', () => {
    const videoTagMatch = source.match(/<video[\s\S]*?\/>/)
    const videoTag = videoTagMatch?.[0] ?? ''
    expect(videoTag).toContain('autoPlay')
    expect(videoTag).toContain('muted')
    expect(videoTag).toContain('playsInline')
    expect(videoTag).not.toMatch(/\bloop\b/)
    expect(videoTag).not.toMatch(/\bcontrols\b/)
  })
})

// H. Real media `ended` (not a duration-based timer) returns the real
// Essaouira Postcard to its still state.
describe('PostcardObject — Checkpoint 2: playback completion is driven by the real ended event', () => {
  it('handleEnded (wired to the <video> onEnded prop) is what clears isRevealing — never a durationSeconds-based timeout', () => {
    expect(source).toContain('onEnded={handleEnded}')
    const start = source.indexOf('function handleEnded')
    const end = source.indexOf('function handleVideoError')
    const body = source.slice(start, end)
    expect(body).toContain('setIsRevealing(false)')
    expect(body).not.toContain('setTimeout')
    expect(body).not.toContain('durationSeconds')
  })

  it("durationSeconds only ever schedules the Reveal Line's own fade timing, never a playback cutoff", () => {
    const start = source.indexOf('function scheduleRevealLine')
    const end = source.indexOf('function handlePlay')
    const body = source.slice(start, end)
    expect(body).not.toContain('setIsRevealing')
    expect(body).not.toContain('pause()')
  })

  it("Essaouira's own durationSeconds reflects the real ~10s asset, used only as scheduling metadata via handlePlay's fallback expression", () => {
    expect(source).toContain('scheduleRevealLine(postcard.living.durationSeconds ?? 8)')
    expect(ESSAOUIRA.living?.durationSeconds).toBeCloseTo(10.04, 1)
  })
})

// I/J. Replay of the real asset: no cooldown, no hourglass.
describe('PostcardObject — Checkpoint 2: replay of the real Essaouira Postcard', () => {
  it('a later-open (hasRevealedBefore) real Essaouira Postcard offers Replay with no cooldown gating', () => {
    const html = renderToStaticMarkup(<PostcardObject postcard={ESSAOUIRA} hasRevealedBefore />)
    expect(html).toContain('Replay')
    expect(html).toMatch(/aria-label="Play the Living Reveal again"/)
  })

  it('handleReplay never sets isFirstReveal back to true — a replay is structurally never treated as the first reveal, so the hourglass cannot appear', () => {
    const start = source.indexOf('function handleReplay')
    const end = source.indexOf('const posterSrc')
    const body = source.slice(start, end)
    expect(body).toContain('setIsFirstReveal(false)')
    expect(body).not.toContain('setIsFirstReveal(true)')
  })
})

// B. Historical/no-living static Postcards remain unaffected — confirmed
// again here explicitly in the Checkpoint 2 context, since this
// checkpoint is the first time real `living` data exists in production
// catalog data at all.
describe('PostcardObject — Checkpoint 2: static Postcards elsewhere in a future catalog remain unaffected', () => {
  it('a PostcardData with no living field at all still short-circuits every Living Reveal code path', () => {
    expect(STATIC_ESSAOUIRA.living).toBeUndefined()
    const html = renderToStaticMarkup(<PostcardObject postcard={STATIC_ESSAOUIRA} />)
    expect(html).not.toContain('<video')
  })
})

// ============================================================
// TEMPA LIVING POSTCARDS V1 — SECOND CANONICAL CARD (Bangkok)
// Proves the SAME reusable engine — no Bangkok-only component, no
// special-cased rendering — supports a second real Living Postcard.
// ============================================================

const BANGKOK = POSTCARD_CATALOG.bangkokAfterRain

// G. Bangkok uses the generic PostcardObject/PostcardBack path.
describe('PostcardObject — Bangkok reuses the exact same generic engine as Essaouira', () => {
  it('renders through the same PostcardObject component with no Bangkok-specific branch anywhere in the source', () => {
    expect(source.toLowerCase()).not.toContain('bangkok')
  })

  it('produces the same structural markup (front image, flip container, Turn over, back content) for Bangkok as for Essaouira', () => {
    const html = renderToStaticMarkup(<PostcardObject postcard={BANGKOK} hasRevealedBefore />)
    expect(html).toContain(BANGKOK.frontImagePath)
    expect(html).toContain('postcard-perspective')
    expect(html).toContain('postcard-inner')
    expect(html).toContain('Turn over')
    expect(html).toMatch(/aria-label="Turn over to see the back"/)
  })
})

// K. Both cards retain front/back/Turn-over capability.
describe('PostcardObject — Bangkok front/back/flip content', () => {
  it('renders its own back content (backMessage, postmark) — no fake sender name rendered, since none was authored', () => {
    const html = renderToStaticMarkup(<PostcardObject postcard={BANGKOK} hasRevealedBefore />)
    expect(html).toContain('A quiet moment after the rain, somewhere in Bangkok.')
    expect(html).toContain('BANGKOK')
    // PostcardBack's sender-name paragraph is conditional on
    // postcard.senderName — Bangkok has none, so no "— <name>" line
    // should render at all (unlike Essaouira's "— Youssef").
    expect(html).not.toMatch(/—\s*\w+<\/p>/)
  })

  it('the flip control announces the current face for Bangkok exactly as it does for Essaouira', () => {
    const html = renderToStaticMarkup(<PostcardObject postcard={BANGKOK} hasRevealedBefore />)
    expect(html).toMatch(/aria-live="polite"[^>]*>\s*Front of postcard/)
  })
})

// L/M. Bangkok Living Reveal is silent and exposes no video-player chrome
// or play-triangle UI, structurally identical to Essaouira's rules.
describe('PostcardObject — Bangkok Living Reveal is silent, chrome-free (same rules as Essaouira)', () => {
  it('Bangkok has real living data wired (motionSrc + duration), confirming this checkpoint\'s data actually reaches the component', () => {
    expect(BANGKOK.living?.motionSrc).toBe('/postcards/bangkok-after-rain-living.mp4')
    expect(BANGKOK.living?.durationSeconds).toBe(10.04)
  })

  it('the single shared <video> element definition (used for every card, Bangkok included) is muted, playsInline, non-looping, and has no controls', () => {
    const videoTagMatch = source.match(/<video[\s\S]*?\/>/)
    const videoTag = videoTagMatch?.[0] ?? ''
    expect(videoTag).toContain('muted')
    expect(videoTag).toContain('playsInline')
    expect(videoTag).not.toMatch(/\bloop\b/)
    expect(videoTag).not.toMatch(/\bcontrols\b/)
  })

  it('no play-triangle/video-player UI exists for any card, Bangkok included — there is only ever one, shared, chrome-free implementation', () => {
    expect(source).not.toMatch(/\bPlayIcon\b/)
    expect(source).not.toContain('polygon points')
    const html = renderToStaticMarkup(<PostcardObject postcard={BANGKOK} />)
    expect(html).not.toMatch(/aria-label="Play"/i)
    expect(html).not.toContain('▶')
  })

  it('a first open of Bangkok is structurally identical to a first open of Essaouira — same isRevealing/hourglass gating, no Bangkok-only trigger', () => {
    const bangkokHtml = renderToStaticMarkup(<PostcardObject postcard={BANGKOK} />)
    const essaouiraHtml = renderToStaticMarkup(<PostcardObject postcard={ESSAOUIRA} />)
    // Both first-open renders should surface the same hourglass wrapper
    // markup (aria-hidden, no digits/text) — proving one shared gate.
    const hourglassPattern = /aria-hidden="true">\s*<svg viewBox="0 0 24 24"/
    expect(bangkokHtml).toMatch(hourglassPattern)
    expect(essaouiraHtml).toMatch(hourglassPattern)
  })
})

// Letter-Level Postcards V1 (2026-09-13) — PostcardBack now exports an
// OPTIONAL `editable` prop for the composer's own Postcard editor
// (postcard-editor.tsx). Every existing call site (including every test
// above) never passes it, so the static-message rendering must remain
// byte-identical — proven by the untouched suites above continuing to
// pass, plus the explicit negative check here.
describe('PostcardBack — editable prop (Letter-Level Postcards V1)', () => {
  it('is now exported directly, for reuse outside PostcardObject', () => {
    expect(PostcardBack).toBeTypeOf('function')
  })

  it('without `editable`, renders the static message paragraphs exactly as before — no textarea', () => {
    const html = renderToStaticMarkup(<PostcardBack postcard={STATIC_ESSAOUIRA} />)
    expect(html).toContain('I took the long way to get bread this morning.')
    expect(html).not.toContain('<textarea')
  })

  it('with `editable`, renders a textarea bound to the given value/maxLength instead of static paragraphs', () => {
    const html = renderToStaticMarkup(
      <PostcardBack
        postcard={STATIC_ESSAOUIRA}
        editable={{ value: 'A message in progress', onChange: () => {}, maxLength: 200 }}
      />
    )
    expect(html).toContain('<textarea')
    expect(html).toContain('A message in progress')
    expect(html).toContain('maxLength="200"')
    expect(html).not.toContain('I took the long way to get bread this morning.')
  })

  it('the editable textarea still sits inside the exact same back layout — stamp, postmark, and divider all still render', () => {
    const html = renderToStaticMarkup(
      <PostcardBack
        postcard={STATIC_ESSAOUIRA}
        editable={{ value: '', onChange: () => {}, maxLength: 200 }}
      />
    )
    expect(html).toContain('ESSAOUIRA')
    expect(html).toContain('Tempa')
  })
})

// Postcard editor live UX repair (2026-09-14) — the actual root cause of
// "the sender cannot type on the back": PostcardObject's own internal
// "Turn over" flipped to a PostcardBack that never received `editable`
// at all (PostcardObject had no way to forward one), so the back a live
// sender naturally tried to type into was always the plain, read-only
// rendering. `editableBack` is the fix — forwarded to BOTH internal
// PostcardBack call sites (reduced-motion branch and the 3D-flip
// branch), so Turn over on the SAME card now reveals the real, writable
// surface. Every existing caller above never passes it, so their own
// rendering is provably unaffected (J/K) — proven by every test above
// this block continuing to pass unchanged.
describe('PostcardObject — editableBack (live UX repair, 2026-09-14)', () => {
  it('A/B/C/D. Turn over reveals a real, writable textarea carrying the current value, capped at the given maxLength', () => {
    const html = renderToStaticMarkup(
      <PostcardObject
        postcard={STATIC_ESSAOUIRA}
        editableBack={{ value: 'Made it here at last.', onChange: () => {}, maxLength: 200 }}
      />
    )
    expect(html).toContain('<textarea')
    expect(html).toContain('Made it here at last.')
    expect(html).toContain('maxLength="200"')
    expect(html).toContain('aria-label="Postcard message"')
    // The static, non-editable back content is genuinely gone once
    // editableBack is supplied — never rendered alongside the textarea.
    expect(html).not.toContain('I took the long way to get bread this morning.')
  })

  it('E. the writable textarea sits inside the real flip container, not covered by any pointer-events-blocking wrapper', () => {
    const html = renderToStaticMarkup(
      <PostcardObject
        postcard={STATIC_ESSAOUIRA}
        editableBack={{ value: '', onChange: () => {}, maxLength: 200 }}
      />
    )
    // Structurally: the textarea is a descendant of postcard-face-back
    // (the actual flip-revealed face), and nothing in this component
    // ever sets pointer-events-none or disabled on the textarea or any
    // ancestor of it.
    expect(html).toMatch(/postcard-face postcard-face-back"[\s\S]*<textarea/)
    expect(html).not.toContain('pointer-events-none')
    expect(html).not.toMatch(/<textarea[^>]*disabled/)
  })

  it('the restrained placeholder invites writing, never a generic form label — via the ONE shared constant, never a duplicated literal', () => {
    const html = renderToStaticMarkup(
      <PostcardObject
        postcard={STATIC_ESSAOUIRA}
        editableBack={{ value: '', onChange: () => {}, maxLength: 200 }}
      />
    )
    expect(html).toContain(`placeholder="${POSTCARD_BACK_PLACEHOLDER}"`)
    expect(html).not.toMatch(/Message:\s*<input/i)
  })

  it('the placeholder is never injected into the textarea\'s own value — a blank draft renders a genuinely empty textarea', () => {
    const html = renderToStaticMarkup(
      <PostcardObject
        postcard={STATIC_ESSAOUIRA}
        editableBack={{ value: '', onChange: () => {}, maxLength: 200 }}
      />
    )
    expect(html).toContain('<textarea')
    expect(html).not.toMatch(new RegExp(`<textarea[^>]*>${POSTCARD_BACK_PLACEHOLDER}`))
  })

  // Production back-editing UX defect (2026-09-15) — `initialShowingBack`
  // lets a caller (PostcardEditor, only when opened specifically because
  // the back needs writing) skip the redundant "Turn over" tap. Read
  // once via a lazy useState initializer, so this is directly observable
  // in the INITIAL render (exactly what SSR captures) without needing a
  // real click.
  describe('initialShowingBack (production back-editing UX defect)', () => {
    it('defaults to the front when omitted — every existing caller (historical Moment display, delivered reader, Preview) is completely unaffected', () => {
      const html = renderToStaticMarkup(
        <PostcardObject postcard={STATIC_ESSAOUIRA} editableBack={{ value: '', onChange: () => {}, maxLength: 200 }} />
      )
      expect(html).toContain('Front of postcard')
      expect(html).not.toContain('Back of postcard')
    })

    it('when true, the initial render already shows the back — the writable textarea is immediately present with no prior "Turn over" needed', () => {
      const html = renderToStaticMarkup(
        <PostcardObject
          postcard={STATIC_ESSAOUIRA}
          editableBack={{ value: '', onChange: () => {}, maxLength: 200 }}
          initialShowingBack
        />
      )
      expect(html).toContain('Back of postcard')
      expect(html).not.toContain('Front of postcard')
      expect(html).toContain('aria-label="Postcard message"')
    })
  })

  // Placeholder semantics correction (2026-09-14) — a still-blank NEW
  // letter-level Postcard, rendered read-only (no `editable`, exactly
  // what Preview/a read-only draft view does), must show no message text
  // at all: never the catalog's own canned prose, and never
  // POSTCARD_BACK_PLACEHOLDER standing in as though the sender had
  // written it. resolveLetterPostcardDisplay is the real caller here —
  // this proves the empty string it now returns renders as genuinely
  // empty, not as some other fallback text.
  it('a read-only render of a still-blank NEW letter-level Postcard shows no message text — not catalog prose, not the placeholder', () => {
    const essaouiraBase: PostcardBaseContent = {
      title: ESSAOUIRA.title,
      location: ESSAOUIRA.location,
      collection: ESSAOUIRA.collection,
      frontImagePath: ESSAOUIRA.frontImagePath,
      postmarkText: ESSAOUIRA.postmarkText ?? '',
      footerText: ESSAOUIRA.footerText ?? '',
      living: ESSAOUIRA.living,
    }
    const blankPostcard = resolveLetterPostcardDisplay(essaouiraBase, { revealLine: '', backMessage: '' })
    const html = renderToStaticMarkup(<PostcardObject postcard={blankPostcard} />)
    expect(html).not.toContain(POSTCARD_BACK_PLACEHOLDER)
    expect(html).not.toContain(POSTCARD_CATALOG.essaouira.backMessage.split('\n\n')[0])
  })

  // The reduced-motion branch only shows the back once `showingBack`
  // flips true via a real click on "Turn over" — an effect/event-driven
  // state this SSR-only harness can't exercise directly (same
  // established limitation as every other click-driven state in this
  // file, e.g. the "H. reduced motion" describe block above). Verified
  // via source-text inspection instead, per this file's own established
  // convention: both branches must forward the identical prop.
  it('reduced-motion viewers get the same writable back once flipped — both branches forward editableBack identically', () => {
    expect(source).toContain('<PostcardBack postcard={postcard} editable={editableBack} />')
    const occurrences = (source.match(/<PostcardBack postcard=\{postcard\} editable=\{editableBack\} \/>/g) ?? []).length
    expect(occurrences).toBe(2)
  })

  it('J. every existing (non-composer) caller omits editableBack, so the delivered/historical back stays read-only — no textarea', () => {
    const html = renderToStaticMarkup(<PostcardObject postcard={STATIC_ESSAOUIRA} />)
    expect(html).not.toContain('<textarea')
  })
})

// N. All existing Essaouira/historical Postcard tests remain passing —
// protected by the full suite (this file's own earlier describe blocks,
// plus lib/moments.test.ts, letter-body.test.tsx, etc.) continuing to
// pass unchanged; see the checkpoint report rather than duplicating here.
