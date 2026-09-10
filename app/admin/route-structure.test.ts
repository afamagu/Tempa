import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const layoutSource = readFileSync(path.join(__dirname, 'layout.tsx'), 'utf8')
const overviewPageSource = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const reportsPageSource = readFileSync(path.join(__dirname, 'reports', 'page.tsx'), 'utf8')

// Admin Command Center Phase 1 — /admin moved from being the report
// queue to being the new Overview landing page, and the report queue
// moved to /admin/reports. layout.tsx wraps EVERY route under
// app/admin/ (both of these included) and is the sole enforcement
// point (see layout.test.ts for its own full coverage, unchanged by
// this batch) — these tests only confirm the two page files don't
// duplicate or bypass that gate, and that the gate itself still exists.
describe('Admin Command Center Phase 1 — route structure remains staff-gated', () => {
  it('the shared layout still performs the real server-side staff gate (unchanged)', () => {
    expect(layoutSource).toContain('if (!user) {')
    expect(layoutSource).toContain("redirect('/sign-in')")
    expect(layoutSource).toContain('isStaff(supabase)')
    expect(layoutSource).toContain("if (!staff) {")
  })

  it('/admin (Overview) is a Server Component with no competing auth check of its own — relies entirely on the shared layout', () => {
    expect(overviewPageSource.trimStart().startsWith("'use client'")).toBe(false)
    expect(overviewPageSource).not.toContain('isStaff')
    expect(overviewPageSource).not.toContain("redirect(")
  })

  it('/admin/reports is a Server Component with no competing auth check of its own — relies entirely on the shared layout', () => {
    expect(reportsPageSource.trimStart().startsWith("'use client'")).toBe(false)
    expect(reportsPageSource).not.toContain('isStaff')
    expect(reportsPageSource).not.toContain("redirect(")
  })

  it('the nav offers exactly Overview / Reports / Members in Phase 1 — no empty Content/System/Commerce links yet', () => {
    expect(layoutSource).toContain('Overview')
    expect(layoutSource).toContain('Reports')
    expect(layoutSource).toContain('Members')
    expect(layoutSource).not.toContain('Content')
    expect(layoutSource).not.toContain('System')
    expect(layoutSource).not.toContain('Commerce')
  })

  it('the report detail page links back to the new /admin/reports queue location, not the old /admin', () => {
    const detailSource = readFileSync(path.join(__dirname, 'reports', '[id]', 'page.tsx'), 'utf8')
    expect(detailSource).toContain('href="/admin/reports"')
  })
})
