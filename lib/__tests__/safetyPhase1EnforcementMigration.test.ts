// Same convention as the other Safety migration tests — this repository
// cannot execute Postgres in CI, so the tracked SQL source is inspected
// directly. (The migration itself WAS executed against a real PostgreSQL
// engine — PGlite, outside the repo — on top of the real persistence and
// 42702-repair migrations; the scenario proofs are listed in the Phase 1
// hand-off report: same-recipient rewrites, three-distinct-context
// restriction, chokepoint, restore/re-restrict, contact note, admin
// review, ban visibility, retention. The verifier read overall_pass=true.)

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { FINANCIAL_SOLICITATION_REASON_CODES } from '../safety/reason-codes'

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'sql')
const read = (name: string) => readFileSync(path.join(SQL_DIR, name), 'utf8').replace(/\r\n/g, '\n')

const persistence = read('2026-10-03-safety-persistence.sql')
const repair = read('2026-10-11-safety-record-evaluation-conflict-fix.sql')
const ck8 = read('2026-10-09-safety-checkpoint8-graduated-interventions.sql')
const migration = read('2026-10-12-safety-phase1-enforcement.sql')
const verify = read('2026-10-12-safety-phase1-enforcement-verify.sql')

const stripLineComments = (text: string) => text.replace(/^\s*--.*$/gm, '')

function extractFunction(sql: string, header: string, terminator = '\n$function$;'): string {
  const start = sql.indexOf(header)
  expect(start, `header ${header}`).toBeGreaterThan(-1)
  const end = sql.indexOf(terminator, start)
  expect(end).toBeGreaterThan(start)
  return sql.slice(start, end + terminator.length)
}

/** Every canonical line must still appear, in order, in the migration's
 * copy — i.e. the reproduction only ADDED lines around the canonical
 * body, it never silently dropped or reworded any. */
function isOrderedSubsequence(canonical: string, replacement: string): { ok: boolean; missing?: string } {
  const target = replacement.split('\n')
  let cursor = 0
  for (const line of canonical.split('\n')) {
    const found = target.indexOf(line, cursor)
    if (found < 0) return { ok: false, missing: line }
    cursor = found + 1
  }
  return { ok: true }
}

describe('Phase 1 enforcement migration — forward-only, no historical edits', () => {
  it('is a new migration: one begin/commit, marked NOT EXECUTED, documents run order', () => {
    expect((migration.match(/^begin;/gm) ?? []).length).toBe(1)
    expect((migration.match(/^commit;/gm) ?? []).length).toBe(1)
    expect(migration).toContain('STATUS: NOT EXECUTED')
    expect(migration).toContain('2026-10-12-safety-phase1-enforcement-verify.sql')
    expect(migration.toLowerCase()).toContain('forward-only')
  })

  it('never drops or deletes data: the only DROP is the one question_answers policy it immediately recreates', () => {
    const code = stripLineComments(migration).toLowerCase()
    // Function bodies legitimately contain delete (the retention cleanup); look only at top-level DDL by
    // removing every $function$...$function$ and $$...$$ body first.
    const topLevel = code.replace(/\$function\$[\s\S]*?\$function\$/g, '').replace(/\$\$[\s\S]*?\$\$/g, '')
    expect(topLevel).not.toMatch(/\bdrop\s+(table|column|function|schema|view|index|constraint|trigger)\b/)
    expect(topLevel).not.toMatch(/\btruncate\s+(?:table\s+)?[a-z_.]+\s*;/)
    expect(topLevel).not.toMatch(/\bdelete\s+from\b/)
    const drops = topLevel.match(/\bdrop\s+policy\b[^;]*;/g) ?? []
    expect(drops.some((d) => d.includes('answers to active questions are readable by authenticated users'))).toBe(true)
    expect(drops.filter((d) => !d.includes('if exists'))).toHaveLength(1)
  })

  it('does not alter any existing table definition (only creates new ones)', () => {
    const code = stripLineComments(migration).toLowerCase()
    expect(code).not.toMatch(/\balter\s+table\s+public\.(safety_evaluations|safety_signals|safety_cases|account_enforcement_state|letters)\b/)
  })
})

describe('reused definitions are reproduced from canonical, with only the documented additions', () => {
  it('record_safety_evaluation keeps the 42702 repair and every canonical line', () => {
    const header = 'create or replace function public.record_safety_evaluation('
    const canonical = extractFunction(repair, header)
    const mine = extractFunction(migration, header)
    expect(isOrderedSubsequence(canonical, mine)).toEqual({ ok: true })
    expect(mine).toContain('on conflict on constraint safety_signals_evaluation_id_key do nothing;')
    expect(mine).not.toMatch(/on conflict \(evaluation_id\) do nothing/i)
    expect(mine).toContain('insert into public.safety_attempt_evidence')
    // Evidence is written BEFORE the behavioural check that counts it.
    expect(mine.indexOf('insert into public.safety_attempt_evidence')).toBeLessThan(mine.indexOf('perform tempa_private.evaluate_behavior('))
  })

  it('consume_safety_evaluation keeps every canonical line; adds the status chokepoint and the contact note', () => {
    const header = 'create or replace function tempa_private.consume_safety_evaluation('
    const mine = extractFunction(migration, header)
    expect(isOrderedSubsequence(extractFunction(persistence, header), mine)).toEqual({ ok: true })
    expect(mine).toMatch(/in \('restricted', 'suspended', 'banned'\)/)
    expect(mine).toContain("raise exception 'This action is not available right now.' using errcode = '42501'")
    // the gate runs before the evaluation is consumed
    expect(mine.indexOf("in ('restricted', 'suspended', 'banned')")).toBeLessThan(mine.indexOf('consumed_at = now()'))
    expect(mine).toContain('insert into public.letter_safety_notices')
  })

  it('admin_set_account_status keeps every Checkpoint 8 line and only adds official notices', () => {
    const header = 'create or replace function public.admin_set_account_status('
    const mine = extractFunction(migration, header)
    expect(isOrderedSubsequence(extractFunction(ck8, header), mine)).toEqual({ ok: true })
    expect(mine).toContain("'restriction_applied'")
    expect(mine).toContain("'restriction_lifted'")
    expect(mine).toContain("'permanent_decision'")
  })

  it('cleanup keeps every canonical line and never purges evidence of an enforced account', () => {
    const header = 'create or replace function public.cleanup_expired_safety_evaluations('
    const mine = extractFunction(migration, header)
    expect(isOrderedSubsequence(extractFunction(persistence, header), mine)).toEqual({ ok: true })
    expect(mine).toContain("st.status in ('restricted', 'suspended', 'banned')")
  })

  it('evaluate_behavior is canonical except the REPEATED_SOLICITATION block', () => {
    const header = 'create or replace function tempa_private.evaluate_behavior('
    const canonical = extractFunction(persistence, header)
    const mine = extractFunction(migration, header)
    const startMarker = '  if p_new_content_reason_codes is not null'
    const endMarker = '  if p_report_check then'
    const cs = canonical.indexOf(startMarker)
    const ms = mine.indexOf(startMarker)
    expect(mine.slice(0, ms).replace('  v_last_status_reset timestamptz;\n', '')).toBe(canonical.slice(0, cs))
    expect(mine.slice(mine.indexOf(endMarker))).toBe(canonical.slice(canonical.indexOf(endMarker)))
  })
})

describe('the locked automatic-restriction rule', () => {
  const behavior = extractFunction(migration, 'create or replace function tempa_private.evaluate_behavior(')
  const restriction = extractFunction(migration, 'create or replace function tempa_private.apply_pending_review_restriction(')

  it('counts DISTINCT recipient/correspondence contexts of QUALIFYING attempts inside the rolling policy window', () => {
    expect(behavior).toContain('count(distinct e.target_key)')
    expect(behavior).toContain('e.qualifying')
    expect(behavior).toContain('v_policy.repeated_solicitation_window')
    expect(behavior).toContain('v_policy.repeated_solicitation_distinct_contexts_threshold')
  })

  it('the policy this reuses is exactly 72 hours / 3 contexts (not redefined here)', () => {
    expect(persistence).toContain("interval '72 hours', 3, 'high', true,")
    expect(stripLineComments(migration)).not.toContain('create or replace function tempa_private.behavior_policy')
  })

  it('restricts only an ACTIVE account, never downgrades suspended/banned, never touches staff, never bans', () => {
    expect(restriction).toContain("where public.account_enforcement_state.status = 'active'")
    expect(restriction).toContain('from public.staff_roles')
    expect(restriction).toContain("'restricted'")
    expect(restriction).not.toMatch(/'banned'|'suspended'/)
  })

  it('marks the restriction as system-applied (changed_by NULL) and audits it with a system actor', () => {
    expect(restriction).toMatch(/null, now\(\)\s*\)/)
    expect(restriction).toContain("'system:automatic-restriction'")
    expect(restriction).toContain("'automatic_restriction_pending_review'")
  })

  it('issues the official restriction notice with the locked wording', () => {
    const unescaped = restriction.replace(/''/g, "'")
    expect(unescaped).toContain("We've temporarily restricted your account while we review activity that may conflict with Tempa's safety rules.")
    expect(unescaped).toContain('This is a temporary safety measure, not a final decision.')
  })

  it('an attempt made before the last restore-to-active is not counted again', () => {
    expect(behavior).toContain('v_last_status_reset')
  })

  it('the SQL solicitation code set matches the TypeScript one, excluding off-platform/contact codes', () => {
    const fn = extractFunction(migration, 'create or replace function tempa_private.solicitation_reason_codes()', '\n$$;')
    const sqlCodes = Array.from(fn.matchAll(/'([A-Z_]+)'/g)).map((m) => m[1]).sort()
    expect(sqlCodes).toEqual([...FINANCIAL_SOLICITATION_REASON_CODES].sort())
    expect(sqlCodes).not.toContain('OFF_PLATFORM_ESCALATION')
    expect(sqlCodes).not.toContain('PERSONAL_CONTACT_SHARING')
  })
})

describe('evidence, notices and admin access — privacy boundary', () => {
  it('the attempt-evidence table has RLS, no policy, no client grant', () => {
    const code = stripLineComments(migration)
    expect(code).toContain('alter table public.safety_attempt_evidence enable row level security;')
    expect(code).toContain('revoke all on public.safety_attempt_evidence from public, anon, authenticated;')
    expect(code).not.toMatch(/create policy \w+\s+on public\.safety_attempt_evidence/)
    expect(code).not.toMatch(/grant [^;]* on public\.safety_attempt_evidence to/)
  })

  it('member notices are read-only to their owner; letter notices only to the letter recipient', () => {
    const code = stripLineComments(migration)
    expect(code).toContain('grant select on public.member_notices to authenticated;')
    expect(code).not.toMatch(/grant (insert|update|delete|all)[^;]* on public\.member_notices/)
    expect(code).toContain('and l.recipient_id = auth.uid()')
    expect(code).not.toMatch(/grant (insert|update|delete|all)[^;]* on public\.letter_safety_notices/)
  })

  it('the admin review RPC is staff-gated as its first statement, takes only a case id, hides recipient identity and is audited', () => {
    const fn = extractFunction(migration, 'create or replace function public.admin_get_safety_case_review(')
    expect(fn).toMatch(/begin\n  if not public\.is_staff\(\) then\n    raise exception 'Not authorized\.';/)
    expect(fn).toContain('(p_case_id uuid)')
    expect(fn).toContain("'Person ' || chr(64")
    expect(fn).not.toMatch(/'recipient_id'|'target_key'/)
    expect(fn).toContain("'view_safety_attempt_evidence'")
    const code = stripLineComments(migration)
    expect(code).toContain('grant execute on function public.admin_get_safety_case_review(uuid) to authenticated;')
  })

  it('discovery exclusion is applied to the People policy, recommendations and (banned) public profiles', () => {
    expect(migration).toContain('and not tempa_private.hidden_from_discovery(auth.uid(), question_answers.user_id)')
    expect(migration).toContain('and not tempa_private.hidden_from_discovery(auth.uid(), qa.user_id)')
    expect(migration).toContain('and not tempa_private.account_is_banned(p.id)')
  })

  it('target keys resolve private-letter surfaces to the OTHER PERSON, so rewriting to one person is one context', () => {
    const fn = extractFunction(migration, 'create or replace function tempa_private.safety_target_key(')
    expect((fn.match(/'person:'/g) ?? []).length).toBe(3)
  })
})

describe('Phase 1 verifier — read-only and covers the boundary', () => {
  it('is read-only', () => {
    const code = stripLineComments(verify).replace(/'[^']*'/g, "''").toLowerCase()
    expect(code).not.toMatch(/\binsert\s+into\b/)
    expect(code).not.toMatch(/\bupdate\s+\w/)
    expect(code).not.toMatch(/\bdelete\s+from\b/)
    expect(code).not.toMatch(/\b(drop|alter|create|truncate|grant|revoke)\b/)
  })

  it('reports a single overall_pass covering tables, RLS, functions, definitions, policy and grants', () => {
    for (const name of [
      'evidence_rls_enabled', 'evidence_has_no_policies', 'notices_select_own_policy', 'letter_notices_fk_deferred',
      'restriction_function_present', 'review_rpc_present', 'behavior_counts_distinct_targets', 'record_keeps_42702_repair',
      'consume_blocks_restricted', 'set_status_writes_notices', 'discovery_policy_excludes_hidden',
      'review_is_staff_gated', 'record_not_for_authenticated', 'overall_pass',
    ]) {
      expect(verify).toContain(name)
    }
  })
})
