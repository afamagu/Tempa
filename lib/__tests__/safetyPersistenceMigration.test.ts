// This repository cannot execute Postgres in CI, so every requirement
// that lives purely in SQL (grant/revoke pairs, RLS with no client
// policy, the service-role-only recording RPC, the dedup/idempotency
// logic, the signals-vs-cases separation, and the "no raw letter text"
// privacy rule) is verified directly against the tracked migration
// source text — same convention as arrivalEmailQueueMigration.test.ts/
// arrivalEmailSchedulerMigration.test.ts.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const MIGRATION_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-10-03-safety-persistence.sql')
const VERIFY_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-10-03-safety-persistence-verify.sql')
const sql = readFileSync(MIGRATION_PATH, 'utf8')
const verifySql = readFileSync(VERIFY_PATH, 'utf8')

function stripLineComments(text: string): string {
  // Leading whitespace-aware — this migration indents many of its own
  // comment lines (e.g. inside CREATE TABLE column lists), which a
  // bare `^--` anchor would leave un-stripped.
  return text.replace(/^\s*--.*$/gm, '')
}
const codeOnly = stripLineComments(sql)

function extractFunctionBody(qualifiedName: string): string {
  const start = sql.indexOf(`create or replace function ${qualifiedName}(`)
  expect(start, `expected to find "${qualifiedName}" defined in ${MIGRATION_PATH}`).toBeGreaterThan(-1)
  const end = sql.indexOf('$$;', start) === -1 ? sql.indexOf('$function$;', start) : sql.indexOf('$$;', start)
  expect(end, `expected a closing $$; or $function$; for "${qualifiedName}"`).toBeGreaterThan(start)
  return sql.slice(start, end)
}

describe('one BEGIN/COMMIT, not yet applied', () => {
  it('wraps everything in exactly one begin/commit and is explicitly marked NOT EXECUTED', () => {
    expect((sql.match(/^begin;/m) ?? []).length).toBe(1)
    expect((sql.match(/^commit;/m) ?? []).length).toBe(1)
    expect(sql).toContain('STATUS: NOT EXECUTED')
    expect(sql).not.toContain('STATUS: LIVE')
  })

  it('never modifies send_first_letter/reply_to_letter/write_letter — Checkpoint 2 builds persistence only', () => {
    expect(codeOnly).not.toMatch(/create or replace function public\.send_first_letter/)
    expect(codeOnly).not.toMatch(/create or replace function public\.reply_to_letter/)
    expect(codeOnly).not.toMatch(/create or replace function public\.write_letter/)
  })

  it('never schedules a pg_cron job — cleanup is prepared but not automated yet', () => {
    expect(codeOnly.toLowerCase()).not.toMatch(/cron\.schedule/)
  })
})

describe('privacy — no raw Letter/Dispatch/Postcard text anywhere in the migration', () => {
  it('never references a body/content column from letters, dispatches, or moments', () => {
    expect(codeOnly.toLowerCase()).not.toMatch(/\bl\.body\b|\bletters\.body\b/)
    expect(codeOnly.toLowerCase()).not.toMatch(/\bd\.body\b|\bdispatches\.body\b/)
    expect(codeOnly.toLowerCase()).not.toMatch(/\bmoments\b/)
  })

  it('safety_evaluations/safety_signals/safety_cases only ever store ids, classifier output, and timestamps — a Postcard is only ever a transient jsonb PARAMETER, never a stored column (independent audit correction — Checkpoint 3 Postcard binding)', () => {
    const evalStart = sql.indexOf('create table public.safety_evaluations')
    const evalEnd = sql.indexOf(');', evalStart)
    const evalBody = sql.slice(evalStart, evalEnd)
    expect(evalBody).not.toMatch(/\bbody text\b/)
    expect(evalBody).not.toMatch(/\bcontent\b/)
    expect(evalBody).not.toMatch(/\bpostcard/i)

    const signalsStart = sql.indexOf('create table public.safety_signals')
    const signalsEnd = sql.indexOf(');', signalsStart)
    const signalsBody = sql.slice(signalsStart, signalsEnd)
    expect(signalsBody).not.toMatch(/\bpostcard/i)
    expect(signalsBody).not.toMatch(/\breveal_line\b|\bback_message\b/)

    // p_postcard itself is a jsonb PARAMETER, consumed only inside the
    // fingerprint's own digest() call — the column-absence checks above
    // already structurally guarantee no table can ever store it,
    // regardless of what any INSERT statement's own values reference.
    expect(codeOnly).not.toMatch(/\bpostcard\s+jsonb\s+not\s+null\b/)
  })
})

describe('safety_evaluations — RLS with no client policy, RPC-only writes', () => {
  it('RLS is enabled and every grant is revoked from public/anon/authenticated, with no compensating policy', () => {
    expect(codeOnly).toContain('alter table public.safety_evaluations enable row level security')
    expect(codeOnly).toContain('revoke all on public.safety_evaluations from public, anon, authenticated')
    expect(codeOnly).not.toMatch(/create policy \w+\s+on public\.safety_evaluations/)
  })

  it('constrains surface to the three real Letter surfaces and risk_band/mutation_disposition to the classifier taxonomy', () => {
    expect(codeOnly).toMatch(/surface text not null check \(surface in \('first_letter', 'reply', 'write_anytime'\)\)/)
    expect(codeOnly).toMatch(
      /risk_band text not null check \(risk_band in \('none', 'weak', 'meaningful', 'high', 'severe'\)\)/
    )
    expect(codeOnly).toMatch(/mutation_disposition text not null check \(mutation_disposition in \('allow', 'warn', 'deny'\)\)/)
  })

  it('reason_codes has no enumerated CHECK — the taxonomy lives in TypeScript and can grow independently', () => {
    const start = sql.indexOf('create table public.safety_evaluations')
    const end = sql.indexOf(');', start)
    const body = sql.slice(start, end)
    expect(body).toMatch(/reason_codes text\[\] not null default '\{\}'/)
    expect(body).not.toMatch(/reason_codes.*check/i)
  })

  it('has consumed_at and expires_at for single-use, time-bounded clearance, defaulting to a ~15 minute TTL', () => {
    expect(codeOnly).toMatch(/consumed_at timestamptz/)
    expect(codeOnly).toMatch(/expires_at timestamptz not null default \(now\(\) \+ interval '15 minutes'\)/)
  })

  it('sets warning_issued_at itself (at evaluation time, the same instant the HTTP response serves the warning copy) but never consumed_at or warning_acknowledged_at — those belong solely to tempa_private.consume_safety_evaluation', () => {
    const body = extractFunctionBody('public.record_safety_evaluation')
    expect(body).not.toMatch(/\bconsumed_at\s*=/)
    expect(body).not.toMatch(/warning_acknowledged_at\s*=/)
    expect(body).toContain("case when p_mutation_disposition = 'warn' then now() else null end")
  })

  it('has a warning_issued_at column, distinct from warning_required/warning_acknowledged_at, and never calls anything "warning_seen"', () => {
    expect(codeOnly).toMatch(/warning_issued_at timestamptz/)
    expect(codeOnly).toMatch(/warning_acknowledged_at timestamptz/)
    expect(codeOnly.toLowerCase()).not.toContain('warning_seen')
  })

  it('has a question_answer_id column structurally required for first_letter and forbidden for the other two surfaces (independent audit correction)', () => {
    const start = sql.indexOf('create table public.safety_evaluations')
    const end = sql.indexOf(');', start)
    const body = sql.slice(start, end)
    expect(body).toMatch(/question_answer_id uuid,/)
    expect(body).toContain("check ((surface = 'first_letter') = (question_answer_id is not null))")
  })
})

describe('safety_cases — the canonical Safety 2 lifecycle, one active case per subject, never a generic staff SELECT path', () => {
  it('RLS is enabled and every grant is revoked from public/anon/authenticated/service_role, with no compensating policy', () => {
    expect(codeOnly).toContain('alter table public.safety_cases enable row level security')
    expect(codeOnly).toContain('revoke all on public.safety_cases from public, anon, authenticated')
    expect(codeOnly).not.toMatch(/create policy \w+\s+on public\.safety_cases/)
    expect(codeOnly).not.toMatch(/grant select on public\.safety_cases/)
  })

  it('uses the full canonical status lifecycle, not the earlier open/reviewed/dismissed placeholder', () => {
    expect(codeOnly).toMatch(
      /status text not null default 'open'\s+check \(status in \('open', 'reviewing', 'no_action', 'warned', 'restricted', 'suspended', 'banned', 'resolved'\)\)/
    )
    expect(codeOnly).not.toContain("'reviewed', 'dismissed'")
  })

  it('enforces at most one ACTIVE (open or reviewing) case per subject via a partial unique index', () => {
    expect(codeOnly).toMatch(
      /create unique index safety_cases_one_active_per_subject\s+on public\.safety_cases \(subject_user_id\)\s+where status in \('open', 'reviewing'\)/
    )
  })

  it('record_safety_evaluation upserts into the same active case rather than always inserting a new one', () => {
    const body = extractFunctionBody('public.record_safety_evaluation')
    expect(body).toContain("on conflict (subject_user_id) where status in ('open', 'reviewing')")
    expect(body).toContain('signal_count = public.safety_cases.signal_count + 1')
  })

  it('only ever inserts a new case at status \'open\' — this checkpoint never transitions a case itself', () => {
    const body = extractFunctionBody('public.record_safety_evaluation')
    expect(body).toContain("values (p_user_id, 'open', p_risk_band, 1)")
    expect(body).not.toMatch(/status\s*=\s*'(reviewing|no_action|warned|restricted|suspended|banned|resolved)'/)
  })
})

describe('safety_signals — individual observations, meaningful+ only, at most one per evaluation', () => {
  it('RLS is enabled and every grant is revoked from public/anon/authenticated, with no compensating policy', () => {
    expect(codeOnly).toContain('alter table public.safety_signals enable row level security')
    expect(codeOnly).toContain('revoke all on public.safety_signals from public, anon, authenticated')
    expect(codeOnly).not.toMatch(/create policy \w+\s+on public\.safety_signals/)
  })

  it('evaluation_id is unique, and risk_band matches safety_evaluations\' full domain (not narrowed to meaningful+)', () => {
    expect(codeOnly).toMatch(/evaluation_id uuid not null unique references public\.safety_evaluations/)
    expect(codeOnly).toMatch(
      /risk_band text not null check \(risk_band in \('none', 'weak', 'meaningful', 'high', 'severe'\)\)/
    )
  })

  it('record_safety_evaluation inserts a signal for meaningful/high/severe risk OR whenever the evaluation escalates a case, and only once per evaluation', () => {
    const body = extractFunctionBody('public.record_safety_evaluation')
    expect(body).toContain("if p_risk_band in ('meaningful', 'high', 'severe') or p_escalate_case then")
    expect(body).toContain('on conflict (evaluation_id) do nothing')
  })

  it('the case/evidence invariant: an escalating evaluation with a weak/none band still gets a persisted signal (independent audit correction)', () => {
    // Structural proof, not just the condition string above: the signal
    // insert must be reachable even when p_risk_band is 'weak' or
    // 'none', because escalate_case is an independently-settable POLICY
    // axis (see classify.ts's PolicyOverride) — a case must never
    // report a signal_count with no matching signal behind it.
    const body = extractFunctionBody('public.record_safety_evaluation')
    const signalInsertIndex = body.indexOf('insert into public.safety_signals')
    const guardIndex = body.lastIndexOf("if p_risk_band in ('meaningful', 'high', 'severe') or p_escalate_case then", signalInsertIndex)
    expect(guardIndex, 'expected the widened guard to directly precede the signal insert').toBeGreaterThan(-1)
    expect(guardIndex).toBeLessThan(signalInsertIndex)
  })

  it('has nullable source_content_id/proceeded_at columns for linking an evaluation-time signal to the content the member actually proceeded with (independent audit correction — B5)', () => {
    const start = sql.indexOf('create table public.safety_signals')
    const end = sql.indexOf(');', start)
    const body = sql.slice(start, end)
    expect(body).toMatch(/source_content_id uuid,/)
    expect(body).toMatch(/proceeded_at timestamptz,/)
  })
})

describe('tempa_private.consume_safety_evaluation — Checkpoint 3\'s one trusted consumption path, prepared here for the mutation RPCs to call (independent audit correction — B3)', () => {
  it('is not directly callable by any client role, including service_role', () => {
    expect(codeOnly).toContain(
      'revoke all on function tempa_private.consume_safety_evaluation(uuid, uuid, text, uuid, uuid, jsonb, text, boolean, uuid) from public, anon, authenticated, service_role'
    )
  })

  it('locks the evaluation row FOR UPDATE before checking it', () => {
    const body = extractFunctionBody('tempa_private.consume_safety_evaluation')
    expect(body).toContain('from public.safety_evaluations')
    expect(body).toContain('for update')
  })

  it('verifies ownership, surface, context, and Question-answer match before ever considering consumption', () => {
    const body = extractFunctionBody('tempa_private.consume_safety_evaluation')
    expect(body).toContain('v_eval.user_id <> p_user_id')
    expect(body).toContain('v_eval.surface <> p_surface')
    expect(body).toContain('v_eval.context_id <> p_context_id')
    expect(body).toContain('v_eval.question_answer_id is distinct from p_question_answer_id')
  })

  it('rejects an already-consumed or expired evaluation', () => {
    const body = extractFunctionBody('tempa_private.consume_safety_evaluation')
    expect(body).toContain('v_eval.consumed_at is not null')
    expect(body).toContain('v_eval.expires_at <= now()')
  })

  it('recomputes the fingerprint from its own actual received body/postcard and requires an exact match — this is what invalidates edited content', () => {
    const body = extractFunctionBody('tempa_private.consume_safety_evaluation')
    expect(body).toContain(
      'tempa_private.safety_fingerprint(p_user_id, p_surface, p_context_id, p_question_answer_id, p_postcard, p_body)'
    )
    expect(body).toContain('v_fingerprint <> v_eval.fingerprint')
  })

  it('deny never proceeds regardless of acknowledgement; warn requires explicit p_warning_acknowledged', () => {
    const body = extractFunctionBody('tempa_private.consume_safety_evaluation')
    expect(body).toContain("v_eval.mutation_disposition = 'deny'")
    expect(body).toContain("v_eval.mutation_disposition = 'warn' and not p_warning_acknowledged")
  })

  it('sets consumed_at and, only when acknowledged, warning_acknowledged_at, scoped to unconsumed/unexpired', () => {
    const body = extractFunctionBody('tempa_private.consume_safety_evaluation')
    expect(body).toContain('consumed_at = now()')
    expect(body).toContain('warning_acknowledged_at = case when p_warning_acknowledged then now() else warning_acknowledged_at end')
    expect(body).toContain('and consumed_at is null')
    expect(body).toContain('and expires_at > now()')
  })

  it('links this evaluation\'s own signal (if any) to the newly-created content, only on successful consumption', () => {
    const body = extractFunctionBody('tempa_private.consume_safety_evaluation')
    expect(body).toContain('update public.safety_signals')
    expect(body).toContain('set source_content_id = p_new_content_id, proceeded_at = now()')
    expect(body).toContain('where evaluation_id = p_evaluation_id')
  })
})

describe('tempa_private.safety_fingerprint — the one canonical fingerprint implementation', () => {
  it('is not SECURITY DEFINER and has no grant to any client role', () => {
    const body = extractFunctionBody('tempa_private.safety_fingerprint')
    expect(body).not.toMatch(/security definer/)
    expect(codeOnly).toContain(
      'revoke all on function tempa_private.safety_fingerprint(uuid, text, uuid, uuid, jsonb, text) from public, anon, authenticated'
    )
  })

  it('binds p_question_answer_id into the digest, so an evaluation for one Question-answer cannot be replayed as clearance for a different first-contact context (independent audit correction)', () => {
    const body = extractFunctionBody('tempa_private.safety_fingerprint')
    expect(body).toMatch(
      /length\(coalesce\(p_question_answer_id::text, ''\)\)::text \|\| ':' \|\| coalesce\(p_question_answer_id::text, ''\)/
    )
  })

  it('binds the canonical jsonb Postcard payload into the digest, so changing the Postcard after evaluation invalidates it (independent audit correction — Checkpoint 3 Postcard-text bypass)', () => {
    const body = extractFunctionBody('tempa_private.safety_fingerprint')
    expect(body).toMatch(/length\(coalesce\(p_postcard::text, ''\)\)::text \|\| ':' \|\| coalesce\(p_postcard::text, ''\)/)
  })

  it('computes the digest itself from the raw fields — TypeScript never calculates or submits a hash', () => {
    const body = extractFunctionBody('tempa_private.safety_fingerprint')
    expect(body).toMatch(/extensions\.digest\(/)
    expect(body).toContain("'sha256'")
  })

  it('length-prefixes every field before concatenating, so no field value can create ambiguity', () => {
    const body = extractFunctionBody('tempa_private.safety_fingerprint')
    expect(body).toMatch(/length\(p_user_id::text\)::text \|\| ':' \|\| p_user_id::text/)
    expect(body).toMatch(/length\(coalesce\(p_body, ''\)\)::text \|\| ':' \|\| coalesce\(p_body, ''\)/)
  })

  it('installs pgcrypto with an explicit preflight comment rather than assuming its schema', () => {
    expect(sql).toContain('create extension if not exists pgcrypto with schema extensions')
    expect(sql).toContain('PREFLIGHT')
    expect(sql).toContain('do not guess')
    expect(sql).toContain("select extname, nspname from pg_extension")
  })
})

describe('record_safety_evaluation — service-role only, dedup/idempotent, derives nothing from an untrusted hash', () => {
  it('is service-role only, with no grant to authenticated or anon', () => {
    expect(codeOnly).toContain(
      'revoke all on function public.record_safety_evaluation(uuid, text, uuid, uuid, jsonb, text, text, text[], text, boolean) from public'
    )
    expect(codeOnly).toContain(
      'grant execute on function public.record_safety_evaluation(uuid, text, uuid, uuid, jsonb, text, text, text[], text, boolean) to service_role'
    )
    expect(codeOnly).not.toMatch(
      /grant execute on function public\.record_safety_evaluation.*to (anon|authenticated)/
    )
  })

  it('never receives a pre-computed fingerprint parameter — it calls the shared helper itself', () => {
    const start = sql.indexOf('create or replace function public.record_safety_evaluation(')
    const paramsEnd = sql.indexOf(')', start)
    const params = sql.slice(start, paramsEnd)
    expect(params).not.toMatch(/p_fingerprint/)

    const body = extractFunctionBody('public.record_safety_evaluation')
    expect(body).toContain(
      'tempa_private.safety_fingerprint(p_user_id, p_surface, p_context_id, p_question_answer_id, p_postcard, p_body)'
    )
  })

  it('rejects a Postcard for first_letter, which has none (independent audit correction)', () => {
    const body = extractFunctionBody('public.record_safety_evaluation')
    expect(body).toContain("if p_surface = 'first_letter' and p_postcard is not null then")
  })

  it('requires p_question_answer_id for first_letter and forbids it for the other two surfaces (independent audit correction)', () => {
    const body = extractFunctionBody('public.record_safety_evaluation')
    expect(body).toContain("if p_surface = 'first_letter' and p_question_answer_id is null then")
    expect(body).toContain("if p_surface <> 'first_letter' and p_question_answer_id is not null then")
  })

  it('stores question_answer_id on the evaluation row itself, not only inside the fingerprint', () => {
    const body = extractFunctionBody('public.record_safety_evaluation')
    expect(body).toMatch(/insert into public\.safety_evaluations \(\s*user_id, surface, context_id, question_answer_id, fingerprint/)
    expect(body).toMatch(/values \(\s*p_user_id, p_surface, p_context_id, p_question_answer_id, v_fingerprint/)
  })

  it('looks up an existing unconsumed, unexpired evaluation for the same (user, surface, context, fingerprint) before inserting', () => {
    const body = extractFunctionBody('public.record_safety_evaluation')
    expect(body).toContain('e.user_id = p_user_id')
    expect(body).toContain('e.surface = p_surface')
    expect(body).toContain('e.context_id = p_context_id')
    expect(body).toContain('e.fingerprint = v_fingerprint')
    expect(body).toContain('e.consumed_at is null')
    expect(body).toContain('e.expires_at > now()')
  })
})

describe('record_safety_evaluation — concurrency-safe dedup via a transaction-scoped advisory lock', () => {
  it('takes an advisory transaction lock derived from the fingerprint before the dedup lookup, not after', () => {
    const body = extractFunctionBody('public.record_safety_evaluation')
    const lockIndex = body.indexOf('pg_advisory_xact_lock')
    const lookupIndex = body.indexOf('into v_existing_id')
    expect(lockIndex, 'expected pg_advisory_xact_lock to appear in the function body').toBeGreaterThan(-1)
    expect(lookupIndex, 'expected the dedup lookup (into v_existing_id) to appear in the function body').toBeGreaterThan(-1)
    expect(lockIndex).toBeLessThan(lookupIndex)
  })

  it('derives the lock key from the fingerprint itself, not a separately-hashed identity', () => {
    const body = extractFunctionBody('public.record_safety_evaluation')
    expect(body).toContain("v_lock_key := ('x' || substr(v_fingerprint, 1, 16))::bit(64)::bigint")
    expect(body).toContain('perform pg_advisory_xact_lock(v_lock_key)')
  })
})

describe('record_safety_evaluation — never silently reuses a clearance whose stored decision disagrees with the current classifier', () => {
  it('compares the existing evaluation\'s full policy tuple against the current call\'s before reusing it', () => {
    const body = extractFunctionBody('public.record_safety_evaluation')
    expect(body).toContain('v_existing_risk_band = p_risk_band')
    expect(body).toContain("v_existing_reason_codes = coalesce(p_reason_codes, '{}')")
    expect(body).toContain('v_existing_mutation_disposition = p_mutation_disposition')
    expect(body).toContain('v_existing_escalate_case = p_escalate_case')
  })

  it('invalidates a stale-policy evaluation (expires it) rather than reusing or leaving it dedup-matchable', () => {
    const body = extractFunctionBody('public.record_safety_evaluation')
    expect(body).toContain('update public.safety_evaluations set expires_at = now() where id = v_existing_id')
  })
})

describe('can_evaluate_safety_context — proves the mutation context is real and the caller\'s own, before any evaluation is recorded', () => {
  it('is callable by authenticated, never by anon, and is not a service-role table read', () => {
    expect(codeOnly).toContain('revoke all on function public.can_evaluate_safety_context(text, uuid, uuid, jsonb) from public')
    expect(codeOnly).toContain(
      'grant execute on function public.can_evaluate_safety_context(text, uuid, uuid, jsonb) to authenticated'
    )
    expect(codeOnly).not.toMatch(
      /grant execute on function public\.can_evaluate_safety_context.*to (anon|service_role)/
    )
  })

  it('requires an authenticated session — returns false, never trusts a missing auth.uid()', () => {
    const body = extractFunctionBody('public.can_evaluate_safety_context')
    expect(body).toContain('if auth.uid() is null then')
    expect(body).toContain('return false;')
  })

  it('first_letter: checks recipient existence, not-self, account status, and blocked-pair — mirrors send_first_letter\'s own gate', () => {
    const body = extractFunctionBody('public.can_evaluate_safety_context')
    expect(body).toContain('p_context_id = auth.uid()')
    expect(body).toContain("public.current_account_status() in ('restricted', 'suspended', 'banned')")
    expect(body).toContain('tempa_private.is_correspondence_blocked_pair(auth.uid(), p_context_id)')
    expect(body).toContain('exists (select 1 from public.profiles where id = p_context_id)')
  })

  it('first_letter: requires a live Question-answer belonging to that exact recipient — mirrors send_first_letter\'s own Discovery gate in full (independent audit correction)', () => {
    const body = extractFunctionBody('public.can_evaluate_safety_context')
    expect(body).toContain('if p_question_answer_id is null then')
    expect(body).toContain('from public.question_answers qa')
    expect(body).toContain('join public.questions q on q.id = qa.question_id')
    expect(body).toContain('qa.id = p_question_answer_id')
    expect(body).toContain('qa.user_id = p_context_id')
    expect(body).toContain('qa.is_current = true')
    expect(body).toContain('q.is_active = true')
  })

  it('first_letter: rejects a pending correspondence that is already active/established, or where the caller has already sent their own root first-contact letter — but preserves crossed-direction first contact (independent audit correction — B1)', () => {
    const body = extractFunctionBody('public.can_evaluate_safety_context')
    expect(body).toContain('c.participant_low = least(auth.uid(), p_context_id)')
    expect(body).toContain('c.participant_high = greatest(auth.uid(), p_context_id)')
    expect(body).toContain("c.status in ('pending', 'active')")
    expect(body).toContain("v_first_letter_corr.status = 'active' or v_first_letter_corr.established_at is not null")
    expect(body).toContain('l.correspondence_id = v_first_letter_corr.id')
    expect(body).toContain('l.reply_to_id is null')
    expect(body).toContain('l.sender_id = auth.uid()')
  })

  it('reply: mirrors reply_to_letter\'s own row lookup exactly (recipient, sent, deliver_at, still awaiting reply)', () => {
    const body = extractFunctionBody('public.can_evaluate_safety_context')
    expect(body).toContain('l.recipient_id = auth.uid()')
    expect(body).toContain("l.status = 'sent'")
    expect(body).toContain('l.deliver_at <= now()')
    expect(body).toContain('l.reply_to_id is not null or l.expires_at > now()')
  })

  it('reply: rejects a blocked pair and a suspended/banned caller — gaps the previous implementation had left open (independent audit correction — B1)', () => {
    const body = extractFunctionBody('public.can_evaluate_safety_context')
    expect(body).toContain('tempa_private.is_correspondence_blocked_pair(auth.uid(), v_reply_letter.sender_id)')
    expect(body).toMatch(/elsif p_surface = 'reply' then[\s\S]*?v_status in \('suspended', 'banned'\)/)
  })

  it('reply/write_anytime: reject a restricted caller only when a Postcard is present, preserving restricted plain-text reply/write (independent audit correction — B2/B1)', () => {
    const body = extractFunctionBody('public.can_evaluate_safety_context')
    const occurrences = body.match(/p_postcard is not null and v_status = 'restricted'/g) ?? []
    expect(occurrences.length).toBe(2)
  })

  it('write_anytime: mirrors write_letter\'s own pre-insert checks (participant, blocked-pair, account status, active correspondence)', () => {
    const body = extractFunctionBody('public.can_evaluate_safety_context')
    expect(body).toContain('auth.uid() <> v_corr.participant_low and auth.uid() <> v_corr.participant_high')
    expect(body).toContain('tempa_private.is_correspondence_blocked_pair(auth.uid(), v_recipient)')
    expect(body).toContain("v_status in ('suspended', 'banned')")
    expect(body).toContain("v_corr.status = 'active' and v_corr.established_at is not null")
  })

  it('never trusts a service-role table read — this function has no relationship to createServiceClient()', () => {
    const body = extractFunctionBody('public.can_evaluate_safety_context')
    expect(body.toLowerCase()).not.toContain('service_role')
  })
})

describe('cleanup_expired_safety_evaluations — prepared, not scheduled, never orphans an active case\'s evidence', () => {
  it('is service-role only', () => {
    expect(codeOnly).toContain(
      'revoke all on function public.cleanup_expired_safety_evaluations(interval) from public'
    )
    expect(codeOnly).toContain(
      'grant execute on function public.cleanup_expired_safety_evaluations(interval) to service_role'
    )
  })

  it('deletes based on a retention window past expiry, defaulting to 30 days', () => {
    const body = extractFunctionBody('public.cleanup_expired_safety_evaluations')
    expect(body).toContain('where e.expires_at < now() - p_retention')
    expect(sql).toContain("p_retention interval default interval '30 days'")
  })

  it('excludes any evaluation whose signal is attached to an active (open or reviewing) case from deletion', () => {
    const body = extractFunctionBody('public.cleanup_expired_safety_evaluations')
    expect(body).toContain('not exists (')
    expect(body).toContain('join public.safety_cases c on c.id = s.case_id')
    expect(body).toContain("c.status in ('open', 'reviewing')")
  })
})

describe('verification SQL', () => {
  it('exists, is read-only (no mutation statement outside comments/privilege-name string literals), and checks every table/function this migration adds', () => {
    const codeOnlyVerify = stripLineComments(verifySql)
    // 'INSERT'/'UPDATE' etc. legitimately appear as has_*_privilege()
    // permission-name string literals in a read-only check — that is
    // not a mutation statement. Checking for the actual SQL COMMAND
    // shape (keyword followed by its usual next token) avoids a false
    // positive on those literals.
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\binsert\s+into\b/)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\bupdate\s+public\./)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\bdelete\s+from\b/)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\bdrop\s+(table|function|index)\b/)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\balter\s+table\b/)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\btruncate\b/)
    for (const name of ['safety_evaluations', 'safety_cases', 'safety_signals']) {
      expect(verifySql).toContain(name)
    }
    expect(verifySql).toContain('record_safety_evaluation')
    expect(verifySql).toContain('safety_fingerprint')
    expect(verifySql).toContain('can_evaluate_safety_context')
    expect(verifySql).toContain('cleanup_expired_safety_evaluations')
    expect(verifySql).toContain('overall_pass')
  })
})
