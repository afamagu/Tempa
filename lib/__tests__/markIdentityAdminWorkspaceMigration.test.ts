import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const migrationPath = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-09-30-mark-identity-and-admin-member-workspace.sql')
const verifierPath = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-09-30-mark-identity-and-admin-member-workspace-verify.sql')
const sql = readFileSync(migrationPath, 'utf8')
const verify = readFileSync(verifierPath, 'utf8')
const lower = sql.toLowerCase()

function functionBody(name: string, nextMarker: string): string {
  const replaceStart = lower.indexOf(`create or replace function public.${name}`)
  const createStart = lower.indexOf(`create function public.${name}`)
  const start = replaceStart >= 0 ? replaceStart : createStart
  expect(start).toBeGreaterThan(-1)
  const end = lower.indexOf(nextMarker, start)
  expect(end).toBeGreaterThan(start)
  return lower.slice(start, end)
}

describe('Mark management migration contract', () => {
  it('fails before mutation when the approved Mark/Admin/Letters prerequisites are absent', () => {
    const prerequisite = lower.indexOf('do $prerequisite$')
    const firstMutation = lower.indexOf('create or replace function')
    expect(prerequisite).toBeGreaterThan(lower.indexOf('begin;'))
    expect(prerequisite).toBeLessThan(firstMutation)
    expect(lower).toContain("to_regclass('public.profile_marks')")
    expect(lower).toContain("to_regprocedure('public.finalize_profile_mark(uuid)')")
    expect(lower).toContain("to_regprocedure('tempa_private.is_correspondence_blocked_pair(uuid,uuid)')")
  })

  it('enforces the 30-day replacement cooldown in both reservation and finalization while allowing a first Mark', () => {
    const reserve = functionBody('reserve_profile_mark()', 'create or replace function public.finalize_profile_mark')
    const finalize = functionBody('finalize_profile_mark(p_mark_id uuid)', '-- own outgoing-block management')
    for (const body of [reserve, finalize]) {
      expect(body).toContain("interval '30 days'")
      expect(body).toContain('v_profile.mark_id is not null')
    }
    expect(finalize.indexOf("v_mark.status = 'active'")).toBeLessThan(finalize.indexOf("interval '30 days'"))
  })

  it('keeps management timing owner-private and never exposes source-photo storage', () => {
    expect(lower).toContain('get_profile_mark_management_status')
    expect(lower).toContain('where id = auth.uid()')
    expect(lower).not.toMatch(/source_(photo|image)\s+(bytea|blob|text)/)
    expect(lower).not.toContain('generatemarkv2')
  })
})

describe('Admin member workspace migration contract', () => {
  it('requires staff, preserves blocking, and creates an ordinary participant correspondence and letter', () => {
    const body = functionBody('admin_send_first_letter(p_member_id uuid, p_body text)', 'revoke all on function public.admin_send_first_letter')
    expect(body).toContain('if not public.is_staff()')
    expect(body).toContain('tempa_private.is_correspondence_blocked_pair')
    expect(body).toContain('insert into public.correspondences')
    expect(body).toContain('insert into public.letters')
    expect(body).toContain("c.status = 'active'")
    expect(body).toContain('char_length(v_body) > 4000')
    expect(body).not.toContain('service_role')
  })

  it('adds only legitimate staff member fields and does not expose onboarding or Mark ownership state', () => {
    const detail = functionBody('admin_get_member(p_user_id uuid)', 'revoke all on function public.admin_get_member')
    expect(detail).toContain('u.email::text')
    expect(detail).toContain('p.mark_id')
    expect(detail).not.toContain('onboarding_stage')
    expect(detail).not.toContain('owner_id')
  })

  it('widens the owner-only blocked list with mark_id without weakening its owner scope', () => {
    const start = lower.indexOf('create function public.get_blocked_profiles()')
    const end = lower.indexOf('revoke all on function public.get_blocked_profiles()', start)
    const body = lower.slice(start, end)
    expect(body).toContain('p.mark_id')
    expect(body).toContain('b.blocker_id = auth.uid()')
  })
})

describe('read-only verifier', () => {
  it('contains no mutating SQL and checks cooldown, staff/blocking, member shape, and storage limits', () => {
    expect(verify).not.toMatch(/^\s*(insert|update|delete|alter|create|drop|grant|revoke|truncate)\b/im)
    for (const marker of [
      'reserve_enforces_cooldown',
      'finalize_rechecks_cooldown',
      'admin_contact_checks_staff',
      'admin_contact_respects_blocks',
      'staff_detail_has_mark',
      'png_one_mib_unchanged',
    ]) expect(verify).toContain(marker)
  })
})
