import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import LetterheadPostcard from './letterhead-postcard'
import { POSTCARD_CATALOG } from '@/lib/moments'

const SOURCE_PATH = path.join(__dirname, 'letterhead-postcard.tsx')
const source = readFileSync(SOURCE_PATH, 'utf8')

function render(overrides: Partial<Parameters<typeof LetterheadPostcard>[0]> = {}) {
  return renderToStaticMarkup(
    <LetterheadPostcard postcardKey="essaouira" revealLine="" backMessage="" {...overrides} />
  )
}

/**
 * Thumbnail + expanded-experience checkpoint (2026-09-14) — LOCKED
 * interaction model correction: "the mistake was rendering too much of
 * the Postcard experience directly in the letter." The letterhead slot
 * now has two states — a compact, still-only CLOSED thumbnail (the
 * INITIAL render, exercised directly here) and an OPEN expanded
 * experience (mounted only after a real click, which this SSR-only
 * harness can't simulate — verified via source-text inspection instead,
 * per this codebase's established convention for click/effect-driven
 * state elsewhere, e.g. postcard-object.test.tsx's own "H. reduced
 * motion" and moments-composer.test.tsx's own source-level checks).
 */
describe('LetterheadPostcard — A/B. closed state is a compact, still-only, portrait thumbnail', () => {
  it('A. renders the still front image only — no <video>, no Living Reveal machinery, on first render', () => {
    const html = render()
    expect(html).toContain(POSTCARD_CATALOG.essaouira.frontImagePath)
    expect(html).not.toContain('<video')
    expect(html).not.toMatch(/aria-label="Play the Living Reveal again"/)
  })

  it('B. is compact — never the full-size PostcardObject chain (no flip container, no Turn-over control) while closed', () => {
    const html = render()
    expect(html).not.toContain('postcard-perspective')
    expect(html).not.toContain('Turn over')
  })

  it('renders through the shared PostcardThumbnail component, not a bespoke thumbnail implementation', () => {
    expect(source).toContain("import PostcardThumbnail from './postcard-thumbnail'")
    expect(source).toContain('<PostcardThumbnail')
  })

  it('never autoplays motion merely because the letter itself rendered — no video element anywhere in the closed state', () => {
    const html = render()
    expect(html).not.toContain('autoPlay')
  })
})

describe('LetterheadPostcard — E. no video-player UI on the closed thumbnail', () => {
  it('no play button, duration, scrubber, or video controls of any kind', () => {
    const html = render()
    expect(html).not.toContain('<video')
    expect(html.toLowerCase()).not.toContain('play triangle')
    expect(html).not.toContain('▶')
    expect(html).not.toMatch(/aria-label="Play"/i)
  })
})

describe('LetterheadPostcard — C. tapping the thumbnail opens the expanded experience', () => {
  it('the thumbnail\'s onOpen is wired to setOpen(true), and the overlay only mounts when open is true', () => {
    expect(source).toContain('onOpen={handleOpen}')
    expect(source).toContain('function handleOpen() {')
    expect(source).toContain('setOpen(true)')
    expect(source).toContain('{open && (')
  })

  it('the expanded experience, once open, is the real unmodified PostcardObject — never a second Postcard implementation', () => {
    expect(source).toContain('<PostcardObject postcard={postcard} hasRevealedBefore={hasRevealedThisSession} />')
  })
})

describe('LetterheadPostcard — D. Living Reveal begins on first deliberate open, not on letter render', () => {
  it('PostcardObject is only ever mounted inside the open-gated overlay block, never rendered in the closed state', () => {
    const closedSectionEnd = source.indexOf('{open && (')
    const beforeOpen = source.slice(0, closedSectionEnd)
    expect(beforeOpen).not.toContain('<PostcardObject')
  })

  it('closing genuinely unmounts PostcardObject (conditional render, not a CSS visibility toggle)', () => {
    expect(source).toContain('{open && (')
    expect(source).not.toMatch(/display:\s*none/)
  })
})

// Living Postcard final interaction verification (2026-09-15) — the
// repeated-autoplay bug: closing this overlay unmounts PostcardObject,
// so a naive reopen is always a fresh mount that would replay Living
// Reveal every single time. hasRevealedThisSession is lifted ABOVE that
// conditional mount specifically so closing can't erase it — LIVE
// browser-verified (real open → reveal → close → reopen → still front
// only, Replay available, no <video> mounted) in this checkpoint's own
// report; these tests pin the source-level architecture that makes that
// behavior structural rather than incidental.
describe('LetterheadPostcard — A/B. same-session first-open state (repeated-autoplay fix)', () => {
  it('A. hasRevealedThisSession starts false, so the very first open is passed hasRevealedBefore=false and autoplays', () => {
    expect(source).toContain('const [hasRevealedThisSession, setHasRevealedThisSession] = useState(false)')
  })

  it('A/B. is declared above the conditionally mounted PostcardObject, so closing the overlay (which unmounts it) cannot erase it', () => {
    const stateIndex = source.indexOf('const [hasRevealedThisSession')
    const mountIndex = source.indexOf('{open && (')
    expect(stateIndex).toBeGreaterThan(-1)
    expect(mountIndex).toBeGreaterThan(stateIndex)
  })

  it('B. is never set synchronously in handleOpen — only setOpen/setHasOpened happen there, so the mount that opens for the first time still reads false', () => {
    const handleOpenBody = source.slice(
      source.indexOf('function handleOpen() {'),
      source.indexOf('}', source.indexOf('function handleOpen() {'))
    )
    expect(handleOpenBody).not.toContain('setHasRevealedThisSession')
  })

  it('B. is flipped true only via an effect keyed on `open`, deferred through queueMicrotask (the established pattern for satisfying react-hooks/set-state-in-effect without changing this timing) — so only the NEXT open (a fresh mount) reads true and skips autoplay', () => {
    expect(source).toContain('queueMicrotask(() => setHasRevealedThisSession(true))')
    const effectIndex = source.lastIndexOf('useEffect(() => {\n    if (!open) return\n    queueMicrotask')
    expect(effectIndex).toBeGreaterThan(-1)
  })

  it('the live value (not a hardcoded false/true) is forwarded to PostcardObject, so Replay/autoplay both stay reachable rather than one being permanently disabled', () => {
    expect(source).toContain('hasRevealedBefore={hasRevealedThisSession}')
  })
})

describe('LetterheadPostcard — H. the sender-written Reveal Line reaches the expanded PostcardObject', () => {
  it('revealLine is forwarded into resolveLetterPostcardDisplay, whose result is the exact postcard the open overlay renders', () => {
    expect(source).toContain('resolveLetterPostcardDisplay(postcardKey, {\n    revealLine,')
    expect(source).toContain('<PostcardObject postcard={postcard} hasRevealedBefore={hasRevealedThisSession} />')
  })

  it('a blank revealLine is passed through unchanged rather than substituted with placeholder/demo text — resolveLetterPostcardDisplay itself owns the blank-line behavior', () => {
    const html = render({ revealLine: '' })
    expect(html).not.toContain('Optional')
  })
})

describe('LetterheadPostcard — F. Close returns to the letter without navigation', () => {
  it('closing is local state only — no router/navigation call anywhere in this file', () => {
    expect(source).not.toContain('useRouter')
    expect(source).not.toContain('router.push')
    expect(source).not.toContain("from 'next/navigation'")
  })

  it('both the backdrop and the explicit × control close the same way', () => {
    const occurrences = (source.match(/onClick=\{\(\) => setOpen\(false\)\}/g) ?? []).length
    expect(occurrences).toBe(2)
  })

  it('Escape closes it too, mirroring the same convention as MomentDisplay/LetterPreview', () => {
    expect(source).toContain("e.key === 'Escape'")
    expect(source).toContain('setOpen(false)')
  })

  it('locks body scroll while open and restores it on close, matching the established overlay convention', () => {
    expect(source).toContain("document.body.style.overflow = 'hidden'")
    expect(source).toContain('document.body.style.overflow = previousOverflow')
  })
})

// J. LIVE browser-verified in this checkpoint's own report: body overflow
// measured "hidden" while open and "visible" again after close, and
// window.scrollY (forced to a nonzero value before opening) was
// unchanged across the whole open/close cycle. These checks pin the
// structural pieces that made that true: a full-viewport, highest-
// z-index backdrop (so a click anywhere behind the card hits the
// backdrop's own close handler, never an element on the letter beneath)
// and no navigation call anywhere in the file (checked above).
describe('LetterheadPostcard — J. the open overlay blocks the letter beneath it', () => {
  it('the backdrop covers the full viewport at the highest stacking context used anywhere in this file', () => {
    expect(source).toContain('fixed inset-0 z-50')
    expect(source).toContain('className="absolute inset-0 cursor-default"')
  })

  it('restoring the previous overflow value (not always "visible") preserves whatever scroll behavior the page already had', () => {
    expect(source).toContain('const previousOverflow = document.body.style.overflow')
  })
})

describe('LetterheadPostcard — discoverability (Part 3): quiet physical affordance, never permanent clutter', () => {
  it('shows the one-time hint before the first open, tied to hasOpened rather than a permanent label', () => {
    const html = render()
    expect(html).toContain('Tap the postcard to open it.')
    expect(source).toContain('showFirstUseHint={!onEditRequest && !hasOpened}')
  })

  it('never renders a play triangle/button or an "Open postcard" label as permanent visible text', () => {
    const html = render()
    expect(html).not.toContain('▶')
    // "Open postcard" exists only as an aria-label (accessible name), never
    // as visible button text — the visible content is the image alone.
    expect(html).toContain('aria-label="Open postcard"')
    expect(html).not.toMatch(/>Open postcard</)
  })

  it('does not add a notification-badge-style hourglass to the closed thumbnail', () => {
    const html = render()
    expect(html).not.toContain('Hourglass')
    expect(html).not.toContain('aria-hidden="true"><svg viewBox="0 0 24 24"') // PostcardObject's own icon markup, absent while closed
  })
})

// Production back-editing UX defect (2026-09-15) — onEditRequest is
// given ONLY by LetterPreview's compose-time usage. When present, the
// thumbnail must route straight into the caller's own editor rather
// than opening this component's own read-only overlay (which has
// nothing meaningful to show for a Postcard still being drafted).
describe('LetterheadPostcard — onEditRequest (production back-editing UX defect)', () => {
  it('when given, handleOpen calls it instead of opening the internal overlay', () => {
    const handleOpenBody = source.slice(
      source.indexOf('function handleOpen() {'),
      source.indexOf('return (', source.indexOf('function handleOpen() {'))
    )
    expect(handleOpenBody).toContain('if (onEditRequest) {')
    expect(handleOpenBody).toContain('onEditRequest()')
    expect(handleOpenBody).toContain('return')
  })

  it('the thumbnail aria-label reflects editing rather than opening when onEditRequest is given', () => {
    const html = render({
      onEditRequest: () => {},
    })
    expect(html).toContain('aria-label="Edit this postcard"')
    expect(html).not.toContain('aria-label="Open postcard"')
  })

  it('suppresses the "tap to open" first-use hint when onEditRequest is given — tapping never opens in place, so that hint would mislead', () => {
    const html = render({
      onEditRequest: () => {},
    })
    expect(html).not.toContain('Tap the postcard to open it.')
  })

  it('the delivered reader (no onEditRequest) is completely unaffected — same aria-label and hint behavior as before', () => {
    const html = render()
    expect(html).toContain('aria-label="Open postcard"')
    expect(html).toContain('Tap the postcard to open it.')
  })
})

describe('LetterheadPostcard — senderPseudonym forwarding (pre-migration audit correction, Part 5)', () => {
  it('is forwarded to resolveLetterPostcardDisplay for use once the Postcard is opened', () => {
    expect(source).toContain('senderPseudonym,')
  })
})

describe('LetterheadPostcard — version-aware rendering (Part 9)', () => {
  it('L/M. the closed thumbnail uses the frozen version\'s own front image when given, never the catalog\'s current one', () => {
    const html = render({
      version: {
        frontImagePath: '/postcards/essaouira-v2.jpg',
        motionSrc: '/postcards/essaouira-v2-living.mp4',
        durationSeconds: 8.2,
        revealLineAlignment: null,
      },
    })
    expect(html).toContain('/postcards/essaouira-v2.jpg')
    expect(html).not.toContain(POSTCARD_CATALOG.essaouira.frontImagePath)
  })

  it('omitting version falls back to the catalog\'s current entry (Preview\'s own draft-preview usage, unaffected)', () => {
    const html = render()
    expect(html).toContain(POSTCARD_CATALOG.essaouira.frontImagePath)
  })

  it('forwards version straight through to resolveLetterPostcardDisplay, never re-deriving asset paths itself', () => {
    expect(source).toContain('version: version')
  })
})

describe('LetterheadPostcard — an unknown/invalid postcardKey renders nothing rather than crashing', () => {
  it('returns null for an unrecognized key', () => {
    const html = render({ postcardKey: 'not-a-real-key' })
    expect(html).toBe('')
  })
})

describe('LetterheadPostcard — canonical letterhead positioning (Part 10 — do not regress)', () => {
  it('is right-aligned via a justify-end wrapper, never floated beside body text', () => {
    const html = render()
    expect(html).toContain('justify-end')
    expect(html).not.toContain('float')
  })
})
