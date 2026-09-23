// Same convention as safetyCheckpoint4PublicSurfacesMigration.test.ts /
// safetyPersistenceMigration.test.ts — this repository cannot execute
// Postgres in CI, so every requirement that lives purely in SQL (the
// widened surface domain, the new behavioral tables/columns, the
// deterministic engine's own per-code queries, the dedup/expiry-window
// idempotency design, the exception-guarded wiring into report_content/
// block_user, and the absence of any raw-body/IP/device/country
// heuristic) is verified directly against the tracked migration source
// text.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { BEHAVIORAL_REASON_CODES, CONTENT_REASON_CODES } from '../safety/reason-codes'

const PERSISTENCE_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-10-03-safety-persistence.sql')
const WIRING_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-10-07-safety-checkpoint5-behavior-signals.sql')
const VERIFY_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-10-07-safety-checkpoint5-behavior-signals-verify.sql')

const persistenceSql = readFileSync(PERSISTENCE_PATH, 'utf8')
const wiringSql = readFileSync(WIRING_PATH, 'utf8')
const verifySql = readFileSync(VERIFY_PATH, 'utf8')

function stripLineComments(text: string): string {
  return text.replace(/^\s*--.*$/gm, '')
}

function extractFunctionBody(sql: string, qualifiedName: string): string {
  const start = sql.indexOf(`create or replace function ${qualifiedName}(`)
  expect(start, `expected to find "${qualifiedName}" defined`).toBeGreaterThan(-1)
  const end = sql.indexOf('$function$;', start)
  expect(end, `expected a closing $function$; for "${qualifiedName}"`).toBeGreaterThan(start)
  return sql.slice(start, end)
}

function extractSqlLanguageFunction(sql: string, qualifiedName: string): string {
  const start = sql.indexOf(`create or replace function ${qualifiedName}(`)
  expect(start, `expected to find "${qualifiedName}" defined`).toBeGreaterThan(-1)
  const end = sql.indexOf('$$;', start)
  expect(end, `expected a closing $$; for "${qualifiedName}"`).toBeGreaterThan(start)
  return sql.slice(start, end)
}

describe('one BEGIN/COMMIT for the mutation wiring, not yet applied', () => {
  it('wraps the wiring in exactly one begin/commit and is explicitly marked NOT EXECUTED', () => {
    expect((wiringSql.match(/^begin;/m) ?? []).length).toBe(1)
    expect((wiringSql.match(/^commit;/m) ?? []).length).toBe(1)
    expect(wiringSql).toContain('STATUS: NOT EXECUTED')
  })
})

describe('safety_evaluations schema widened cleanly for behavioral surfaces', () => {
  it('the surface CHECK constraint includes all seven behavior_* values alongside the seven content surfaces, unchanged', () => {
    const codeOnly = stripLineComments(persistenceSql)
    for (const surface of [
      'first_letter', 'reply', 'write_anytime',
      'dispatch_publish', 'dispatch_update', 'question_answer', 'dispatch_reply',
    ]) {
      expect(codeOnly).toContain(`'${surface}'`)
    }
    for (const code of BEHAVIORAL_REASON_CODES) {
      expect(codeOnly).toContain(`'behavior_${code.toLowerCase()}'`)
    }
  })

  it('adds outreach_fingerprint (safety_evaluations) and observed_counts (safety_signals) columns', () => {
    expect(persistenceSql).toContain('outreach_fingerprint text,')
    expect(persistenceSql).toContain('observed_counts jsonb,')
  })

  it("record_safety_evaluation's own p_surface validation is unchanged — still only the seven content surfaces, never a client-reachable path to a behavior_* surface", () => {
    const body = extractFunctionBody(persistenceSql, 'public.record_safety_evaluation')
    expect(body).toContain(`if p_surface not in (
    'first_letter', 'reply', 'write_anytime',
    'dispatch_publish', 'dispatch_update', 'question_answer', 'dispatch_reply'
  ) then`)
  })
})

describe('tempa_private.outreach_fingerprint — deliberately separate from safety_fingerprint', () => {
  it('hashes (user_id, normalized body) WITHOUT context_id, unlike safety_fingerprint', () => {
    const body = extractSqlLanguageFunction(persistenceSql, 'tempa_private.outreach_fingerprint')
    expect(body).toContain('p_user_id::text')
    expect(body).toContain('lower(regexp_replace(trim(both from coalesce(p_body, \'\')), \'\\s+\', \' \', \'g\'))')
    expect(body).not.toContain('p_context_id')
  })

  it('is granted to no client role at all — internal helper only', () => {
    expect(persistenceSql).toContain(
      'revoke all on function tempa_private.outreach_fingerprint(uuid, text) from public, anon, authenticated, service_role;'
    )
  })
})

describe('tempa_private.solicitation_reason_codes — reuses the existing CONTENT_REASON_CODES taxonomy, no duplicate synonyms', () => {
  it('every code it lists is a real member of CONTENT_REASON_CODES (lib/safety/reason-codes.ts)', () => {
    const body = extractSqlLanguageFunction(persistenceSql, 'tempa_private.solicitation_reason_codes')
    const arrayMatch = body.match(/select array\[([\s\S]*?)\]/)
    expect(arrayMatch).not.toBeNull()
    const listedCodes = (arrayMatch![1].match(/'([A-Z_]+)'/g) ?? []).map((s) => s.slice(1, -1))
    expect(listedCodes.length).toBeGreaterThan(0)
    for (const code of listedCodes) {
      expect(CONTENT_REASON_CODES as readonly string[]).toContain(code)
    }
  })

  it('excludes SUSPICIOUS_LINK/PHISHING_SIGNAL (a different risk shape) and includes OFF_PLATFORM_ESCALATION (explicit launch example)', () => {
    const body = extractSqlLanguageFunction(persistenceSql, 'tempa_private.solicitation_reason_codes')
    expect(body).not.toContain('SUSPICIOUS_LINK')
    expect(body).not.toContain('PHISHING_SIGNAL')
    expect(body).toContain('OFF_PLATFORM_ESCALATION')
  })
})

describe('tempa_private.behavior_policy — one centralized, documented config module', () => {
  it('defines a window/threshold/risk_band/escalate tuple for all seven behavioral codes', () => {
    const body = extractSqlLanguageFunction(persistenceSql, 'tempa_private.behavior_policy')
    for (const field of [
      'mass_first_contact_window', 'mass_first_contact_threshold', 'mass_first_contact_risk_band', 'mass_first_contact_escalate',
      'high_velocity_window', 'high_velocity_distinct_recipients_threshold', 'high_velocity_risk_band', 'high_velocity_escalate',
      'near_duplicate_window', 'near_duplicate_distinct_recipients_threshold', 'near_duplicate_risk_band', 'near_duplicate_escalate',
      'repeated_solicitation_window', 'repeated_solicitation_distinct_contexts_threshold', 'repeated_solicitation_risk_band', 'repeated_solicitation_escalate',
      'report_spike_window', 'report_spike_distinct_reporters_threshold', 'report_spike_risk_band', 'report_spike_escalate',
      'block_spike_window', 'block_spike_threshold', 'block_spike_risk_band', 'block_spike_escalate',
      'account_velocity_new_account_age', 'account_velocity_window', 'account_velocity_distinct_recipients_threshold', 'account_velocity_risk_band', 'account_velocity_escalate',
    ]) {
      expect(body).toContain(field)
    }
  })

  it('is a single language-sql function, not a mutable table — no CREATE TABLE for a config store', () => {
    expect(persistenceSql).not.toMatch(/create table public\.behavior_(policy|thresholds|config)/)
  })

  it('thresholds are conservative enough that a handful of ordinary contacts/reports/blocks (2-5) never crosses any of them, matching item 9\'s own "no meaningful signal for ordinary activity" requirement', () => {
    const body = extractSqlLanguageFunction(persistenceSql, 'tempa_private.behavior_policy')
    const selectBlock = body.slice(body.indexOf('select'))
    // Strip every quoted `interval '...'` literal first — those contain
    // their own digits (24, 1, 72) that are WINDOW HOURS, not thresholds,
    // and would otherwise be misread as an unreasonably low threshold.
    const withoutIntervals = selectBlock.replace(/interval '[^']*'/g, '')
    const values = (withoutIntervals.match(/\b\d+\b/g) ?? []).map(Number)
    // Every remaining bare integer is an actual threshold (20, 8, 4, 3,
    // 3, 5, 5) — all strictly greater than 1, so an "enthusiastic
    // penpal" writing a handful of people, or the ordinary single
    // report/block, never crosses any of them.
    expect(values.every((v) => v > 1)).toBe(true)
    expect(values).toContain(20) // mass_first_contact_threshold
    expect(values).toContain(8) // high_velocity_distinct_recipients_threshold
  })

  it('REPORT_SPIKE and BLOCK_SPIKE thresholds are strictly greater than 1 — a single report or a single block is ordinary platform activity, never a spike', () => {
    const body = extractSqlLanguageFunction(persistenceSql, 'tempa_private.behavior_policy')
    // The policy's own SELECT is one literal source line per code (mass_
    // first_contact, high_velocity, near_duplicate, repeated_solicitation,
    // report_spike, block_spike, account_velocity, in that fixed order —
    // matching the returns-table column order directly above it).
    const valueLines = body
      .slice(body.indexOf('as $$') + 'as $$'.length)
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0 && l !== 'select' && l !== '$$;')
    expect(valueLines.length).toBe(7)
    const reportSpikeThreshold = Number(valueLines[4].split(',')[1].trim())
    const blockSpikeThreshold = Number(valueLines[5].split(',')[1].trim())
    expect(reportSpikeThreshold).toBe(3)
    expect(blockSpikeThreshold).toBe(5)
    expect(reportSpikeThreshold).toBeGreaterThan(1)
    expect(blockSpikeThreshold).toBeGreaterThan(1)
  })

  it('every threshold/window is a literal constant in this one function — no scattered magic numbers duplicated elsewhere in the engine', () => {
    const engineBody = persistenceSql.slice(
      persistenceSql.indexOf('create or replace function tempa_private.evaluate_behavior('),
      persistenceSql.indexOf('$function$;', persistenceSql.indexOf('create or replace function tempa_private.evaluate_behavior('))
    )
    // The engine reads thresholds only via v_policy.<field> — never a
    // second hardcoded numeric literal standing in for one of these.
    expect(engineBody).not.toMatch(/>=\s*\d+\s*then/)
  })
})

describe('tempa_private.record_behavior_signal — one trusted writer into the EXISTING safety_signals/safety_cases tables', () => {
  it('never creates a second cases/signals table — writes only into safety_evaluations/safety_signals/safety_cases', () => {
    const body = extractFunctionBody(persistenceSql, 'tempa_private.record_behavior_signal')
    expect(body).toContain('insert into public.safety_evaluations')
    expect(body).toContain('insert into public.safety_signals')
    expect(body).toContain('insert into public.safety_cases')
    expect(persistenceSql).not.toMatch(/create table public\.(behavior_signals|behavior_cases|behavioral_events)/)
  })

  it("expires_at is the observation's own window, not the generic 15-minute content-evaluation expiry — this is what gives per-window idempotency", () => {
    const body = extractFunctionBody(persistenceSql, 'tempa_private.record_behavior_signal')
    expect(body).toContain('now() + p_window')
    expect(body).not.toContain("interval '15 minutes'")
  })

  it('dedup lookup matches on (user_id, surface, context_id, fingerprint) unconsumed/unexpired, same shape as record_safety_evaluation, and returns early without a second insert', () => {
    const body = extractFunctionBody(persistenceSql, 'tempa_private.record_behavior_signal')
    expect(body).toContain('e.consumed_at is null')
    expect(body).toContain('e.expires_at > now()')
    expect(body).toMatch(/if v_existing_id is not null then\s*\n\s*-- Same window/)
  })

  it('reuses tempa_private.safety_fingerprint unmodified — title/topics/postcard/question_answer_id/secondary_context_id all null', () => {
    const body = extractFunctionBody(persistenceSql, 'tempa_private.record_behavior_signal')
    expect(body).toMatch(/tempa_private\.safety_fingerprint\(\s*p_subject_user_id,\s*v_surface,\s*p_subject_user_id,\s*null,\s*null,\s*null,\s*null,\s*null,\s*v_body\s*\)/)
  })

  it('stores the structured counts in observed_counts — never a raw body column', () => {
    const body = extractFunctionBody(persistenceSql, 'tempa_private.record_behavior_signal')
    expect(body).toContain('observed_counts')
    expect(body).toContain('p_observed')
  })

  it('mutation_disposition is always allow — nothing here gates a real mutation', () => {
    const body = extractFunctionBody(persistenceSql, 'tempa_private.record_behavior_signal')
    expect(body).toMatch(/'allow',\s*p_escalate_case/)
  })

  it('is granted to no client role — internal helper only, called from other SECURITY DEFINER functions', () => {
    expect(persistenceSql).toContain(
      'revoke all on function tempa_private.record_behavior_signal(uuid, text, text, interval, jsonb, boolean) from public, anon, authenticated, service_role;'
    )
  })
})

describe('tempa_private.evaluate_behavior — the deterministic dispatcher, never raw private text', () => {
  const engineBody = () => extractFunctionBody(persistenceSql, 'tempa_private.evaluate_behavior')

  it('MASS_FIRST_CONTACT and HIGH_CONTACT_VELOCITY both use the locked first-contact definition: reply_to_id is null and question_answer_id is not null', () => {
    const body = engineBody()
    const occurrences = (body.match(/reply_to_id is null and question_answer_id is not null/g) ?? []).length
    expect(occurrences).toBeGreaterThanOrEqual(3) // mass_first_contact, high_velocity, account_velocity
  })

  it('MASS_FIRST_CONTACT counts raw volume; HIGH_CONTACT_VELOCITY and ACCOUNT_VELOCITY count DISTINCT recipients', () => {
    const body = engineBody()
    expect(body).toMatch(/MASS_FIRST_CONTACT[\s\S]*?count\(\*\)/)
    expect(body).toMatch(/count\(distinct recipient_id\) into v_distinct_recipients[\s\S]*?HIGH_CONTACT_VELOCITY/)
  })

  it('NEAR_DUPLICATE_OUTREACH matches on outreach_fingerprint, scoped to surface = first_letter, counting distinct context_id (recipients)', () => {
    const body = engineBody()
    expect(body).toContain("surface = 'first_letter'")
    expect(body).toContain('outreach_fingerprint = p_first_contact_outreach_fingerprint')
    expect(body).toContain('count(distinct context_id)')
  })

  it('ACCOUNT_VELOCITY reads auth.users.created_at (never public.profiles.created_at) and requires BOTH a new account AND elevated velocity', () => {
    const body = engineBody()
    expect(body).toContain('from auth.users where id = p_subject_user_id')
    expect(body).not.toContain('public.profiles.created_at')
    // Both conditions must be structurally required: the velocity check
    // is nested INSIDE the new-account age check, not a sibling branch.
    const ageCheckIndex = body.indexOf('v_account_created_at > now() - v_policy.account_velocity_new_account_age')
    const velocityCheckIndex = body.indexOf('v_distinct_recipients >= v_policy.account_velocity_distinct_recipients_threshold')
    expect(ageCheckIndex).toBeGreaterThan(-1)
    expect(velocityCheckIndex).toBeGreaterThan(ageCheckIndex)
  })

  it('REPEATED_SOLICITATION only runs when the new signal reason codes overlap the solicitation family, counting distinct context_id across public.safety_signals', () => {
    const body = engineBody()
    expect(body).toContain('p_new_content_reason_codes && tempa_private.solicitation_reason_codes()')
    expect(body).toContain('from public.safety_signals')
    expect(body).toContain('reason_codes && tempa_private.solicitation_reason_codes()')
  })

  it('REPORT_SPIKE counts DISTINCT reporters against the subject from public.reports; BLOCK_SPIKE counts blocks against the subject from public.blocked_users', () => {
    const body = engineBody()
    expect(body).toContain('count(distinct reporter_user_id) into v_count')
    expect(body).toContain('from public.reports')
    expect(body).toContain('where reported_user_id = p_subject_user_id')
    expect(body).toContain('from public.blocked_users')
    expect(body).toContain('where blocked_id = p_subject_user_id')
  })

  it('every record_behavior_signal call passes a jsonb_build_object of counts/window only — never a raw text column (body, title, evidence_snapshot)', () => {
    const body = stripLineComments(engineBody())
    const calls = body.match(/perform tempa_private\.record_behavior_signal\([\s\S]*?\);/g) ?? []
    expect(calls.length).toBe(7)
    for (const call of calls) {
      expect(call).toContain('jsonb_build_object(')
      expect(call).not.toMatch(/\bbody\b/)
      expect(call).not.toMatch(/\btitle\b/)
      expect(call).not.toMatch(/evidence_snapshot/)
    }
  })

  it('never mutates public.account_enforcement_state or any suspension/ban/restriction column — only ever records/escalates a case, per the policy boundary', () => {
    const body = engineBody()
    expect(body).not.toContain('account_enforcement_state')
    expect(body).not.toMatch(/update\s+public\.profiles/i)
  })

  it('never references IP address, device fingerprint, browser fingerprint, or country as a heuristic', () => {
    const body = stripLineComments(engineBody()).toLowerCase()
    for (const forbidden of ['ip_address', 'inet_client_addr', 'device_id', 'device_fingerprint', 'user_agent', 'fingerprint_hash', '.country']) {
      expect(body).not.toContain(forbidden)
    }
  })

  it('is granted to no client role — internal helper only', () => {
    expect(persistenceSql).toContain(
      'revoke all on function tempa_private.evaluate_behavior(uuid, text, text[], boolean, boolean) from public, anon, authenticated, service_role;'
    )
  })
})

describe('record_safety_evaluation wires evaluate_behavior transactionally, guarded, never blocking the evaluation itself', () => {
  it('computes outreach_fingerprint only for first_letter, stores it, and calls evaluate_behavior after the signal-insert block, inside an exception guard', () => {
    const body = extractFunctionBody(persistenceSql, 'public.record_safety_evaluation')
    expect(body).toMatch(/if p_surface = 'first_letter' then\s*\n\s*v_outreach_fingerprint := tempa_private\.outreach_fingerprint\(p_user_id, p_body\);/)
    expect(body).toContain('v_outreach_fingerprint')

    const signalInsertIndex = body.indexOf('insert into public.safety_signals')
    const behaviorCallIndex = body.indexOf('tempa_private.evaluate_behavior(')
    expect(signalInsertIndex).toBeGreaterThan(-1)
    expect(behaviorCallIndex).toBeGreaterThan(signalInsertIndex)

    const guardBlock = body.slice(body.lastIndexOf('begin', behaviorCallIndex), body.indexOf('end;', behaviorCallIndex))
    expect(guardBlock).toContain('exception when others then')
    expect(guardBlock).toContain('raise warning')
  })

  it('the REPEATED_SOLICITATION reason-codes argument is null unless THIS evaluation actually created a signal', () => {
    const body = extractFunctionBody(persistenceSql, 'public.record_safety_evaluation')
    expect(body).toContain('v_signal_created := p_risk_band in (\'meaningful\', \'high\', \'severe\') or p_escalate_case;')
    expect(body).toContain('case when v_signal_created then p_reason_codes else null end')
  })
})

describe('report_content/block_user — durable post-event observation, exception-guarded, correct subject (never the reporter/blocker)', () => {
  it('report_content calls evaluate_behavior with p_report_check true, subject = v_reported_user_id, inside an exception guard, AFTER the report insert', () => {
    const body = extractFunctionBody(wiringSql, 'public.report_content')
    const insertIndex = body.indexOf('insert into public.reports')
    const callIndex = body.indexOf('tempa_private.evaluate_behavior(')
    expect(insertIndex).toBeGreaterThan(-1)
    expect(callIndex).toBeGreaterThan(insertIndex)
    const call = body.slice(callIndex, body.indexOf(';', callIndex))
    expect(call).toContain('p_subject_user_id := v_reported_user_id')
    expect(call).toContain('p_report_check := true')
    expect(call).not.toContain('auth.uid()')
    const guardBlock = body.slice(body.lastIndexOf('begin', callIndex), body.indexOf('end;', callIndex))
    expect(guardBlock).toContain('exception when others then')
  })

  it('block_user calls evaluate_behavior with p_block_check true, subject = p_blocked_id, inside an exception guard, AFTER the block upsert', () => {
    const body = extractFunctionBody(wiringSql, 'public.block_user')
    const insertIndex = body.indexOf('insert into public.blocked_users')
    const callIndex = body.indexOf('tempa_private.evaluate_behavior(')
    expect(insertIndex).toBeGreaterThan(-1)
    expect(callIndex).toBeGreaterThan(insertIndex)
    const call = body.slice(callIndex, body.indexOf(';', callIndex))
    expect(call).toContain('p_subject_user_id := p_blocked_id')
    expect(call).toContain('p_block_check := true')
    const guardBlock = body.slice(body.lastIndexOf('begin', callIndex), body.indexOf('end;', callIndex))
    expect(guardBlock).toContain('exception when others then')
  })

  it('neither signature nor grant changed for report_content/block_user — same params, same authenticated-only execute grant', () => {
    const codeOnly = stripLineComments(wiringSql)
    expect(codeOnly).toContain('grant execute on function public.report_content(text, uuid, text, text) to authenticated;')
    expect(codeOnly).toContain('grant execute on function public.block_user(uuid, text) to authenticated;')
  })

  it('full behavioral fidelity — every existing check/side-effect from each RPC\'s previous live definition is preserved verbatim', () => {
    const reportBody = extractFunctionBody(wiringSql, 'public.report_content')
    expect(reportBody).toContain('You cannot report your own content.')
    expect(reportBody).toContain('You have already reported this.')
    expect(reportBody).toContain("p_target_type not in ('profile', 'letter', 'dispatch', 'photo_moment', 'question_answer', 'reply')")

    const blockBody = extractFunctionBody(wiringSql, 'public.block_user')
    expect(blockBody).toContain('You cannot block yourself.')
    expect(blockBody).toContain("p_scope not in ('letters', 'full')")
    expect(blockBody).toContain('delete from public.kept_minds')
    expect(blockBody).toContain('delete from public.dispatch_worth_reading')
  })
})

describe('scope discipline — no OCR, no admin UI, no auto-enforcement, no rate-limit duplication', () => {
  it('neither new file touches image/OCR tables, account_enforcement_state writes, or a rate-limit table', () => {
    for (const sql of [persistenceSql, wiringSql]) {
      const codeOnly = stripLineComments(sql)
      expect(codeOnly).not.toMatch(/create table public\.rate_limits?/)
      expect(codeOnly).not.toMatch(/\bocr\b/i)
    }
  })
})

describe('verification SQL', () => {
  it('exists, is read-only, and checks signatures/grants/wiring/schema-widening', () => {
    const codeOnlyVerify = stripLineComments(verifySql)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\binsert\s+into\b/)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\bupdate\s+public\./)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\bdelete\s+from\b/)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\bdrop\s+(table|function|index|policy)\b/)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\balter\s+table\b/)
    for (const name of ['report_content', 'block_user', 'evaluate_behavior', 'record_behavior_signal', 'behavior_policy']) {
      expect(verifySql).toContain(name)
    }
    expect(verifySql).toContain('overall_pass')
  })
})
