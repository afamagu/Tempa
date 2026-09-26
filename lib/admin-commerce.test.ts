import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import {
  ADMIN_COMMERCE_ERRORS,
  adminCommerceError,
  auditSummary,
  bundleCompletion,
  formatMinor,
  lifecycleLabel,
  minorDigits,
  newAdminKey,
  priceWindowState,
} from './admin-commerce'

const SQL_DIR = path.join(__dirname, '..', 'docs', 'sql')
const sql = (f: string) => readFileSync(path.join(SQL_DIR, f), 'utf8')

describe('admin error copy', () => {
  it('every refusal the admin RPCs can raise has admin-facing copy', () => {
    const raised = new Set<string>()
    for (const f of ['2026-10-23-commerce-admin-operations.sql']) {
      for (const m of sql(f).matchAll(/commerce_raise\('([a-z_]+)'\)|COMMERCE:([a-z_]+)'/g)) raised.add(m[1] ?? m[2])
    }
    // the admin Credit RPCs (2026-10-21) the Credits screen calls
    for (const c of ['not_authorized', 'reason_required', 'adjustment_below_zero', 'member_unavailable', 'invalid_request']) raised.add(c)
    const missing = [...raised].filter((c) => !ADMIN_COMMERCE_ERRORS[c])
    expect(missing).toEqual([])
  })

  it('maps codes to copy and never shows a raw database error', () => {
    expect(adminCommerceError({ message: 'COMMERCE:price_overlap' }).message).toMatch(/overlap another published price/)
    const raw = adminCommerceError({ message: 'conflicting key value violates exclusion constraint "x"' })
    expect(raw.code).toBe('unexpected')
    expect(raw.message).not.toMatch(/constraint|violates/)
  })
})

describe('presentation helpers', () => {
  const now = new Date('2026-10-01T12:00:00Z')
  it('scheduling is published + future publish_at (owner decision) — shown as Scheduled', () => {
    expect(lifecycleLabel('published', '2026-10-05T00:00:00Z', now)).toBe('Scheduled')
    expect(lifecycleLabel('published', '2026-09-01T00:00:00Z', now)).toBe('Published')
    expect(lifecycleLabel('published', null, now)).toBe('Published')
    expect(lifecycleLabel('inactive', null, now)).toBe('Off sale')
  })

  it('fiat is integer minor units; display only', () => {
    expect(formatMinor(499, 'USD')).toBe('$4.99')
    expect(formatMinor(750000, 'NGN')).toMatch(/7,500\.00/)
    expect(minorDigits('JPY')).toBe(0)
    expect(formatMinor(500, 'JPY')).toMatch(/500/)
  })

  it('price windows', () => {
    const row = (state: string, from: string, to: string | null) => ({ state, effective_from: from, effective_to: to })
    expect(priceWindowState(row('published', '2026-09-01T00:00:00Z', null), now)).toBe('current')
    expect(priceWindowState(row('published', '2026-10-02T00:00:00Z', null), now)).toBe('scheduled')
    expect(priceWindowState(row('published', '2026-09-01T00:00:00Z', '2026-09-30T00:00:00Z'), now)).toBe('ended')
    expect(priceWindowState(row('draft', '2026-09-01T00:00:00Z', null), now)).toBe('draft')
    expect(priceWindowState(row('retired', '2026-09-01T00:00:00Z', null), now)).toBe('retired')
  })

  it('bundle completion preview uses fixed allocations of items not owned', () => {
    const items = [
      { product_id: 'a', allocation_credits: 30 },
      { product_id: 'b', allocation_credits: '45' },
    ]
    expect(bundleCompletion(items, new Set())).toEqual({ full: 75, completion: 75, allOwned: false })
    expect(bundleCompletion(items, new Set(['a']))).toEqual({ full: 75, completion: 45, allOwned: false })
    expect(bundleCompletion(items, new Set(['a', 'b']))).toEqual({ full: 75, completion: 0, allOwned: true })
  })

  it('audit summaries are concise and never include notes text', () => {
    expect(
      auditSummary({ id: '1', created_at: '', actor: 'Admin', action: 'commerce_product_update', target_type: 'commerce_product', target: 'X', target_id: null, reason: null, metadata: { fields: ['cultural_review_notes', 'title'], before: { title: 'A' }, after: { title: 'B' } } })
    ).toBe('changed cultural review notes, title')
    expect(auditSummary({ id: '2', created_at: '', actor: 'Admin', action: 'commerce_product_publish', target_type: 'x', target: null, target_id: null, reason: null, metadata: { from: 'draft', to: 'published' } })).toBe('draft → published')
  })

  it('admin idempotency keys satisfy the server key format', () => {
    expect(newAdminKey('grant')).toMatch(/^[A-Za-z0-9:_-]{8,200}$/)
    expect(newAdminKey('grant')).not.toBe(newAdminKey('grant'))
  })
})

describe('Admin → Commerce never writes tables directly', () => {
  const files: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.tsx?$/.test(name) && !name.includes('.test.')) files.push(p)
    }
  }
  walk(path.join(__dirname, '..', 'app', 'admin', 'commerce'))
  files.push(path.join(__dirname, 'admin-commerce.ts'))

  it('no .from(<table>) reads or writes — every call is an admin RPC', () => {
    expect(files.length).toBeGreaterThan(10)
    for (const f of files) {
      const src = readFileSync(f, 'utf8')
      expect(src, f).not.toMatch(/\.from\(['"]/)
      expect(src, f).not.toMatch(/commerce_settings|update_settings|set_switch/)
    }
  })

  it('Settings is read-only: no inputs or buttons that could flip a switch', () => {
    const settings = readFileSync(path.join(__dirname, '..', 'app', 'admin', 'commerce', 'settings', 'page.tsx'), 'utf8')
    expect(settings).not.toMatch(/<input|<button|onChange|onClick|'use client'/)
    expect(settings).toContain('Activation belongs to the launch gate')
  })
})
