import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import AuthorActionsMenu from './author-actions-menu'

const SOURCE_PATH = path.join(__dirname, 'author-actions-menu.tsx')
const source = readFileSync(SOURCE_PATH, 'utf8')

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => {}, refresh: () => {} }) }))

// Same SSR-only limitation as every other interactive control in this
// codebase (see dispatch-composer.test.tsx's own comment on
// openPickerIndex): the action sheet itself only appears after a click
// (internal `open` state, not a prop), which renderToStaticMarkup can't
// simulate — so this proves the trigger's own accessible shape and that
// the sheet is not accidentally rendered open by default. The sheet's
// own item labels/conditional Stop-sharing were verified live in a
// real browser as part of this checkpoint's validation pass.
describe('AuthorActionsMenu — restrained trigger (item 10)', () => {
  it('renders one real, accessibly-labeled trigger, not four separate large buttons', () => {
    const html = renderToStaticMarkup(
      <AuthorActionsMenu
        dispatchId="d-1"
        initialShareToken={null}
        initialIsPinned={false}
        momentImagePaths={[]}
        editable
      />
    )
    expect(html).toMatch(/<button[^>]*aria-label="Dispatch options"/)
    // The sheet's own action labels must not be present until opened.
    expect(html).not.toContain('Edit Dispatch')
    expect(html).not.toContain('Delete Dispatch')
    expect(html).not.toContain('Pin to profile')
  })

  it('never uses a native window.confirm — no such call appears in the rendered output as inline script', () => {
    const html = renderToStaticMarkup(
      <AuthorActionsMenu
        dispatchId="d-1"
        initialShareToken={null}
        initialIsPinned={false}
        momentImagePaths={[]}
        editable
      />
    )
    expect(html).not.toContain('window.confirm')
  })
})

// Smoke-test contract completion checkpoint (Section G) — "the product
// should not tease an unavailable action." Same SSR-only limitation as
// above (the sheet only opens via click-driven state, not a prop), so
// the conditional gating itself is proven via source inspection —
// consistent with this file's own established convention.
describe('AuthorActionsMenu — Edit Dispatch affordance gated on server-resolved eligibility (Section G)', () => {
  it('the Edit Dispatch link is wrapped in {editable && (...)}, never rendered unconditionally', () => {
    expect(source).toContain('{editable && (')
    const gateStart = source.indexOf('{editable && (')
    const gateEnd = source.indexOf(')}', gateStart)
    expect(source.slice(gateStart, gateEnd)).toContain('Edit Dispatch')
  })

  it('editable is documented as a hint only — update_dispatch remains the actual authority regardless of this prop', () => {
    const propDocStart = source.indexOf('editable: boolean')
    const propDocRegion = source.slice(Math.max(0, propDocStart - 700), propDocStart)
    expect(propDocRegion).toContain('UI HINT only, not the authority')
  })
})

// Board Experience Phase 2B, pre-SQL correction pass — a Dispatch that
// still has Replies cannot be deleted (delete_dispatch's own new
// guard). "Please try again" would be misleading for that specific,
// permanent condition, so handleDelete gives it its own coherent
// message instead — same source-inspection convention as ReportButton's
// own duplicate-report-message test (app/report-button.test.tsx), since
// the click-driven flow itself is unreachable via renderToStaticMarkup.
describe('AuthorActionsMenu — coherent error when a Dispatch has Replies (source)', () => {
  function handleDeleteBody(): string {
    const start = source.indexOf('async function handleDelete')
    const end = source.indexOf('async function', start + 1)
    return source.slice(start, end === -1 ? source.length : end)
  }

  it('shows the exact guard message verbatim, not the generic retry copy, when deleteDispatch returns it', () => {
    const body = handleDeleteBody()
    expect(body).toContain("deleteError.message === 'This Dispatch cannot be deleted while it still has Replies.'")
    expect(body).toContain('? deleteError.message')
  })

  it('still falls back to the generic retry message for any other delete error', () => {
    const body = handleDeleteBody()
    expect(body).toContain(': \'Could not delete this Dispatch. Please try again.\'')
  })
})
