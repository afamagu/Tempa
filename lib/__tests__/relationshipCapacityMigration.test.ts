import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const MIGRATION_PATH = path.join(
  __dirname,
  '..',
  '..',
  'docs',
  'sql',
  '2026-10-04-phase1-relationship-capacity.sql'
)
const VERIFY_PATH = path.join(
  __dirname,
  '..',
  '..',
  'docs',
  'sql',
  '2026-10-04-phase1-relationship-capacity-verify.sql'
)

const sql = readFileSync(MIGRATION_PATH, 'utf8')
const verifySql = readFileSync(VERIFY_PATH, 'utf8')

function stripLineComments(text: string): string {
  return text.replace(/^\s*--.*$/gm, '')
}

function extractFunctionBody(qualifiedName: string): string {
  const start = sql.indexOf(`create or replace function ${qualifiedName}(`)
  expect(start, `expected ${qualifiedName} in ${MIGRATION_PATH}`).toBeGreaterThan(-1)
  const end = sql.indexOf('$function$;', start)
  expect(end, `expected closing $function$ for ${qualifiedName}`).toBeGreaterThan(start)
  return sql.slice(start, end)
}

const codeOnly = stripLineComments(sql)

describe('Phase 1 relationship capacity migration', () => {
  it('is one forward transaction and explicitly requires production review', () => {
    expect((sql.match(/^begin;/gm) ?? []).length).toBe(1)
    expect((sql.match(/^commit;/gm) ?? []).length).toBe(1)
    expect(sql).toContain('PREPARED 2026-10-04. REVIEW BEFORE PRODUCTION EXECUTION.')
  })

  it('keeps the pilot default at five and experiment overrides between five and ten', () => {
    const state = extractFunctionBody('tempa_private.relationship_capacity_state')
    expect(state).toMatch(/\),\s*\n\s*5\s*\n\s*\) as active_limit/)
    expect(codeOnly).toContain('check (active_correspondence_limit between 5 and 10)')
    expect(sql).toContain('Not a billing or subscription table.')
  })

  it('has separate two-outgoing and two-incoming first-letter limits', () => {
    const state = extractFunctionBody('tempa_private.relationship_capacity_state')
    expect(state).toMatch(/greatest\(lim\.active_limit - \(est\.n \+ outp\.n\), 0\),\s*\n\s*2,\s*\n\s*2/)

    const firstContact = extractFunctionBody('tempa_private.enforce_first_contact_capacity')
    expect(firstContact).toContain('v_sender.outgoing_pending_count >= v_sender.outgoing_pending_limit')
    expect(firstContact).toContain('v_recipient.incoming_pending_count >= v_recipient.incoming_pending_limit')
  })

  it('counts established plus OUTGOING pending as committed capacity, never incoming pending', () => {
    const state = extractFunctionBody('tempa_private.relationship_capacity_state')
    expect(state).toContain('est.n + outp.n,')
    expect(state).toContain('lim.active_limit - (est.n + outp.n)')
    expect(state).not.toMatch(/est\.n\s*\+\s*outp\.n\s*\+\s*inp\.n/)
  })

  it('recognizes only live unresolved first-contact roots as pending', () => {
    const state = extractFunctionBody('tempa_private.relationship_capacity_state')
    expect(state).toContain('l.reply_to_id is null')
    expect(state).toContain('l.question_answer_id is not null')
    expect(state).toContain("l.status = 'sent'")
    expect(state).toContain('l.expires_at > now()')
    expect(state).toContain("c.status = 'pending'")
    expect(state).toContain('c.established_at is null')
  })

  it('serializes per-member capacity changes with transaction advisory locks', () => {
    const single = extractFunctionBody('tempa_private.lock_relationship_capacity')
    const pair = extractFunctionBody('tempa_private.lock_relationship_capacity_pair')
    expect(single).toContain('pg_catalog.pg_advisory_xact_lock(')
    expect(single).toContain("'tempa:relationship-capacity:'")
    expect(pair).toContain('v_low := least(p_user_a, p_user_b);')
    expect(pair).toContain('v_high := greatest(p_user_a, p_user_b);')
    expect(pair.indexOf('lock_relationship_capacity(v_low)')).toBeLessThan(
      pair.indexOf('lock_relationship_capacity(v_high)')
    )
  })

  it('enforces first-contact limits at the Letter insert chokepoint, not only in UI/RPC code', () => {
    expect(codeOnly).toContain('create trigger letters_enforce_first_contact_capacity')
    expect(codeOnly).toContain('before insert on public.letters')
    expect(codeOnly).toContain('execute function tempa_private.enforce_first_contact_capacity();')

    const firstContact = extractFunctionBody('tempa_private.enforce_first_contact_capacity')
    expect(firstContact).toContain('new.reply_to_id is not null or new.question_answer_id is null')
    expect(firstContact).toContain('lock_relationship_capacity_pair(new.sender_id, new.recipient_id)')
    expect(firstContact).toContain('v_sender.committed_count >= v_sender.active_limit')
    expect(firstContact).not.toContain('v_recipient.committed_count')
  })

  it('makes incoming first contact independent of recipient active capacity', () => {
    const firstContact = extractFunctionBody('tempa_private.enforce_first_contact_capacity')
    const recipientState = firstContact.indexOf('select * into v_recipient')
    expect(recipientState).toBeGreaterThan(-1)
    const recipientBlock = firstContact.slice(recipientState)
    expect(recipientBlock).toContain('v_recipient.incoming_pending_count')
    expect(recipientBlock).not.toContain('v_recipient.committed_count')
    expect(recipientBlock).not.toContain('v_recipient.active_limit')
  })

  it('checks recipient capacity exactly when the first reciprocal reply establishes the correspondence', () => {
    expect(codeOnly).toContain('create trigger correspondences_enforce_establishment_capacity')
    expect(codeOnly).toContain('before update of status, established_at on public.correspondences')

    const establishment = extractFunctionBody(
      'tempa_private.enforce_correspondence_establishment_capacity'
    )
    expect(establishment).toContain("old.status = 'pending'")
    expect(establishment).toContain('old.established_at is null')
    expect(establishment).toContain("new.status = 'active'")
    expect(establishment).toContain('new.established_at is not null')
    expect(establishment).toContain('v_state.committed_count >= v_state.active_limit')
  })

  it('does not double-charge a crossed first contact that already reserved the accepting member slot', () => {
    const establishment = extractFunctionBody(
      'tempa_private.enforce_correspondence_establishment_capacity'
    )
    expect(establishment).toContain('v_has_reserved_slot boolean := false;')
    expect(establishment).toContain('l.correspondence_id = old.id')
    expect(establishment).toContain('l.sender_id = v_accepting_user')
    expect(establishment).toContain('if not v_has_reserved_slot then')
  })

  it('grandfathers existing established relationships by gating only new first contact and pending-to-active establishment', () => {
    const memberRpc = extractFunctionBody('public.get_relationship_capacity')
    expect(memberRpc).toContain('s.established_count > s.active_limit')

    const establishment = extractFunctionBody(
      'tempa_private.enforce_correspondence_establishment_capacity'
    )
    expect(establishment).toContain("old.status = 'pending'")
    expect(establishment).not.toContain("old.status = 'active'")

    // No write_letter replacement belongs in this migration: continuing an
    // already-established relationship is intentionally outside the gate.
    expect(codeOnly).not.toContain('create or replace function public.write_letter(')
  })

  it('exposes one caller-only canonical capacity RPC and keeps experiment overrides off client roles', () => {
    const memberRpc = extractFunctionBody('public.get_relationship_capacity')
    expect(memberRpc).toContain('if auth.uid() is null then')
    expect(memberRpc).toContain('tempa_private.relationship_capacity_state(auth.uid())')
    expect(codeOnly).toContain(
      'grant execute on function public.get_relationship_capacity() to authenticated;'
    )
    expect(codeOnly).toContain(
      'revoke all on table public.correspondence_capacity_overrides from public, anon, authenticated;'
    )
  })
})

describe('Phase 1 relationship capacity verifier', () => {
  it('is read-only and ends with an overall_pass aggregate', () => {
    const verifyCode = stripLineComments(verifySql).toLowerCase()
    expect(verifyCode).not.toMatch(/\binsert\s+into\b/)
    expect(verifyCode).not.toMatch(/\bupdate\s+public\./)
    expect(verifyCode).not.toMatch(/\bdelete\s+from\b/)
    expect(verifyCode).not.toMatch(/\bdrop\s+(table|function|trigger|index)\b/)
    expect(verifyCode).not.toMatch(/\bcreate\s+(table|function|trigger|index)\b/)
    expect(verifySql).toContain('overall_pass')
  })

  it('checks all canonical functions, both enforcement triggers, RLS and client grants', () => {
    for (const required of [
      'correspondence_capacity_overrides',
      'relationship_capacity_state',
      'get_relationship_capacity',
      'lock_relationship_capacity',
      'lock_relationship_capacity_pair',
      'enforce_first_contact_capacity',
      'enforce_correspondence_establishment_capacity',
      'letters_enforce_first_contact_capacity',
      'correspondences_enforce_establishment_capacity',
      'overall_pass',
    ]) {
      expect(verifySql).toContain(required)
    }
    expect(verifySql).toContain('relrowsecurity')
    expect(verifySql).toContain("has_function_privilege('authenticated'")
    expect(verifySql).toContain("has_function_privilege('anon'")
  })
})
