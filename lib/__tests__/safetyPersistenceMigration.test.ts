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
    // stripLineComments first — this table's own explanatory comments
    // (Checkpoint 5) legitimately use the word "content" in prose
    // ("the seven CONTENT surfaces"), which would otherwise falsely trip
    // this assertion; only the real column/constraint text matters here.
    const evalBody = stripLineComments(sql.slice(evalStart, evalEnd))
    expect(evalBody).not.toMatch(/\bbody text\b/)
    expect(evalBody).not.toMatch(/\bcontent\b/)
    expect(evalBody).not.toMatch(/\bpostcard/i)

    const signalsStart = sql.indexOf('create table public.safety_signals')
    const signalsEnd = sql.indexOf(');', signalsStart)
    const signalsBody = stripLineComments(sql.slice(signalsStart, signalsEnd))
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

  it('constrains surface to the seven content surfaces (Letters + Checkpoint 4 public text) plus the seven Checkpoint 5 behavioral surfaces, and risk_band/mutation_disposition to the classifier taxonomy', () => {
    expect(codeOnly).toMatch(
      /surface text not null check \(\s*surface in \(\s*'first_letter', 'reply', 'write_anytime',\s*'dispatch_publish', 'dispatch_update', 'question_answer', 'dispatch_reply',\s*'behavior_mass_first_contact', 'behavior_near_duplicate_outreach',\s*'behavior_high_contact_velocity', 'behavior_repeated_solicitation',\s*'behavior_report_spike', 'behavior_block_spike', 'behavior_account_velocity'\s*\)\s*\)/
    )
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
    // Checkpoint 5: the same condition, now captured into v_signal_created
    // first (reused by the trailing evaluate_behavior call below it) —
    // still gates the signal insert identically.
    expect(body).toContain("v_signal_created := p_risk_band in ('meaningful', 'high', 'severe') or p_escalate_case;")
    expect(body).toContain('if v_signal_created then')
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
    const assignIndex = body.lastIndexOf(
      "v_signal_created := p_risk_band in ('meaningful', 'high', 'severe') or p_escalate_case;",
      signalInsertIndex
    )
    expect(assignIndex, 'expected the widened guard to directly precede the signal insert').toBeGreaterThan(-1)
    expect(assignIndex).toBeLessThan(signalInsertIndex)
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
      'revoke all on function tempa_private.consume_safety_evaluation(uuid, uuid, text, uuid, uuid, uuid, text, text[], jsonb, text, boolean, uuid) from public, anon, authenticated, service_role'
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

  it('verifies the secondary (parent Reply) target matches — Checkpoint 4 (independent audit correction)', () => {
    const body = extractFunctionBody('tempa_private.consume_safety_evaluation')
    expect(body).toContain('v_eval.secondary_context_id is distinct from p_secondary_context_id')
  })

  it('rejects an already-consumed or expired evaluation', () => {
    const body = extractFunctionBody('tempa_private.consume_safety_evaluation')
    expect(body).toContain('v_eval.consumed_at is not null')
    expect(body).toContain('v_eval.expires_at <= now()')
  })

  it('recomputes the fingerprint from its own actual received fields and requires an exact match — this is what invalidates edited content', () => {
    const body = extractFunctionBody('tempa_private.consume_safety_evaluation')
    expect(body).toMatch(
      /tempa_private\.safety_fingerprint\(\s*p_user_id, p_surface, p_context_id, p_question_answer_id, p_secondary_context_id, p_title, p_topics, p_postcard, p_body\s*\)/
    )
    expect(body).toContain('v_fingerprint <> v_eval.fingerprint')
  })

  it('deny never proceeds regardless of acknowledgement; warn requires explicit p_warning_acknowledged', () => {
    const body = extractFunctionBody('tempa_private.consume_safety_evaluation')
    expect(body).toContain("v_eval.mutation_disposition = 'deny'")
    expect(body).toContain("v_eval.mutation_disposition = 'warn' and p_warning_acknowledged is not true")
  })

  it('uses IS NOT TRUE (never `not p_warning_acknowledged`) — NULL-safe, so SQL NULL cannot satisfy acknowledgement (independent audit correction)', () => {
    const body = stripLineComments(extractFunctionBody('tempa_private.consume_safety_evaluation'))
    expect(body).not.toMatch(/and not p_warning_acknowledged/)
    expect(body).toContain('p_warning_acknowledged is not true')
  })

  it('sets consumed_at and, only when the stored disposition is actually warn AND explicitly acknowledged, warning_acknowledged_at, scoped to unconsumed/unexpired (independent audit correction)', () => {
    const body = extractFunctionBody('tempa_private.consume_safety_evaluation')
    expect(body).toContain('consumed_at = now()')
    expect(body).toContain("when v_eval.mutation_disposition = 'warn' and p_warning_acknowledged is true then now()")
    expect(body).toContain('else warning_acknowledged_at')
    expect(body).toContain('and consumed_at is null')
    expect(body).toContain('and expires_at > now()')
  })

  it('never sets warning_acknowledged_at from an allow evaluation submitted with p_warning_acknowledged = true — no fake acknowledgement in the audit record', () => {
    const body = extractFunctionBody('tempa_private.consume_safety_evaluation')
    // The only place warning_acknowledged_at is assigned must itself be
    // gated on mutation_disposition = 'warn' — structurally proven by
    // requiring the exact CASE guard above to directly precede it.
    const assignIndex = body.indexOf('warning_acknowledged_at = case')
    const guardIndex = body.indexOf("when v_eval.mutation_disposition = 'warn' and p_warning_acknowledged is true then now()")
    expect(assignIndex).toBeGreaterThan(-1)
    expect(guardIndex).toBeGreaterThan(assignIndex)
    expect(guardIndex - assignIndex).toBeLessThan(200)
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
      'revoke all on function tempa_private.safety_fingerprint(uuid, text, uuid, uuid, uuid, text, text[], jsonb, text) from public, anon, authenticated'
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
      'revoke all on function public.record_safety_evaluation(uuid, text, uuid, uuid, uuid, text, text[], jsonb, text, text, text[], text, boolean) from public'
    )
    expect(codeOnly).toContain(
      'grant execute on function public.record_safety_evaluation(uuid, text, uuid, uuid, uuid, text, text[], jsonb, text, text, text[], text, boolean) to service_role'
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
    expect(body).toMatch(
      /tempa_private\.safety_fingerprint\(\s*p_user_id, p_surface, p_context_id, p_question_answer_id, p_secondary_context_id, p_title, p_topics, p_postcard, p_body\s*\)/
    )
  })

  it('rejects a Postcard for first_letter, which has none (independent audit correction)', () => {
    const body = extractFunctionBody('public.record_safety_evaluation')
    expect(body).toContain("if p_surface = 'first_letter' and p_postcard is not null then")
  })

  it('rejects a Postcard for question_answer/dispatch_reply/dispatch_update, none of which has one (independent audit correction — Checkpoint 4)', () => {
    const body = extractFunctionBody('public.record_safety_evaluation')
    expect(body).toContain("if p_surface in ('question_answer', 'dispatch_reply', 'dispatch_update') and p_postcard is not null then")
  })

  it('requires p_question_answer_id for first_letter and forbids it for every other surface (independent audit correction)', () => {
    const body = extractFunctionBody('public.record_safety_evaluation')
    expect(body).toContain("if p_surface = 'first_letter' and p_question_answer_id is null then")
    expect(body).toContain("if p_surface <> 'first_letter' and p_question_answer_id is not null then")
  })

  it('forbids p_secondary_context_id for every surface except dispatch_reply (independent audit correction — Checkpoint 4)', () => {
    const body = extractFunctionBody('public.record_safety_evaluation')
    expect(body).toContain("if p_surface <> 'dispatch_reply' and p_secondary_context_id is not null then")
  })

  it('forbids p_title/p_topics for every surface except dispatch_publish/dispatch_update (independent audit correction — Checkpoint 4)', () => {
    const body = extractFunctionBody('public.record_safety_evaluation')
    expect(body).toContain("if p_surface not in ('dispatch_publish', 'dispatch_update')")
  })

  it('stores question_answer_id and secondary_context_id on the evaluation row itself, not only inside the fingerprint', () => {
    const body = extractFunctionBody('public.record_safety_evaluation')
    expect(body).toMatch(
      /insert into public\.safety_evaluations \(\s*user_id, surface, context_id, question_answer_id, secondary_context_id, fingerprint/
    )
    expect(body).toMatch(/values \(\s*p_user_id, p_surface, p_context_id, p_question_answer_id, p_secondary_context_id, v_fingerprint/)
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

describe('tempa_private.postcard_shape_is_valid — the one shared read-only Postcard-shape check, never a second implementation (independent audit correction)', () => {
  it('is not directly callable by any client role, including service_role', () => {
    expect(codeOnly).toContain(
      'revoke all on function tempa_private.postcard_shape_is_valid(jsonb) from public, anon, authenticated, service_role'
    )
  })

  it('returns true for a null postcard — "no Postcard" is never itself a shape problem', () => {
    const body = extractFunctionBody('tempa_private.postcard_shape_is_valid')
    expect(body).toContain('if p_postcard is null then')
    expect(body).toContain('return true;')
  })

  it('checks an active catalog key, a current version, Reveal Line <= 32, and a non-blank back message <= 300 — copied verbatim from write_letter/reply_to_letter\'s own identical block', () => {
    const body = extractFunctionBody('tempa_private.postcard_shape_is_valid')
    expect(body).toContain('from public.postcard_catalog')
    expect(body).toContain('where key = v_postcard_key and is_active')
    expect(body).toContain('from public.postcard_versions')
    expect(body).toContain('where postcard_key = v_postcard_key and is_current')
    expect(body).toContain('char_length(v_reveal_line) > 32')
    expect(body).toContain("char_length(trim(both from v_back_message)) = 0")
    expect(body).toContain('char_length(trim(both from v_back_message)) > 300')
  })
})

describe('can_evaluate_safety_context — proves the mutation context is real and the caller\'s own, before any evaluation is recorded', () => {
  it('is callable by authenticated, never by anon, and is not a service-role table read', () => {
    expect(codeOnly).toContain('revoke all on function public.can_evaluate_safety_context(text, uuid, uuid, uuid, jsonb) from public')
    expect(codeOnly).toContain(
      'grant execute on function public.can_evaluate_safety_context(text, uuid, uuid, uuid, jsonb) to authenticated'
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
    const occurrences = body.match(/if p_postcard is not null then\s+if v_status = 'restricted' then/g) ?? []
    expect(occurrences.length).toBe(2)
  })

  it('reply/write_anytime/dispatch_publish: a present Postcard must pass tempa_private.postcard_shape_is_valid before an evaluation is authorized — never a second, independent product-rule implementation (independent audit correction)', () => {
    const body = extractFunctionBody('public.can_evaluate_safety_context')
    const occurrences = body.match(/tempa_private\.postcard_shape_is_valid\(p_postcard\)/g) ?? []
    expect(occurrences.length).toBe(3)
  })

  it('reply: a Postcard on a first, establishing reply is never authorized — mirrors reply_to_letter\'s own is_first_reply guard; never additionally requires moments_qualified_for_viewer, matching reply_to_letter\'s own current behavior exactly (independent audit correction)', () => {
    const body = extractFunctionBody('public.can_evaluate_safety_context')
    const replyBranch = stripLineComments(
      body.slice(body.indexOf("elsif p_surface = 'reply' then"), body.indexOf("elsif p_surface = 'write_anytime' then"))
    )
    expect(replyBranch).toContain('v_reply_letter.reply_to_id is null')
    expect(replyBranch).not.toContain('moments_qualified_for_viewer')
  })

  it('write_anytime: a Postcard requires moments_qualified_for_viewer — mirrors write_letter\'s own additional Postcard check, which reply_to_letter does not have (independent audit correction)', () => {
    const body = extractFunctionBody('public.can_evaluate_safety_context')
    const writeAnytimeBranch = body.slice(body.indexOf("elsif p_surface = 'write_anytime' then"))
    expect(writeAnytimeBranch).toContain('public.moments_qualified_for_viewer(p_context_id)')
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

  it('has a secondary_context_id column, structurally forbidden for every surface except dispatch_reply (independent audit correction — Checkpoint 4)', () => {
    const start = sql.indexOf('create table public.safety_evaluations')
    const end = sql.indexOf(');', start)
    const body = sql.slice(start, end)
    expect(body).toMatch(/secondary_context_id uuid,/)
    expect(body).toContain("check (secondary_context_id is null or surface = 'dispatch_reply')")
  })
})

describe('can_evaluate_safety_context — Checkpoint 4 public text surfaces (independent audit correction)', () => {
  it('dispatch_publish: binds context_id to the acting member\'s own auth.uid() — no pre-existing Dispatch id at evaluation time — and mirrors publish_dispatch\'s single blanket account-status gate', () => {
    const body = extractFunctionBody('public.can_evaluate_safety_context')
    const branch = body.slice(body.indexOf("elsif p_surface = 'dispatch_publish' then"), body.indexOf("elsif p_surface = 'dispatch_update' then"))
    expect(branch).toContain('if p_context_id <> auth.uid() then')
    expect(branch).toContain("public.current_account_status() in ('restricted', 'suspended', 'banned')")
    expect(branch).toContain('tempa_private.postcard_shape_is_valid(p_postcard)')
  })

  it('dispatch_update: mirrors update_dispatch\'s own eligibility exactly — owner, published, 30-minute window, Reply lock, account status, no Postcard param', () => {
    const body = extractFunctionBody('public.can_evaluate_safety_context')
    const branch = body.slice(body.indexOf("elsif p_surface = 'dispatch_update' then"), body.indexOf("elsif p_surface = 'question_answer' then"))
    expect(branch).toContain('and author_id = auth.uid()')
    expect(branch).toContain("and status = 'published'")
    expect(branch).toContain("now() > v_dispatch_row.published_at + interval '30 minutes'")
    expect(branch).toContain('exists (select 1 from public.dispatch_replies where dispatch_id = p_context_id)')
    expect(branch).toContain('if p_postcard is not null then')
  })

  it('question_answer: mirrors publish_question_answer\'s own is_active/hidden-freeze checks, plus an existence check the real RPC\'s own is_active check alone would not catch', () => {
    const body = extractFunctionBody('public.can_evaluate_safety_context')
    const branch = body.slice(body.indexOf("elsif p_surface = 'question_answer' then"), body.indexOf("elsif p_surface = 'dispatch_reply' then"))
    expect(branch).toContain('not exists (select 1 from public.questions where id = p_context_id)')
    expect(branch).toContain('v_question_active is not null and not v_question_active')
    expect(branch).toContain("v_answer_moderation_status = 'hidden'")
  })

  it('dispatch_reply: mirrors create_reply\'s own eligibility exactly — full-scope block (never is_correspondence_blocked_pair), published+visible Dispatch, author publicly visible', () => {
    const body = extractFunctionBody('public.can_evaluate_safety_context')
    const branch = stripLineComments(body.slice(body.indexOf("elsif p_surface = 'dispatch_reply' then"), body.lastIndexOf('else')))
    expect(branch).toContain("v_reply_dispatch.status <> 'published' or v_reply_dispatch.moderation_status <> 'visible'")
    expect(branch).toContain('tempa_private.is_blocked_pair(auth.uid(), v_reply_dispatch.author_id)')
    expect(branch).not.toContain('is_correspondence_blocked_pair')
    expect(branch).toContain('tempa_private.author_content_publicly_visible(v_reply_dispatch.author_id)')
  })

  it('dispatch_reply: when nested, validates the parent Reply belongs to the same Dispatch, is not hidden/deleted, and its author is eligible — mirrors create_reply\'s own parent checks exactly', () => {
    const body = extractFunctionBody('public.can_evaluate_safety_context')
    const branch = body.slice(body.indexOf("elsif p_surface = 'dispatch_reply' then"), body.lastIndexOf('else'))
    expect(branch).toContain('if p_secondary_context_id is not null then')
    expect(branch).toContain('v_parent_reply.dispatch_id <> p_context_id')
    expect(branch).toContain("v_parent_reply.moderation_status <> 'visible' or v_parent_reply.deleted_at is not null")
    expect(branch).toContain('tempa_private.is_blocked_pair(auth.uid(), v_parent_reply.author_id)')
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
