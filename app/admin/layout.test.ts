import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const SOURCE_PATH = path.join(__dirname, 'layout.tsx')
const source = readFileSync(SOURCE_PATH, 'utf8')

// AdminLayout is a Server Component using next/navigation's redirect(),
// which throws a special control-flow signal outside a real request —
// not renderable via renderToStaticMarkup or exercisable without a full
// Next.js request context. Verified by source inspection instead (the
// established convention in this codebase for logic that can't be
// exercised by the available render harness — see moment-affordance-
// extension.test.ts), matching the checkpoint's own requirement:
// authorization must be enforced server-side, never merely a
// client-side-only hide.
describe('AdminLayout — server-side staff gate (source)', () => {
  it('is a Server Component (no "use client"), so this check can never be bypassed by disabling client JS', () => {
    expect(source.trimStart().startsWith("'use client'")).toBe(false)
  })

  it('redirects an unauthenticated visitor before any admin content is reached', () => {
    expect(source).toContain('if (!user) {')
    expect(source).toContain("redirect('/sign-in')")
  })

  it('redirects a signed-in but non-staff visitor away from /admin entirely', () => {
    const staffCheckIndex = source.indexOf('const staff = await isStaff(supabase)')
    expect(staffCheckIndex).toBeGreaterThan(-1)
    const guardRegion = source.slice(staffCheckIndex, staffCheckIndex + 120)
    expect(guardRegion).toContain('if (!staff) {')
    expect(guardRegion).toContain("redirect('/')")
  })

  it('calls the real is_staff()-backed check, never a hardcoded email/id allowlist', () => {
    expect(source).toContain('isStaff(supabase)')
    expect(source).not.toMatch(/user\.email\s*===/)
  })
})
