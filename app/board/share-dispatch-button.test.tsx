import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import ShareDispatchButton from './share-dispatch-button'

// This codebase's established convention (see dispatch-composer.test.tsx,
// keep-button has no dedicated test file at all) is renderToStaticMarkup-
// only, no jsdom — so click-driven behavior (the actual share_dispatch
// call, native-share-vs-clipboard branching, and URL construction) is
// covered at the lib/dispatches.ts level instead (see dispatches.test.ts's
// "sharing broadened" describe block). These tests cover exactly what SSR
// rendering can prove: the control exists, has a real accessible name, and
// carries no attribution/count vocabulary.
//
// Board usability checkpoint (2026-09-09): this component is now available
// to ANY authenticated reader, not just the author — it is deliberately
// stateless about whether the Dispatch is already shared (that knowledge,
// and the ability to revoke, belongs to the author's own
// author-actions-menu.tsx instead), so it takes no initialShareToken/
// canRevoke props at all any more.
describe('ShareDispatchButton — accessible control, not Forward, no attribution', () => {
  it('renders a real button labeled Share, never Forward', () => {
    const html = renderToStaticMarkup(
      <ShareDispatchButton dispatchId="d-1" title="A quiet morning" authorPseudonym="Evening Quill" />
    )
    expect(html).toMatch(/<button[^>]*aria-label="Share this Dispatch"/)
    expect(html).toContain('>Share<')
    expect(html.toLowerCase()).not.toContain('forward')
  })

  it('exposes no per-sharer attribution or share-count vocabulary', () => {
    const html = renderToStaticMarkup(
      <ShareDispatchButton dispatchId="d-1" title="A quiet morning" authorPseudonym="Evening Quill" />
    )
    const lower = html.toLowerCase()
    expect(lower).not.toContain('shared by')
    expect(lower).not.toMatch(/\d+ shares?/)
  })

  it('never generates or displays a raw dispatch id as the share link', () => {
    const html = renderToStaticMarkup(
      <ShareDispatchButton dispatchId="d-1" title="A quiet morning" authorPseudonym="Evening Quill" />
    )
    expect(html).not.toContain('/d/d-1')
  })
})
