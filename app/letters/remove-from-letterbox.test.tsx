import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import RemoveFromLetterbox from './remove-from-letterbox'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {} }) }))
vi.mock('@/lib/supabase/client', () => ({ createClient: () => ({}) }))

describe('RemoveFromLetterbox', () => {
  it('renders a plain trigger button by default — no confirmation shown until activated', () => {
    const html = renderToStaticMarkup(
      <RemoveFromLetterbox correspondenceIds={['corr-1']} triggerClassName="item" />
    )
    expect(html).toContain('Remove from my Letterbox')
    // The confirmation copy must not be visible before the trigger is
    // ever activated — this is a two-step action, not an immediate one.
    expect(html).not.toContain('nothing is deleted')
    expect(html).not.toContain('Cancel')
  })

  it('accepts a custom trigger label (e.g. the archive header context)', () => {
    const html = renderToStaticMarkup(
      <RemoveFromLetterbox
        correspondenceIds={['corr-1', 'corr-2']}
        triggerClassName="item"
        triggerLabel="Remove Evening Quill from my Letterbox"
      />
    )
    expect(html).toContain('Remove Evening Quill from my Letterbox')
  })

  it('never uses destructive/scary wording like "Delete" for what is only viewer-local hiding', () => {
    const html = renderToStaticMarkup(
      <RemoveFromLetterbox correspondenceIds={['corr-1']} triggerClassName="item" />
    )
    expect(html).not.toContain('Delete')
  })
})

// Letterbox archive compact-header checkpoint — the archive header's
// trigger is now icon-only, but the accessible name must never
// disappear along with the visible text.
describe('RemoveFromLetterbox — icon-only trigger (archive header)', () => {
  it('retains the accessible name "Remove from my Letterbox" via aria-label when rendered icon-only', () => {
    const html = renderToStaticMarkup(
      <RemoveFromLetterbox
        correspondenceIds={['corr-1']}
        triggerClassName="icon-btn"
        triggerIcon={<svg data-testid="icon" />}
      />
    )
    expect(html).toContain('aria-label="Remove from my Letterbox"')
  })

  it('renders the icon instead of the visible text label when triggerIcon is passed', () => {
    const html = renderToStaticMarkup(
      <RemoveFromLetterbox
        correspondenceIds={['corr-1']}
        triggerClassName="icon-btn"
        triggerIcon={<svg data-testid="remove-icon" />}
      />
    )
    expect(html).toContain('data-testid="remove-icon"')
    // The button itself carries the name via aria-label, not visible
    // text — but the tooltip (role="tooltip", rendered only once
    // hovered/focused) is where the label text would otherwise
    // reappear, so this only asserts the button's own text node is gone.
    expect(html).not.toMatch(/<button[^>]*>\s*Remove from my Letterbox\s*<\/button>/)
  })

  it('a plain text trigger (no triggerIcon) gets no aria-label override — its own visible text already is the accessible name', () => {
    const html = renderToStaticMarkup(
      <RemoveFromLetterbox correspondenceIds={['corr-1']} triggerClassName="item" />
    )
    expect(html).not.toContain('aria-label="Remove from my Letterbox"')
  })
})
