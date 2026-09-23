import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const layoutSource = readFileSync(path.join(__dirname, 'layout.tsx'), 'utf8')
const adminNavSource = readFileSync(path.join(__dirname, 'admin-nav.tsx'), 'utf8')
const overviewPageSource = readFileSync(path.join(__dirname, 'page.tsx'), 'utf8')
const contentPageSource = readFileSync(path.join(__dirname, 'content', 'page.tsx'), 'utf8')
const reportsPageSource = readFileSync(path.join(__dirname, 'moderation', 'reports', 'page.tsx'), 'utf8')
const publicContentPageSource = readFileSync(
  path.join(__dirname, 'moderation', 'public-content', 'page.tsx'),
  'utf8'
)
const needsAttentionPageSource = readFileSync(
  path.join(__dirname, 'moderation', 'needs-attention', 'page.tsx'),
  'utf8'
)
const needsAttentionDetailPageSource = readFileSync(
  path.join(__dirname, 'moderation', 'needs-attention', '[id]', 'page.tsx'),
  'utf8'
)
const questionsPageSource = readFileSync(path.join(__dirname, 'content', 'questions', 'page.tsx'), 'utf8')
const systemPageSource = readFileSync(path.join(__dirname, 'system', 'page.tsx'), 'utf8')
const emailStatusPageSource = readFileSync(path.join(__dirname, 'system', 'email', 'page.tsx'), 'utf8')

// layout.tsx wraps EVERY route under app/admin/ and is the sole
// enforcement point (see layout.test.ts for its own full coverage,
// unchanged since Phase 1) — these tests only confirm every page file
// added/moved in Admin Phase 2A-1 doesn't duplicate or bypass that
// gate, and that the gate itself still exists.
describe('Admin Command Center — route structure remains staff-gated', () => {
  it('the shared layout still performs the real server-side staff gate (unchanged)', () => {
    expect(layoutSource).toContain('if (!user) {')
    expect(layoutSource).toContain("redirect('/sign-in')")
    expect(layoutSource).toContain('isStaff(supabase)')
    expect(layoutSource).toContain("if (!staff) {")
  })

  it('/admin (Overview) is a Server Component with no competing auth check of its own', () => {
    expect(overviewPageSource.trimStart().startsWith("'use client'")).toBe(false)
    expect(overviewPageSource).not.toContain('isStaff')
    expect(overviewPageSource).not.toContain('redirect(')
  })

  it('/admin/moderation/reports is a Server Component with no competing auth check of its own', () => {
    expect(reportsPageSource.trimStart().startsWith("'use client'")).toBe(false)
    expect(reportsPageSource).not.toContain('isStaff')
    expect(reportsPageSource).not.toContain('redirect(')
  })

  it('/admin/moderation/public-content is a Server Component with no competing auth check of its own — the RPC it calls is what actually enforces admin-only', () => {
    expect(publicContentPageSource.trimStart().startsWith("'use client'")).toBe(false)
    expect(publicContentPageSource).not.toContain('isStaff')
    expect(publicContentPageSource).not.toContain('redirect(')
  })

  it('/admin/moderation/needs-attention is a Server Component with no competing auth check of its own — admin_list_safety_cases is what actually enforces staff-only', () => {
    expect(needsAttentionPageSource.trimStart().startsWith("'use client'")).toBe(false)
    expect(needsAttentionPageSource).not.toContain('isStaff')
    expect(needsAttentionPageSource).not.toContain('redirect(')
  })

  it('/admin/moderation/needs-attention/[id] is a Server Component with no competing auth check of its own — admin_get_safety_case is what actually enforces staff-only', () => {
    expect(needsAttentionDetailPageSource.trimStart().startsWith("'use client'")).toBe(false)
    expect(needsAttentionDetailPageSource).not.toContain('isStaff')
    expect(needsAttentionDetailPageSource).not.toContain('redirect(')
  })

  it('the needs-attention case detail page links back to the case queue', () => {
    expect(needsAttentionDetailPageSource).toContain('href="/admin/moderation/needs-attention"')
  })

  it('/admin/content/questions is a Server Component with no competing auth check of its own — the RPC it calls is what actually enforces admin-only', () => {
    expect(questionsPageSource.trimStart().startsWith("'use client'")).toBe(false)
    expect(questionsPageSource).not.toContain('isStaff')
    expect(questionsPageSource).not.toContain('redirect(')
  })

  it('/admin/content redirects to its one Phase 2A-1 child rather than rendering a landing page with a single link', () => {
    expect(contentPageSource).toContain("redirect('/admin/content/questions')")
  })

  it('/admin/system redirects to its one child (Email delivery), same shape as /admin/content before it grew tabs', () => {
    expect(systemPageSource).toContain("redirect('/admin/system/email')")
    expect(systemPageSource).not.toContain('isStaff')
    expect(systemPageSource).not.toContain('redirect(\'/sign-in\'')
  })

  it('/admin/system/email is a Server Component with no competing auth check of its own — admin_get_arrival_email_status is what actually enforces admin-only', () => {
    expect(emailStatusPageSource.trimStart().startsWith("'use client'")).toBe(false)
    expect(emailStatusPageSource).not.toContain('isStaff')
    expect(emailStatusPageSource).not.toContain('redirect(')
  })

  it('the nav offers exactly Overview / Moderation / Members / Content / System — no empty Analytics/Commerce destination, no fake Postcards tab yet', () => {
    // Scoped to the actual DESTINATIONS array, not the whole file —
    // this file's own doc comment legitimately mentions "Analytics" as
    // a past placeholder name, which a bare whole-file substring check
    // would wrongly flag as a real tab.
    const arrayStart = adminNavSource.indexOf('DESTINATIONS: Destination[] = [')
    const end = adminNavSource.indexOf('\n]', arrayStart)
    const destinationsSource = adminNavSource.slice(arrayStart, end)

    expect(destinationsSource).toContain("label: 'Overview'")
    expect(destinationsSource).toContain("label: 'Moderation'")
    expect(destinationsSource).toContain("label: 'Members'")
    expect(destinationsSource).toContain("label: 'Content'")
    expect(destinationsSource).toContain("label: 'System'")
    expect(destinationsSource).not.toContain('Analytics')
    expect(destinationsSource).not.toContain('Commerce')
    expect(destinationsSource).not.toContain('More')
    expect(destinationsSource).not.toContain('Postcards')
  })

  it('the report detail page links back to the current /admin/moderation/reports queue location', () => {
    const detailSource = readFileSync(path.join(__dirname, 'moderation', 'reports', '[id]', 'page.tsx'), 'utf8')
    expect(detailSource).toContain('href="/admin/moderation/reports"')
  })

  it('Admin Operations Refinement: /admin/content/announcements is a Server Component with no competing auth check of its own', () => {
    const announcementsPageSource = readFileSync(
      path.join(__dirname, 'content', 'announcements', 'page.tsx'),
      'utf8'
    )
    expect(announcementsPageSource.trimStart().startsWith("'use client'")).toBe(false)
    expect(announcementsPageSource).not.toContain('isStaff')
    expect(announcementsPageSource).not.toContain('redirect(')
  })

  it('the Admin nav still points Moderation at the working canonical route, not the bare 404ing index', () => {
    expect(adminNavSource).toContain("href: '/admin/moderation/reports'")
  })

  it('Moderation tabs offer Needs Attention alongside the existing Reports/Public Content — added coherently, not a disconnected admin product', () => {
    const tabsSource = readFileSync(path.join(__dirname, 'moderation', 'moderation-tabs.tsx'), 'utf8')
    expect(tabsSource).toContain('/admin/moderation/needs-attention')
    expect(tabsSource).toContain('/admin/moderation/reports')
    expect(tabsSource).toContain('/admin/moderation/public-content')
  })

  it('old /admin/reports paths redirect permanently to the new Moderation location', () => {
    const configSource = readFileSync(path.join(__dirname, '..', '..', 'next.config.ts'), 'utf8')
    expect(configSource).toContain('source: "/admin/reports"')
    expect(configSource).toContain('destination: "/admin/moderation/reports"')
    expect(configSource).toContain('source: "/admin/reports/:id"')
    expect(configSource).toContain('permanent: true')
  })
})

describe('Admin Command Center Phase 2A-1 — mobile nav has exactly 4 destinations, no fake "More"', () => {
  it('renders a fixed, safe-area-aware bottom tab bar on mobile, hidden on desktop', () => {
    expect(adminNavSource).toContain('sm:hidden')
    expect(adminNavSource).toContain('env(safe-area-inset-bottom)')
    expect(adminNavSource).toContain('fixed inset-x-0 bottom-0')
  })

  it('the desktop nav is hidden on mobile — one shared destinations list, not two parallel implementations', () => {
    expect(adminNavSource).toContain('hidden gap-4')
    expect(adminNavSource).toContain('sm:flex')
    // Exactly one DESTINATIONS list feeds both renders.
    expect((adminNavSource.match(/DESTINATIONS/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })

  it('the admin layout reserves bottom space on mobile so the fixed tab bar never obscures page content', () => {
    expect(layoutSource).toContain('pb-20')
  })
})
