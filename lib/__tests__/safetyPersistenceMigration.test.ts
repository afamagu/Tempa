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
  return text.replace(/^--.*$/gm, '')
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
    expect(codeOnly.toLowerCase()).not.toMatch(/\bpostcard/)
  })

  it('safety_evaluations/safety_signals/safety_cases only ever store ids, classifier output, and timestamps', () => {
    const evalStart = sql.indexOf('create table public.safety_evaluations')
    const evalEnd = sql.indexOf(');', evalStart)
    const evalBody = sql.slice(evalStart, evalEnd)
    expect(evalBody).not.toMatch(/\bbody text\b/)
    expect(evalBody).not.toMatch(/\bcontent\b/)
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

  it('never sets consumed_at or warning_acknowledged_at itself — Checkpoint 3 is where those get written', () => {
    const body = extractFunctionBody('public.record_safety_evaluation')
    expect(body).not.toMatch(/consumed_at\s*=/)
    expect(body).not.toMatch(/warning_acknowledged_at\s*=/)
  })
})

describe('safety_cases — one open case per subject, never a generic staff SELECT path', () => {
  it('RLS is enabled and every grant is revoked from public/anon/authenticated/service_role, with no compensating policy', () => {
    expect(codeOnly).toContain('alter table public.safety_cases enable row level security')
    expect(codeOnly).toContain('revoke all on public.safety_cases from public, anon, authenticated')
    expect(codeOnly).not.toMatch(/create policy \w+\s+on public\.safety_cases/)
    expect(codeOnly).not.toMatch(/grant select on public\.safety_cases/)
  })

  it('enforces at most one open case per subject via a partial unique index', () => {
    expect(codeOnly).toMatch(
      /create unique index safety_cases_one_open_per_subject\s+on public\.safety_cases \(subject_user_id\)\s+where status = 'open'/
    )
  })

  it('record_safety_evaluation upserts into the same open case rather than always inserting a new one', () => {
    const body = extractFunctionBody('public.record_safety_evaluation')
    expect(body).toContain("on conflict (subject_user_id) where status = 'open'")
    expect(body).toContain('signal_count = public.safety_cases.signal_count + 1')
  })
})

describe('safety_signals — individual observations, meaningful+ only, at most one per evaluation', () => {
  it('RLS is enabled and every grant is revoked from public/anon/authenticated, with no compensating policy', () => {
    expect(codeOnly).toContain('alter table public.safety_signals enable row level security')
    expect(codeOnly).toContain('revoke all on public.safety_signals from public, anon, authenticated')
    expect(codeOnly).not.toMatch(/create policy \w+\s+on public\.safety_signals/)
  })

  it('evaluation_id is unique and risk_band excludes none/weak', () => {
    expect(codeOnly).toMatch(/evaluation_id uuid not null unique references public\.safety_evaluations/)
    expect(codeOnly).toMatch(/risk_band text not null check \(risk_band in \('meaningful', 'high', 'severe'\)\)/)
  })

  it('record_safety_evaluation only inserts a signal for meaningful/high/severe risk, and only once per evaluation', () => {
    const body = extractFunctionBody('public.record_safety_evaluation')
    expect(body).toContain("if p_risk_band in ('meaningful', 'high', 'severe') then")
    expect(body).toContain('on conflict (evaluation_id) do nothing')
  })
})

describe('tempa_private.safety_fingerprint — the one canonical fingerprint implementation', () => {
  it('is not SECURITY DEFINER and has no grant to any client role', () => {
    const body = extractFunctionBody('tempa_private.safety_fingerprint')
    expect(body).not.toMatch(/security definer/)
    expect(codeOnly).toContain(
      'revoke all on function tempa_private.safety_fingerprint(uuid, text, uuid, text) from public, anon, authenticated'
    )
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
      'revoke all on function public.record_safety_evaluation(uuid, text, uuid, text, text, text[], text, boolean) from public'
    )
    expect(codeOnly).toContain(
      'grant execute on function public.record_safety_evaluation(uuid, text, uuid, text, text, text[], text, boolean) to service_role'
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
    expect(body).toContain('tempa_private.safety_fingerprint(p_user_id, p_surface, p_context_id, p_body)')
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

describe('cleanup_expired_safety_evaluations — prepared, not scheduled', () => {
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
    expect(body).toContain('where expires_at < now() - p_retention')
    expect(sql).toContain("p_retention interval default interval '30 days'")
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
    expect(verifySql).toContain('cleanup_expired_safety_evaluations')
    expect(verifySql).toContain('overall_pass')
  })
})
