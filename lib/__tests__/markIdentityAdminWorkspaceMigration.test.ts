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
    expect(lower).toContain("to_regprocedure('public.send_first_letter(uuid,uuid,text)')")
    expect(lower).toContain("to_regprocedure('public.reply_to_letter(uuid,text,jsonb,jsonb)')")
    expect(lower).toContain("i.relname = 'correspondences_one_open_per_pair'")
    expect(lower).toContain("x.indisunique and x.indisvalid and x.indisready and x.indislive")
    expect(lower).toContain('pg_catalog.pg_get_expr(x.indpred, x.indrelid, false)')
    expect(lower).toContain("= '(status = any (array[''pending''::text, ''active''::text]))'")
    expect(lower).not.toContain('correspondences_one_active_per_pair')
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
  it('repairs ordinary first contact to reuse pending episodes without changing its public eligibility contract', () => {
    const body = functionBody('send_first_letter(', 'revoke all on function public.send_first_letter')
    expect(body).toContain('returns public.letters_for_participant')
    expect(body).toContain('public.current_account_status()')
    expect(body).toContain('tempa_private.is_correspondence_blocked_pair')
    expect(body).toContain('public.question_answers qa')
    expect(body).toContain('qa.id = p_question_answer_id')
    expect(body).toContain('qa.user_id = p_recipient_id')
    expect(body).toContain('qa.is_current = true')
    expect(body).toContain('q.is_active = true')
    expect(body).toContain('on conflict (participant_low, participant_high)')
    expect(body).toContain("where status = any (array['pending'::text, 'active'::text])")
    expect(body).toContain("c.status in ('pending', 'active')")
    expect(body).toContain("v_correspondence_status = 'active' or v_established_at is not null")
    expect(body).toContain('l.sender_id = auth.uid()')
    expect(body).toContain("using errcode = '23505'")
    expect(body).toContain('v_deliver_at := now()')
    expect(body).toContain("v_expires_at := v_deliver_at + interval '72 hours'")
    expect(body).not.toMatch(/where\s+status\s*=\s*'active'\s*\)?\s*do nothing/)
  })

  it('requires staff and normal account/block eligibility before creating participant-owned correspondence', () => {
    const body = functionBody('admin_send_first_letter(p_member_id uuid, p_body text)', 'revoke all on function public.admin_send_first_letter')
    expect(body).toContain('if not public.is_staff()')
    expect(body).toContain('public.current_account_status()')
    expect(body).toContain("in ('restricted', 'suspended', 'banned')")
    expect(body).toContain('tempa_private.is_correspondence_blocked_pair')
    expect(body).toContain('insert into public.correspondences')
    expect(body).toContain('insert into public.letters')
    expect(body).not.toContain('service_role')
  })

  it('uses the pending/active one-open lifecycle without uniqueness errors as normal control flow', () => {
    const body = functionBody('admin_send_first_letter(p_member_id uuid, p_body text)', 'revoke all on function public.admin_send_first_letter')
    expect(body).toContain('on conflict (participant_low, participant_high)')
    expect(body).toContain("where status = any (array['pending'::text, 'active'::text])")
    expect(body).toContain('do nothing')
    expect(body).toContain("c.status in ('pending', 'active')")
    expect(body).toContain("v_correspondence_status = 'active' or v_established_at is not null")
    expect(body).toContain("l.reply_to_id is null")
    expect(body).toContain('l.sender_id = auth.uid()')
    expect(body).toContain("using errcode = '23505'")
    expect(body).not.toMatch(/where\s+(?:c\.)?status = 'active'\s*\)?\s*do nothing/)
  })

  it('matches normal first-contact delivery and body contracts, exempting only the Discovery answer', () => {
    const body = functionBody('admin_send_first_letter(p_member_id uuid, p_body text)', 'revoke all on function public.admin_send_first_letter')
    expect(body).toContain('v_deliver_at := now()')
    expect(body).toContain("v_expires_at := v_deliver_at + interval '72 hours'")
    expect(body).toContain('question_answer_id, correspondence_id')
    expect(body).toMatch(/p_body,\s*v_deliver_at,\s*v_expires_at/)
    expect(body).not.toContain('question_answers')
    expect(body).not.toContain('char_length(')
    expect(body).not.toContain('4000')
  })

  it('records only correspondence and letter identifiers in the Admin audit entry', () => {
    const body = functionBody('admin_send_first_letter(p_member_id uuid, p_body text)', 'revoke all on function public.admin_send_first_letter')
    const audit = body.slice(body.indexOf('insert into public.admin_audit_log'))
    expect(audit).toContain("jsonb_build_object('correspondence_id', v_correspondence_id, 'letter_id', v_new_id)")
    expect(audit).not.toContain('p_body')
    expect(audit).not.toContain('v_body')
    expect(audit).not.toMatch(/['"]body['"]/)
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
  it('contains no mutating SQL and checks lifecycle, security, Mark recovery, storage, and privacy contracts', () => {
    expect(verify).not.toMatch(/^\s*(insert|update|delete|alter|create|drop|grant|revoke|truncate)\b/im)
    for (const marker of [
      'open_index_pending_and_active',
      'new_correspondences_start_pending',
      'correspondence_statuses_exact',
      'all_owned_by_postgres',
      'all_security_definer',
      'all_restrict_search_path',
      'public_cannot_execute',
      'ordinary_contact_conflict_safe_open_episode_resolution',
      'ordinary_contact_pending_reused_active_rejected',
      'ordinary_contact_has_no_active_only_conflict_path',
      'first_mark_exempt_at_reservation',
      'first_mark_exempt_at_finalization',
      'idempotent_retry_precedes_cooldown',
      'reservation_and_finalization_owner_scoped',
      'one_pending_mark_per_owner',
      'one_active_mark_per_owner',
      'owner_checked_insert_policy',
      'no_mark_object_overwrite_policy',
      'conflict_safe_open_episode_resolution',
      'pending_reused_active_rejected',
      'first_contact_delivery_window_preserved',
      'audit_has_identifiers_not_private_body',
      'reply_requires_delivered_recipient_letter',
      'first_reply_requires_unexpired_root',
      'first_reply_establishes_correspondence',
      'no_staff_private_row_bypass',
      'correspondence_policy_is_participant_only',
      'letter_policy_is_participant_and_delivery_scoped',
      'no_direct_correspondence_writes',
      'no_direct_letter_writes',
    ]) expect(verify).toContain(marker)
  })

  it('cannot silently regress back to the obsolete active-only correspondence index', () => {
    expect(verify).toContain("i.relname = 'correspondences_one_open_per_pair'")
    expect(verify.match(/pg_catalog\.pg_get_expr\(x\.indpred, x\.indrelid, false\)/g)).toHaveLength(3)
    expect(verify).not.toContain('pg_catalog.pg_get_expr(x.indpred, x.indrelid, true)')
    expect(verify).toContain("'(status = ANY (ARRAY[''pending''::text, ''active''::text]))'")
    expect(verify).toContain("'(status = ''pending''::text)'")
    expect(verify).toContain("'(status = ''active''::text)'")
    expect(verify).toContain("'CHECK (status = ANY (ARRAY[''pending''::text, ''active''::text, ''closed''::text]))'")
    expect(verify).not.toMatch(/pg_get_expr\([^\n]+\)\s+(?:i?like|~)/i)
    expect(verify).not.toContain('correspondences_one_active_per_pair')
  })

  it('cannot accept an active-only ordinary first-contact implementation', () => {
    expect(verify).toContain("'public.send_first_letter(uuid,uuid,text)'::regprocedure")
    expect(verify).toContain("where status = any (array[''pending''::text, ''active''::text])")
    expect(verify).toContain("c.status in (''pending'', ''active'')")
    expect(verify).toContain("def not ilike '%where status = ''active''%do nothing%'")
  })

  it('keeps Mark object deletion limited to retired or explicitly discarded Marks', () => {
    expect(verify).toContain("pm.status in (''retired'', ''discarded'')")
    expect(verify).not.toContain("pm.status in (''pending'', ''discarded'')")
  })
})
