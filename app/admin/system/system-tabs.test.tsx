import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const pathname = '/admin/system/translation'
vi.mock('next/navigation', () => ({ usePathname: () => pathname }))

const { default: SystemTabs, SYSTEM_TABS, activeSystemTab } = await import('./system-tabs')

describe('Admin System tabs', () => {
  it('Email / Translation, in that order', () => {
    expect(SYSTEM_TABS).toEqual([
      { href: '/admin/system/email', label: 'Email' },
      { href: '/admin/system/translation', label: 'Translation' },
    ])
  })

  it('highlights the active child; Email is the default', () => {
    expect(activeSystemTab('/admin/system/translation')).toBe('/admin/system/translation')
    expect(activeSystemTab('/admin/system/email')).toBe('/admin/system/email')
    expect(activeSystemTab('/admin/system')).toBe('/admin/system/email')
    const html = renderToStaticMarkup(<SystemTabs />)
    expect(html).toMatch(/aria-current="page"[^>]*>Translation</)
    expect(html).toContain('href="/admin/system/email"')
  })

  it('the System layout renders the tabs with no auth logic of its own; /admin/system still defaults to Email', () => {
    const layout = readFileSync(path.join(__dirname, 'layout.tsx'), 'utf8')
    expect(layout).toContain('<SystemTabs />')
    expect(layout).not.toContain('isStaff')
    expect(readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')).toContain("redirect('/admin/system/email')")
  })

  it('no new top-level admin nav item — System stays one destination', () => {
    const nav = readFileSync(path.join(__dirname, '..', 'admin-nav.tsx'), 'utf8')
    expect(nav).not.toContain("label: 'Translation'")
    expect((nav.match(/label: 'System'/g) ?? []).length).toBe(1)
  })

  it('the Translation page is a Server Component with no competing auth check (the action re-checks admin)', () => {
    const page = readFileSync(path.join(__dirname, 'translation', 'page.tsx'), 'utf8')
    expect(page.trimStart().startsWith("'use client'")).toBe(false)
    expect(page).not.toContain('isStaff')
    expect(page).not.toContain('redirect(')
    // A page view costs zero characters: the page never invokes translation.
    expect(page).not.toMatch(/translatePrivateText|runTranslationDiagnostic|runTranslationConnectionTest/)
  })
})
