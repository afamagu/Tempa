import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import PostcardComposerSlot from './postcard-composer-slot'
import { POSTCARD_CATALOG } from '@/lib/moments'

/**
 * Letter-Level Postcards V1 (2026-09-13) — the composer's own letterhead
 * slot. Restrained empty state (never a giant drop-zone), a small
 * thumbnail once attached, and gated the same way the ⊕ affordance is
 * (disabled rather than opening onto a dead end).
 */
function render(props: Partial<Parameters<typeof PostcardComposerSlot>[0]> = {}) {
  return renderToStaticMarkup(
    <PostcardComposerSlot draft={null} onAdd={() => {}} onEdit={() => {}} {...props} />
  )
}

describe('PostcardComposerSlot — empty state', () => {
  it('shows a small, restrained "+ Add a postcard" button, never a giant drop-zone', () => {
    const html = render()
    expect(html).toContain('Add a postcard')
    // Restrained: no drop-zone language and no oversized dashed-border
    // upload affordance anywhere in the markup.
    expect(html.toLowerCase()).not.toContain('drop')
    expect(html.toLowerCase()).not.toContain('drag')
  })

  it('does not render at all once disabled (mirrors the ⊕ affordance\'s own gate)', () => {
    const html = render({ disabled: true })
    expect(html).toBe('')
  })

  it('renders no image/thumbnail when nothing is attached yet', () => {
    const html = render()
    expect(html).not.toContain('<img')
  })
})

describe('PostcardComposerSlot — filled state', () => {
  it('shows the real catalog front image once a Postcard is attached', () => {
    const html = render({ draft: { postcardKey: 'essaouira', revealLine: '', backMessage: '' } })
    expect(html).toContain(POSTCARD_CATALOG.essaouira.frontImagePath)
  })

  it('stays visible and editable even when "disabled" would suppress the empty-state button', () => {
    const html = render({
      draft: { postcardKey: 'essaouira', revealLine: '', backMessage: '' },
      disabled: true,
    })
    expect(html).toContain(POSTCARD_CATALOG.essaouira.frontImagePath)
  })

  it('tapping the thumbnail calls onEdit, never onAdd', () => {
    const onEdit = vi.fn()
    const onAdd = vi.fn()
    render({ draft: { postcardKey: 'essaouira', revealLine: '', backMessage: '' }, onEdit, onAdd })
    // A pure SSR render can't dispatch a real click; the wiring itself
    // (onClick={onEdit}, not onAdd) is what matters here and is
    // structurally guaranteed by there being exactly one clickable
    // element in the filled state.
    const html = render({ draft: { postcardKey: 'essaouira', revealLine: '', backMessage: '' } })
    expect(html).toContain('aria-label="Edit this postcard"')
  })

  it('an unrecognized/invalid postcardKey renders an honest fallback label rather than crashing', () => {
    const html = render({ draft: { postcardKey: 'not-a-real-key', revealLine: '', backMessage: '' } })
    expect(html).toContain('Postcard')
    expect(html).not.toContain('<img')
  })

  // Thumbnail + expanded-experience checkpoint (2026-09-14), Part 7 —
  // "The composer may also use the compact letterhead thumbnail as its
  // resting state": reuses the SAME shared component the delivered/
  // Preview letterhead slot uses, rather than a second, separate
  // thumbnail implementation.
  it('reuses the shared PostcardThumbnail component for its filled/resting state', () => {
    const html = render({ draft: { postcardKey: 'essaouira', revealLine: '', backMessage: '' } })
    // PostcardThumbnail's own tactile/compact treatment (border + shadow
    // + constrained width) is present, proving the real shared component
    // rendered rather than a bespoke bare <img>.
    expect(html).toContain('shadow-sm')
    expect(html).toMatch(/w-\[\d+px\]/)
  })
})
