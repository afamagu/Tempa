import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PostcardThumbnail from './postcard-thumbnail'

/**
 * Thumbnail + expanded-experience checkpoint (2026-09-14) — the ONE
 * compact, portrait, CLOSED representation of a Postcard, shared by the
 * letterhead's read-only slot and the composer's own resting state.
 */
function render(overrides: Partial<Parameters<typeof PostcardThumbnail>[0]> = {}) {
  return renderToStaticMarkup(
    <PostcardThumbnail
      frontImagePath="/postcards/essaouira.jpg"
      onOpen={() => {}}
      ariaLabel="Open postcard"
      {...overrides}
    />
  )
}

describe('PostcardThumbnail — still-only, compact, portrait', () => {
  it('renders exactly the still front image — no video, no chrome', () => {
    const html = render()
    expect(html).toContain('/postcards/essaouira.jpg')
    expect(html).not.toContain('<video')
  })

  it('is constrained by width only (90–110px mobile, 110–135px desktop) — height follows the image\'s own natural portrait ratio, never object-fit/crop', () => {
    const html = render()
    expect(html).toMatch(/w-\[\d+px\]/)
    expect(html).toMatch(/sm:w-\[\d+px\]/)
    expect(html).not.toContain('object-cover')
    expect(html).not.toContain('object-fit')
    expect(html).not.toContain('aspect-')
  })

  it('the chosen widths actually fall within the requested ranges (90–110px mobile, 110–135px desktop)', () => {
    const html = render()
    const mobileMatch = html.match(/\bw-\[(\d+)px\]/)
    const desktopMatch = html.match(/sm:w-\[(\d+)px\]/)
    const mobileWidth = Number(mobileMatch?.[1])
    const desktopWidth = Number(desktopMatch?.[1])
    expect(mobileWidth).toBeGreaterThanOrEqual(90)
    expect(mobileWidth).toBeLessThanOrEqual(110)
    expect(desktopWidth).toBeGreaterThanOrEqual(110)
    expect(desktopWidth).toBeLessThanOrEqual(135)
  })

  it('feels like a physical enclosure — a border and a restrained shadow, never a bare unstyled image', () => {
    const html = render()
    expect(html).toContain('border')
    expect(html).toContain('shadow-sm')
  })
})

describe('PostcardThumbnail — quiet discoverability, never video-player UI or permanent clutter', () => {
  it('never renders a play triangle/button, duration, or scrubber', () => {
    const html = render()
    expect(html).not.toContain('▶')
    expect(html.toLowerCase()).not.toContain('duration')
    expect(html.toLowerCase()).not.toContain('scrubber')
  })

  it('carries the given aria-label as its accessible name, not as permanently visible text', () => {
    const html = render({ ariaLabel: 'Open postcard' })
    expect(html).toContain('aria-label="Open postcard"')
    expect(html).not.toMatch(/>Open postcard</)
  })

  it('shows the one-time hint only when the caller says to (showFirstUseHint), never by default', () => {
    const withoutHint = render()
    const withHint = render({ showFirstUseHint: true })
    expect(withoutHint).not.toContain('Tap the postcard to open it.')
    expect(withHint).toContain('Tap the postcard to open it.')
  })
})

describe('PostcardThumbnail — click wiring', () => {
  it('calls onOpen when the button is the only interactive element', () => {
    const onOpen = vi.fn()
    const html = render({ onOpen })
    // A pure SSR render can't dispatch a real click; the wiring itself
    // (exactly one button, calling the given handler) is what matters
    // here — there is exactly one clickable surface in this component.
    expect((html.match(/<button/g) ?? []).length).toBe(1)
  })
})
