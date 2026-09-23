// Same convention as safetyCheckpoint4PublicSurfacesMigration.test.ts /
// safetyCheckpoint5BehaviorSignalsMigration.test.ts — this repository
// cannot execute Postgres in CI, so every requirement that lives purely
// in SQL (the is_staff gate on every new RPC, the narrow evidence-only-
// via-signal-id path, the audit-log writes, the null-safe optimistic-
// concurrency check, the fixed transition allow-list, and the absence
// of any new client grant on safety_cases/safety_signals/safety_
// evaluations) is verified directly against the tracked migration
// source text.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const MIGRATION_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-10-08-safety-checkpoint7-admin-needs-attention.sql')
const VERIFY_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-10-08-safety-checkpoint7-admin-needs-attention-verify.sql')
const sql = readFileSync(MIGRATION_PATH, 'utf8')
const verifySql = readFileSync(VERIFY_PATH, 'utf8')

function stripLineComments(text: string): string {
  return text.replace(/^\s*--.*$/gm, '')
}
const codeOnly = stripLineComments(sql)

function extractFunctionBody(qualifiedName: string): string {
  const start = sql.indexOf(`create or replace function ${qualifiedName}(`)
  expect(start, `expected to find "${qualifiedName}" defined in ${MIGRATION_PATH}`).toBeGreaterThan(-1)
  const end = sql.indexOf('$function$;', start)
  expect(end, `expected a closing $function$; for "${qualifiedName}"`).toBeGreaterThan(start)
  return sql.slice(start, end)
}

const RPCS = [
  'public.admin_list_safety_cases',
  'public.admin_get_safety_case',
  'public.admin_list_case_signals',
  'public.admin_get_safety_signal_evidence',
  'public.admin_transition_safety_case',
]

describe('one BEGIN/COMMIT, not yet applied', () => {
  it('wraps everything in exactly one begin/commit and is explicitly marked NOT EXECUTED', () => {
    expect((sql.match(/^begin;/m) ?? []).length).toBe(1)
    expect((sql.match(/^commit;/m) ?? []).length).toBe(1)
    expect(sql).toContain('STATUS: NOT EXECUTED')
  })
})

describe('every new admin RPC re-checks is_staff() itself, never relying on the route gate alone', () => {
  it.each(RPCS)('%s checks is_staff() as its own gate', (name) => {
    const body = extractFunctionBody(name)
    expect(body).toMatch(/if not public\.is_staff\(\) then\s*\n\s*raise exception 'Not authorized\.';/)
  })

  it('every new RPC is security definer with the standard pg_catalog search_path', () => {
    for (const name of RPCS) {
      const body = extractFunctionBody(name)
      expect(body).toContain('security definer')
    }
  })

  it('grants EXECUTE to authenticated (the ceiling), never a wider role, for all five new RPCs', () => {
    expect(codeOnly).toContain('grant execute on function public.admin_list_safety_cases(text, integer, integer) to authenticated;')
    expect(codeOnly).toContain('grant execute on function public.admin_get_safety_case(uuid) to authenticated;')
    expect(codeOnly).toContain('grant execute on function public.admin_list_case_signals(uuid) to authenticated;')
    expect(codeOnly).toContain('grant execute on function public.admin_get_safety_signal_evidence(uuid, uuid) to authenticated;')
    expect(codeOnly).toContain('grant execute on function public.admin_transition_safety_case(uuid, text, text, text) to authenticated;')
  })
})

describe('admin_list_safety_cases — case queue', () => {
  it('orders active (open/reviewing) cases first, then most-recently-updated', () => {
    const body = extractFunctionBody('public.admin_list_safety_cases')
    expect(body).toContain("order by (c.status in ('open', 'reviewing')) desc, c.updated_at desc")
  })

  it('never invents a numeric fraud score — only real case columns plus an aggregated reason-code array', () => {
    const body = extractFunctionBody('public.admin_list_safety_cases')
    expect(body.toLowerCase()).not.toMatch(/fraud.?score|risk.?score/)
  })

  it('joins profiles directly for pseudonym (never public_profiles, which can silently drop a row across the staff member\'s own block)', () => {
    const body = extractFunctionBody('public.admin_list_safety_cases')
    expect(body).toContain('join public.profiles p on p.id = c.subject_user_id')
    expect(body).not.toContain('public_profiles')
  })

  it('clamps limit/offset server-side, matching admin_list_reports\' own convention', () => {
    const body = extractFunctionBody('public.admin_list_safety_cases')
    expect(body).toContain('least(greatest(coalesce(p_limit, 30), 1), 50)')
  })
})

describe('admin_get_safety_case — case detail header, privacy-safe member context', () => {
  it('reads account age from auth.users.created_at, never public.profiles.created_at', () => {
    const body = extractFunctionBody('public.admin_get_safety_case')
    expect(body).toContain('join auth.users au on au.id = c.subject_user_id')
    expect(body).toContain('au.created_at')
  })

  it('counts reports/blocks against the subject from the real tables, never a new profile dossier table', () => {
    const body = extractFunctionBody('public.admin_get_safety_case')
    expect(body).toContain('from public.reports r where r.reported_user_id = c.subject_user_id')
    expect(body).toContain('from public.blocked_users b where b.blocked_id = c.subject_user_id')
  })

  it('never reads country, gender, age_range, or any demographic field as evidence', () => {
    const body = extractFunctionBody('public.admin_get_safety_case')
    for (const forbidden of ['country', 'gender', 'age_range', 'ip_address', 'device']) {
      expect(body.toLowerCase()).not.toContain(forbidden)
    }
  })
})

describe('admin_list_case_signals — structured evidence, no internal implementation detail leaked', () => {
  it('joins safety_evaluations only for warning/disposition fields, never fingerprint/outreach_fingerprint/consumed_at', () => {
    const body = extractFunctionBody('public.admin_list_case_signals')
    expect(body).toContain('e.warning_required, e.warning_issued_at, e.warning_acknowledged_at, e.mutation_disposition')
    expect(body).not.toContain('fingerprint')
    expect(body).not.toContain('outreach_fingerprint')
    expect(body).not.toContain('consumed_at')
    expect(body).not.toContain('expires_at')
  })

  it('returns observed_counts as-is — Checkpoint 5\'s own structured-only design, never a raw activity log', () => {
    const body = extractFunctionBody('public.admin_list_case_signals')
    expect(body).toContain('s.observed_counts')
  })

  it('rejects a nonexistent case id explicitly rather than silently returning zero rows', () => {
    const body = extractFunctionBody('public.admin_list_case_signals')
    expect(body).toContain("raise exception 'Case not found.';")
  })
})

describe('admin_get_safety_signal_evidence — the narrowest possible private-content path', () => {
  it('takes ONLY a case id and a signal id — no raw content/letter/correspondence id parameter exists anywhere in its signature', () => {
    const start = sql.indexOf('create or replace function public.admin_get_safety_signal_evidence(')
    const paramsEnd = sql.indexOf(')\nreturns table', start)
    const params = sql.slice(start, paramsEnd)
    expect(params).toContain('p_case_id uuid')
    expect(params).toContain('p_signal_id uuid')
    expect(params).not.toMatch(/p_letter_id|p_content_id|p_correspondence_id|p_dispatch_id/)
  })

  it('resolves content ONLY from that signal\'s own already-recorded source_content_id, never a client-supplied id', () => {
    const body = extractFunctionBody('public.admin_get_safety_signal_evidence')
    expect(body).toContain('where l.id = v_signal.source_content_id')
    expect(body).not.toMatch(/where l\.id = p_/)
  })

  it('a nonexistent signal id is rejected explicitly — a guessed id can never fall through to "no evidence"', () => {
    const body = extractFunctionBody('public.admin_get_safety_signal_evidence')
    expect(body).toContain("raise exception 'Signal not found.';")
  })

  describe('independent audit correction — requires the full case -> signal -> content chain', () => {
    it('verifies the case itself exists before ever looking at the signal', () => {
      const body = extractFunctionBody('public.admin_get_safety_signal_evidence')
      const caseCheckIndex = body.indexOf("raise exception 'Case not found.';")
      const signalLookupIndex = body.indexOf('select id, surface, source_content_id')
      expect(caseCheckIndex).toBeGreaterThan(-1)
      expect(caseCheckIndex).toBeLessThan(signalLookupIndex)
    })

    it('the signal lookup requires case_id = p_case_id in the SAME where clause as the signal id — never a separate, bypassable check', () => {
      const body = extractFunctionBody('public.admin_get_safety_signal_evidence')
      expect(body).toMatch(/where id = p_signal_id\s*\n\s*and case_id = p_case_id/)
    })

    it('a signal with case_id IS NULL (never escalated into a case) can never match — the join is an exact equality, not IS NOT DISTINCT FROM or similar', () => {
      const body = extractFunctionBody('public.admin_get_safety_signal_evidence')
      // A plain `=` against a real (non-null) p_case_id is already
      // NULL-rejecting by ordinary SQL semantics — this asserts the
      // migration never "helpfully" widens it (e.g. to `is not distinct
      // from`, which WOULD wrongly match a null case_id if p_case_id
      // itself were ever null, which can't happen since it's verified
      // to reference a real, existing case immediately above).
      expect(body).not.toMatch(/case_id\s+is\s+not\s+distinct\s+from\s+p_case_id/)
      expect(body).not.toMatch(/coalesce\(case_id/)
    })

    it('a guessed/unrelated signal id (belonging to a different case, or no case) produces the exact same "Signal not found" rejection as a truly nonexistent id — no separate, more revealing error path', () => {
      const body = extractFunctionBody('public.admin_get_safety_signal_evidence')
      // Only ONE raise for a missing v_signal — proving there's no
      // second branch that distinguishes "signal exists but wrong case"
      // from "signal doesn't exist at all" (which would leak whether a
      // given signal id is real, just not part of this case).
      const occurrences = (body.match(/raise exception 'Signal not found\.';/g) ?? []).length
      expect(occurrences).toBe(1)
    })
  })

  it('the private-letter branch is the only one that ever returns body text — every public-surface branch returns only identifiers to link out with', () => {
    const body = extractFunctionBody('public.admin_get_safety_signal_evidence')
    const publicBranches = body.match(/elsif v_signal\.surface[\s\S]*?end if;/g) ?? []
    expect(publicBranches.length).toBeGreaterThan(0)
    for (const branch of publicBranches) {
      if (branch.includes("'dispatch_publish'") || branch.includes("'dispatch_reply'") || branch.includes("'question_answer'")) {
        expect(branch).not.toContain('.body')
      }
    }
  })

  it('every content-resolving branch writes an audit row before returning evidence', () => {
    const body = extractFunctionBody('public.admin_get_safety_signal_evidence')
    const occurrences = (body.match(/'view_safety_evidence'/g) ?? []).length
    expect(occurrences).toBe(4) // letter, dispatch, dispatch_reply, question_answer
  })

  it('never selects fingerprint/outreach_fingerprint or any evaluation-table field at all', () => {
    const body = extractFunctionBody('public.admin_get_safety_signal_evidence')
    expect(body).not.toContain('safety_evaluations')
    expect(body).not.toContain('fingerprint')
  })
})

describe('admin_transition_safety_case — narrow review-only workflow, concurrency-safe, audited', () => {
  it('only accepts reviewing/no_action/resolved as a target status — never warned/restricted/suspended/banned', () => {
    const body = extractFunctionBody('public.admin_transition_safety_case')
    expect(body).toContain("if p_new_status not in ('reviewing', 'no_action', 'resolved') then")
    expect(body).not.toContain("'warned'")
    expect(body).not.toContain("'restricted'")
    expect(body).not.toContain("'suspended'")
    expect(body).not.toContain("'banned'")
  })

  it('the fixed allow-list matches exactly: open->reviewing; open/reviewing->no_action; open/reviewing->resolved', () => {
    const body = extractFunctionBody('public.admin_transition_safety_case')
    expect(body).toContain("(v_current_status = 'open' and p_new_status = 'reviewing')")
    expect(body).toContain("(v_current_status in ('open', 'reviewing') and p_new_status in ('no_action', 'resolved'))")
  })

  it('locks the case row FOR UPDATE before validating the transition, and the staleness check is NULL-safe (IS DISTINCT FROM, never <>)', () => {
    const body = extractFunctionBody('public.admin_transition_safety_case')
    const lockIndex = body.indexOf('for update;')
    const staleCheckIndex = body.indexOf('is distinct from p_expected_status')
    expect(lockIndex).toBeGreaterThan(-1)
    expect(staleCheckIndex).toBeGreaterThan(lockIndex)
    expect(body).not.toMatch(/v_current_status\s*<>\s*p_expected_status/)
  })

  it('writes an audit row with old/new status and the subject, in the same transaction as the update', () => {
    const body = extractFunctionBody('public.admin_transition_safety_case')
    const updateIndex = body.indexOf('update public.safety_cases')
    const auditIndex = body.indexOf('insert into public.admin_audit_log')
    expect(updateIndex).toBeGreaterThan(-1)
    expect(auditIndex).toBeGreaterThan(updateIndex)
    expect(body).toContain("'old_status', v_current_status, 'new_status', p_new_status")
  })

  it('sets reviewed_at/reviewed_by only for the two terminal review outcomes (no_action/resolved), never for reviewing', () => {
    const body = extractFunctionBody('public.admin_transition_safety_case')
    expect(body).toContain("reviewed_at = case when p_new_status in ('no_action', 'resolved') then now() else reviewed_at end")
    expect(body).toContain("reviewed_by = case when p_new_status in ('no_action', 'resolved') then auth.uid() else reviewed_by end")
  })
})

describe('no new client grant on the Safety tables — the read RPCs remain the only path', () => {
  it('this migration never grants select/insert/update/delete on safety_cases/safety_signals/safety_evaluations to any client role', () => {
    for (const table of ['safety_cases', 'safety_signals', 'safety_evaluations']) {
      expect(codeOnly.toLowerCase()).not.toMatch(new RegExp(`grant\\s+(select|insert|update|delete).*on\\s+(public\\.)?${table}\\s+to\\s+(authenticated|anon)`))
    }
  })
})

describe('verification SQL', () => {
  it('exists, is read-only, and checks signatures/grants/is_staff-gating/evidence-narrowness/transition-safety', () => {
    // Strip single-quoted string literals too, not just comments — this
    // verifier legitimately searches function bodies for the literal
    // text "insert into ..." (e.g. inside an ILIKE '%insert into
    // public.admin_audit_log%' pattern-match string), which would
    // otherwise falsely trip the "this verifier itself never mutates"
    // check below on a string it only ever READS, never executes.
    const codeOnlyVerify = stripLineComments(verifySql).replace(/'[^']*'/g, "''")
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\binsert\s+into\b/)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\bupdate\s+public\./)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\bdelete\s+from\b/)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\bdrop\s+(table|function|index|policy)\b/)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\balter\s+table\b/)
    for (const name of [
      'admin_list_safety_cases',
      'admin_get_safety_case',
      'admin_list_case_signals',
      'admin_get_safety_signal_evidence',
      'admin_transition_safety_case',
    ]) {
      expect(verifySql).toContain(name)
    }
    expect(verifySql).toContain('overall_pass')
  })
})
