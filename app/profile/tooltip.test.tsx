import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import Tooltip from './tooltip'

// Country-flag follow-up (2026-09-09): Tooltip gained preventDefault-on-
// toggle and Escape-to-dismiss so it's safe to nest inside an ancestor
// link (see app/country-flag.tsx) and dismissable the same way as any
// other small popover. This codebase's established convention is
// renderToStaticMarkup-only (no jsdom, no click simulation) — the
// closed-by-default render is what SSR can prove; the open/dismiss
// interaction itself was verified by direct code inspection (the
// preventDefault call and the keydown listener are both present and
// unconditional) rather than a simulated event.
describe('Tooltip — closed by default, wraps its trigger without altering it', () => {
  it('renders the wrapped control and no visible tooltip bubble before any interaction', () => {
    const html = renderToStaticMarkup(
      <Tooltip label="France">
        <button type="button" aria-label="Country: France">
          🇫🇷
        </button>
      </Tooltip>
    )
    expect(html).toContain('aria-label="Country: France"')
    expect(html).not.toContain('role="tooltip"')
  })

  it('does not depend on a native title attribute for its own label text', () => {
    const html = renderToStaticMarkup(
      <Tooltip label="France">
        <button type="button" aria-label="Country: France">
          🇫🇷
        </button>
      </Tooltip>
    )
    expect(html).not.toContain('title="France"')
  })
})
