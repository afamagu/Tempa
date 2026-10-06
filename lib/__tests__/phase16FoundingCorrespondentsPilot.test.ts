import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const migration = readFileSync(
  path.join(root, 'docs/sql/2026-10-06-phase16-founding-correspondents-pilot.sql'),
  'utf8'
)
const pilotPage = readFileSync(path.join(root, 'app/pilot-access/page.tsx'), 'utf8')
const adminPilot = readFileSync(path.join(root, 'app/admin/pilot/page.tsx'), 'utf8')
const adminNav = readFileSync(path.join(root, 'app/admin/admin-nav.tsx'), 'utf8')
const accountEntryState = readFileSync(path.join(root, 'lib/account-entry-state.ts'), 'utf8')

describe('Phase 16 — Founding Correspondents pilot', () => {
  it('grandfathers every existing auth account before closing the gate', () => {
    expect(migration).toContain("select u.id, 'grandfathered'")
    expect(migration).toContain('from auth.users u')
    expect(migration).toContain('on conflict (user_id) do nothing')
  })

  it('claims invitations using the authenticated account email, never a client-supplied email', () => {
    const start = migration.indexOf('create or replace function public.current_pilot_access()')
    const end = migration.indexOf('$function$;', start)
    const fn = migration.slice(start, end)
    expect(fn).toContain('auth.uid()')
    expect(fn).toContain('from auth.users u')
    expect(fn).toContain('where u.id = v_uid')
    expect(fn).not.toContain('p_email')
  })

  it('keeps invitation emails private and caps the cohort at 200', () => {
    expect(migration).toContain('revoke all on table tempa_private.pilot_invites')
    expect(migration).toContain('v_current_total >= 200')
    expect(migration).toContain('PILOT_COHORT_FULL')
  })

  it('derives pilot health from relationship metadata, never letter bodies', () => {
    const start = migration.indexOf('create or replace function public.admin_pilot_health()')
    const end = migration.indexOf('$function$;', start)
    const fn = migration.slice(start, end)
    expect(fn).toContain('count(l.id)::integer as letter_turns')
    expect(fn).toContain('pp.established_at')
    expect(fn).toContain('l.created_at')
    expect(fn).not.toContain('l.body')
    expect(fn).not.toContain('opened_at')
  })

  it('measures third/fifth turns and 30/60/90-day survival', () => {
    for (const token of [
      'third_turn_correspondences',
      'fifth_turn_correspondences',
      'survival_30_eligible',
      'survival_60_eligible',
      'survival_90_eligible',
    ]) {
      expect(migration).toContain(token)
    }
  })

  it('keeps pilot access fail-open only when the migration/RPC is absent', () => {
    expect(accountEntryState).toContain("supabase.rpc('current_pilot_access')")
    expect(accountEntryState).toContain('pilotResult.error ? undefined')
    expect(pilotPage).toContain('if (error) redirect(\'/home\')')
  })

  it('provides a neutral invitation-only boundary and an admin pilot workspace', () => {
    expect(pilotPage).toContain('Founding Correspondents')
    expect(pilotPage).toContain('invitation-only pilot')
    expect(adminPilot).toContain('Meaningful exchange funnel')
    expect(adminPilot).toContain('Correspondence survival')
    expect(adminNav).toContain("href: '/admin/pilot'")
  })

  it('keeps the pilot guardrails explicitly non-addictive and non-pay-to-reach', () => {
    expect(adminPilot).toContain('Five active/committed correspondences')
    expect(adminPilot).toContain('Maximum two unresolved outgoing first letters')
    expect(adminPilot).toContain('No paid capacity expansion')
    expect(adminPilot).toContain('read receipts')
    expect(adminPilot).toContain('last-seen')
    expect(adminPilot).toContain('streaks')
  })
})
