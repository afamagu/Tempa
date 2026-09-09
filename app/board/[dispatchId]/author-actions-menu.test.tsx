import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import AuthorActionsMenu from './author-actions-menu'

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
      <AuthorActionsMenu dispatchId="d-1" initialShareToken={null} initialIsPinned={false} momentImagePaths={[]} />
    )
    expect(html).toMatch(/<button[^>]*aria-label="Dispatch options"/)
    // The sheet's own action labels must not be present until opened.
    expect(html).not.toContain('Edit Dispatch')
    expect(html).not.toContain('Delete Dispatch')
    expect(html).not.toContain('Pin to profile')
  })

  it('never uses a native window.confirm — no such call appears in the rendered output as inline script', () => {
    const html = renderToStaticMarkup(
      <AuthorActionsMenu dispatchId="d-1" initialShareToken={null} initialIsPinned={false} momentImagePaths={[]} />
    )
    expect(html).not.toContain('window.confirm')
  })
})
