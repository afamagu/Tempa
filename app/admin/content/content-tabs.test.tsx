import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'

let pathname = '/admin/content/dispatches'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))

const { default: ContentTabs, CONTENT_TABS, activeContentTab } = await import('./content-tabs')

describe('Admin Content tabs', () => {
  it('Questions / Announcements / Postcards / Dispatches / Sponsored, in that order', () => {
    expect(CONTENT_TABS.map((t) => t.label)).toEqual(['Questions', 'Announcements', 'Postcards', 'Dispatches', 'Sponsored'])
    expect(CONTENT_TABS.map((t) => t.label)).not.toContain('Ads')
  })

  it('highlights the active child, including nested new/edit routes', () => {
    expect(activeContentTab('/admin/content/dispatches/new')).toBe('/admin/content/dispatches')
    expect(activeContentTab('/admin/content/sponsored/abc/edit')).toBe('/admin/content/sponsored')
    expect(activeContentTab('/admin/content')).toBe('/admin/content/questions')
    pathname = '/admin/content/sponsored'
    const html = renderToStaticMarkup(<ContentTabs />)
    expect(html).toMatch(/aria-current="page"[^>]*>Sponsored</)
  })
})

describe('Admin Content — official/sponsored pages', () => {
  const dir = path.join(__dirname, 'official-dispatches')
  const list = readFileSync(path.join(dir, 'official-dispatch-list.tsx'), 'utf8')
  const composerPage = readFileSync(path.join(dir, 'official-composer-page.tsx'), 'utf8')

  it('reuses the member DispatchComposer (no second editor) in publication mode', () => {
    expect(composerPage).toContain("import DispatchComposer from '@/app/board/dispatch-composer'")
    expect(composerPage).toContain('publication={{ publishedAs: kind }}')
    expect(composerPage).toContain('publication={{ publishedAs: kind, initialSponsor: sponsor }}')
  })

  it('page-level admin check exists (the RPC re-checks is_staff independently)', () => {
    expect(composerPage).toContain("isStaff(supabase, 'admin')")
  })

  it('lists New / Open / Edit / Copy share link via the existing share infrastructure; no service role', () => {
    expect(list).toContain('New Tempa Dispatch')
    expect(list).toContain('New Sponsored Dispatch')
    expect(list).toContain('<CopyShareLinkButton')
    expect(readFileSync(path.join(dir, 'copy-share-link-button.tsx'), 'utf8')).toContain('shareDispatch(')
    expect(list + composerPage).not.toMatch(/service_role|SERVICE_ROLE|createAdminClient/)
  })

  it('route files exist for both kinds', () => {
    for (const kind of ['dispatches', 'sponsored']) {
      for (const f of ['page.tsx', 'new/page.tsx', '[dispatchId]/edit/page.tsx']) {
        expect(readFileSync(path.join(__dirname, kind, f), 'utf8')).toMatch(/Official(DispatchList|ComposerPage)/)
      }
    }
  })
})
