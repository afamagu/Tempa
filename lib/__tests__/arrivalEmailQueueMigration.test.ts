// This repository cannot execute Postgres in CI, so every requirement
// that lives purely in SQL (grant/revoke pairs, RLS policies, the
// worker-only vs. staff-gated authorization split, retry/claim safety,
// and the never-touch-letter-content privacy rule) is verified
// directly against the tracked migration source text — same
// convention as adultEligibilityMigration.test.ts/
// postcardAdminMigration.test.ts.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const MIGRATION_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-10-01-arrival-email-delivery.sql')
const VERIFY_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-10-01-arrival-email-delivery-verify.sql')
const sql = readFileSync(MIGRATION_PATH, 'utf8')
const verifySql = readFileSync(VERIFY_PATH, 'utf8')

function stripLineComments(text: string): string {
  return text.replace(/^--.*$/gm, '')
}
const codeOnly = stripLineComments(sql)

function extractFunctionBody(functionName: string): string {
  const start = sql.indexOf(`create or replace function public.${functionName}(`)
  expect(start, `expected to find "${functionName}" defined in ${MIGRATION_PATH}`).toBeGreaterThan(-1)
  const end = sql.indexOf('$$;', start)
  expect(end, `expected a closing $$; for "${functionName}"`).toBeGreaterThan(start)
  return sql.slice(start, end)
}

describe('one BEGIN/COMMIT, not yet applied', () => {
  it('wraps everything in exactly one begin/commit and is explicitly marked NOT EXECUTED', () => {
    expect((sql.match(/^begin;/m) ?? []).length).toBe(1)
    expect((sql.match(/^commit;/m) ?? []).length).toBe(1)
    expect(sql).toContain('STATUS: NOT EXECUTED')
    expect(sql).not.toContain('STATUS: LIVE')
  })

  it('never recreates letters/correspondences/profiles/blocked_users/account_enforcement_state/correspondence_hidden_for_user — additive only', () => {
    expect(sql).not.toMatch(/create table public\.letters/)
    expect(sql).not.toMatch(/create table public\.correspondences/)
    expect(sql).not.toMatch(/create table public\.profiles/)
    expect(sql).not.toMatch(/create table public\.blocked_users/)
    expect(sql).not.toMatch(/create table public\.account_enforcement_state/)
    expect(sql).not.toMatch(/create table public\.correspondence_hidden_for_user/)
  })
})

describe('privacy — never touches letter body, Moment, or Postcard content', () => {
  it('never selects, returns, or references letters.body anywhere in the migration', () => {
    expect(codeOnly.toLowerCase()).not.toMatch(/\bbody\b/)
  })

  it('never mentions moments or postcards tables', () => {
    expect(codeOnly.toLowerCase()).not.toMatch(/\bmoments\b/)
    expect(codeOnly.toLowerCase()).not.toMatch(/\bpostcard/)
  })

  it('admin_get_arrival_email_status only ever selects id/status/error/timestamp columns from the queue, never anything else', () => {
    const start = sql.indexOf('create or replace function public.admin_get_arrival_email_status(')
    const end = sql.indexOf('$$;', start)
    const body = sql.slice(start, end)
    expect(body).toContain('id, letter_id, recipient_id, status, attempts, max_attempts')
    expect(body).toContain('last_error, skipped_reason, created_at, sent_at, updated_at')
  })
})

describe('arrival_email_preferences — self-scoped, default enabled, RPC-only writes', () => {
  it('RLS is scoped to auth.uid() = user_id, grants SELECT only to authenticated, nothing to anon', () => {
    expect(codeOnly).toContain('create policy arrival_email_preferences_own')
    expect(codeOnly).toContain('auth.uid() = user_id')
    expect(codeOnly).toContain('revoke all on public.arrival_email_preferences from public, anon, authenticated')
    expect(codeOnly).toContain('grant select on public.arrival_email_preferences to authenticated')
    expect(codeOnly).not.toMatch(/grant\s+insert.*on\s+public\.arrival_email_preferences/i)
    expect(codeOnly).not.toMatch(/grant\s+update.*on\s+public\.arrival_email_preferences/i)
  })

  it('defaults arrival_emails_enabled to true, so a member with no row yet is still opted in', () => {
    expect(codeOnly).toMatch(/arrival_emails_enabled boolean not null default true/)
  })

  it('set_arrival_email_preference identifies the caller only via auth.uid(), never a client-supplied user id, and is authenticated-only', () => {
    const body = extractFunctionBody('set_arrival_email_preference')
    expect(body).not.toContain('p_user_id')
    expect(body).toContain('auth.uid() is null')
    expect(body).toContain('values (auth.uid(), p_enabled, now())')
    expect(codeOnly).toContain('grant execute on function public.set_arrival_email_preference(boolean) to authenticated')
    expect(codeOnly).not.toMatch(/grant execute on function public\.set_arrival_email_preference\(boolean\) to (anon|service_role)/)
  })
})

describe('arrival_email_queue — no client access at all, letter_id is the idempotency key', () => {
  it('RLS is enabled and every grant is revoked from public/anon/authenticated, with no compensating policy', () => {
    expect(codeOnly).toContain('alter table public.arrival_email_queue enable row level security')
    expect(codeOnly).toContain('revoke all on public.arrival_email_queue from public, anon, authenticated')
    expect(codeOnly).not.toMatch(/create policy \w+\s+on public\.arrival_email_queue/)
  })

  it('letter_id is unique — one queue row per letter no matter how many times enqueue runs', () => {
    expect(codeOnly).toMatch(/letter_id uuid not null unique references public\.letters\(id\)/)
  })

  it('status is constrained to the five known states', () => {
    expect(codeOnly).toContain("check (status in ('pending', 'processing', 'sent', 'skipped', 'failed'))")
  })
})

describe('arrival_email_system_config — singleton kill switch, starts disabled', () => {
  it('is a true singleton (boolean primary key + check(id)) and no client role can read or write it directly', () => {
    expect(codeOnly).toContain('id boolean primary key default true')
    expect(codeOnly).toContain('constraint arrival_email_system_config_singleton check (id)')
    expect(codeOnly).toContain('revoke all on public.arrival_email_system_config from public, anon, authenticated')
    expect(codeOnly).not.toMatch(/create policy \w+\s+on public\.arrival_email_system_config/)
  })

  it('the seeded row starts with sending_enabled = false — nothing sends until staff explicitly enables it', () => {
    expect(codeOnly).toMatch(/insert into public\.arrival_email_system_config \(id, sending_enabled\)\s*\n\s*values \(true, false\)/)
  })
})

describe('enqueue_arrival_emails — arrival-triggered, never sender-submission-triggered, idempotent', () => {
  it('gates on deliver_at <= now(), never on letters.created_at', () => {
    const body = extractFunctionBody('enqueue_arrival_emails')
    expect(body).toContain('l.deliver_at <= now()')
    expect(body).not.toContain('l.created_at <= now()')
  })

  it('is idempotent via both an anti-join and ON CONFLICT DO NOTHING keyed on the unique letter_id', () => {
    const body = extractFunctionBody('enqueue_arrival_emails')
    expect(body).toContain('left join public.arrival_email_queue q on q.letter_id = l.id')
    expect(body).toContain('and q.id is null')
    expect(body).toContain('on conflict (letter_id) do nothing')
  })

  it('is granted to service_role only — never anon or authenticated', () => {
    expect(codeOnly).toContain('grant execute on function public.enqueue_arrival_emails() to service_role')
    expect(codeOnly).not.toMatch(/grant execute on function public\.enqueue_arrival_emails\(\) to (anon|authenticated)/)
  })
})

describe('claim_arrival_email_jobs — safe against overlapping scheduler runs', () => {
  it('uses FOR UPDATE SKIP LOCKED so two concurrent runs never claim the same job', () => {
    const body = extractFunctionBody('claim_arrival_email_jobs')
    expect(body).toContain('for update skip locked')
  })

  it('reclaims jobs stuck in processing for more than 15 minutes, so a crashed worker cannot strand a job forever', () => {
    const body = extractFunctionBody('claim_arrival_email_jobs')
    expect(body).toContain("q.status = 'processing' and q.claimed_at < now() - interval '15 minutes'")
  })

  it('increments attempts at claim time and is granted to service_role only', () => {
    const body = extractFunctionBody('claim_arrival_email_jobs')
    expect(body).toContain('attempts = q.attempts + 1')
    expect(codeOnly).toContain('grant execute on function public.claim_arrival_email_jobs(integer, text) to service_role')
    expect(codeOnly).not.toMatch(/grant execute on function public\.claim_arrival_email_jobs\(integer, text\) to (anon|authenticated)/)
  })
})

describe('resolve_arrival_email_context — send-time revalidation, checked fresh, never trusted from enqueue time', () => {
  const body = () => extractFunctionBody('resolve_arrival_email_context')

  it('rejects a recipient whose account is not active', () => {
    expect(body()).toContain("v_recipient_status is not null and v_recipient_status <> 'active'")
  })

  it('reuses tempa_private.is_correspondence_blocked_pair (any scope, either direction) rather than re-deriving block logic', () => {
    const b = body()
    expect(b).toContain('tempa_private.is_correspondence_blocked_pair(v_letter.sender_id, v_letter.recipient_id)')
    expect(codeOnly).not.toMatch(/create (or replace )?function tempa_private\.is_correspondence_blocked_pair/)
  })

  it("rejects a correspondence the recipient has hidden, keyed on the recipient's own hide (not the sender's)", () => {
    const b = body()
    expect(b).toContain('h.user_id = v_letter.recipient_id')
    expect(b).toContain('h.correspondence_id = v_letter.correspondence_id')
  })

  it('rejects when the recipient has explicitly disabled the preference, but not when no preference row exists', () => {
    expect(body()).toContain('v_pref_enabled is false')
  })

  it('requires a resolvable recipient email before returning eligible', () => {
    expect(body()).toContain('v_email is null')
  })

  it('derives first_contact from correspondences.established_at, not from letters.reply_to_id', () => {
    const b = body()
    expect(b).toContain('c.established_at')
    expect(b).toContain('(v_established_at is null)')
    expect(b).not.toContain('reply_to_id is null')
  })

  it('is granted to service_role only — never anon or authenticated', () => {
    expect(codeOnly).toContain('grant execute on function public.resolve_arrival_email_context(uuid) to service_role')
    expect(codeOnly).not.toMatch(/grant execute on function public\.resolve_arrival_email_context\(uuid\) to (anon|authenticated)/)
  })
})

describe('complete_arrival_email_job — bounded retries with exponential backoff', () => {
  const body = () => extractFunctionBody('complete_arrival_email_job')

  it('only accepts the three known outcomes', () => {
    expect(body()).toContain("if p_result not in ('sent', 'skipped', 'failed') then")
  })

  it('backs off exponentially while attempts remain, and stops retrying once max_attempts is reached', () => {
    const b = body()
    expect(b).toContain('v_job.attempts >= v_job.max_attempts')
    expect(b).toContain("(interval '5 minutes') * power(2, v_job.attempts)")
  })

  it('is granted to service_role only — never anon or authenticated', () => {
    expect(codeOnly).toContain('grant execute on function public.complete_arrival_email_job(uuid, text, text) to service_role')
    expect(codeOnly).not.toMatch(/grant execute on function public\.complete_arrival_email_job\(uuid, text, text\) to (anon|authenticated)/)
  })
})

describe('staff surfaces — self-gated via is_staff(), reachable by authenticated, blocked for anon', () => {
  it('admin_get_arrival_email_status requires at least moderator', () => {
    const start = sql.indexOf('create or replace function public.admin_get_arrival_email_status(')
    const end = sql.indexOf('$$;', start)
    const body = sql.slice(start, end)
    expect(body).toContain("public.is_staff('moderator')")
    expect(codeOnly).toContain('grant execute on function public.admin_get_arrival_email_status() to authenticated')
  })

  it('set_arrival_email_sending_enabled requires admin (a higher bar than the read-only status RPC) and is audit-logged', () => {
    const body = extractFunctionBody('set_arrival_email_sending_enabled')
    expect(body).toContain("public.is_staff('admin')")
    expect(body).toContain('insert into public.admin_audit_log')
    expect(codeOnly).toContain('grant execute on function public.set_arrival_email_sending_enabled(boolean) to authenticated')
  })
})

describe('every SECURITY DEFINER function is search_path-hardened', () => {
  it('every "security definer" function in this file sets search_path to pg_catalog', () => {
    const definerCount = (codeOnly.match(/security definer/g) ?? []).length
    const searchPathCount = (codeOnly.match(/set search_path to 'pg_catalog'/g) ?? []).length
    expect(definerCount).toBeGreaterThan(0)
    expect(searchPathCount).toBe(definerCount)
  })
})

describe('verify file exists and targets this migration', () => {
  it('references the same table and function names this migration defines', () => {
    expect(verifySql).toContain('arrival_email_queue')
    expect(verifySql).toContain('arrival_email_preferences')
    expect(verifySql).toContain('arrival_email_system_config')
    expect(verifySql).toContain('overall_pass')
  })
})
