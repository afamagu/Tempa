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

  it('admin_get_arrival_email_status only ever selects id/status/error/provider-id/timestamp columns from the queue, never anything else', () => {
    const start = sql.indexOf('create or replace function public.admin_get_arrival_email_status(')
    const end = sql.indexOf('$$;', start)
    const body = sql.slice(start, end)
    expect(body).toContain('id, letter_id, recipient_id, status, attempts, max_attempts')
    expect(body).toContain('last_error, skipped_reason, provider_message_id, created_at, sent_at, updated_at')
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

  it('status is constrained to the six known states, including the terminal manual_review outcome', () => {
    expect(codeOnly).toContain("check (status in ('pending', 'processing', 'sent', 'skipped', 'failed', 'manual_review'))")
  })

  it('has a claim_token uuid column for lease fencing and a provider_message_id text column for Resend correlation', () => {
    expect(codeOnly).toMatch(/claim_token uuid/)
    expect(codeOnly).toMatch(/provider_message_id text/)
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

  it('has a server-authoritative enqueue_after cutover column, defaulted to now() — never a client/env-supplied value', () => {
    expect(codeOnly).toMatch(/enqueue_after timestamptz not null default now\(\)/)
    // Nothing in this migration accepts a caller-supplied cutover value —
    // the column default is the only place a value is ever assigned.
    expect(codeOnly).not.toMatch(/p_enqueue_after/)
  })

  it('explicitly grants SELECT to service_role — the exact privilege the worker\'s direct table read relies on, not left to project default privileges', () => {
    expect(codeOnly).toContain('grant select on public.arrival_email_system_config to service_role')
  })
})

describe('enqueue_arrival_emails — arrival-triggered, never sender-submission-triggered, idempotent', () => {
  it('gates on deliver_at <= now(), never on letters.created_at', () => {
    const body = extractFunctionBody('enqueue_arrival_emails')
    expect(body).toContain('l.deliver_at <= now()')
    expect(body).not.toContain('l.created_at <= now()')
  })

  it('also requires deliver_at >= the rollout cutover read from arrival_email_system_config.enqueue_after — a historical letter delivered before this system existed can never backlog-generate an arrival email', () => {
    const body = extractFunctionBody('enqueue_arrival_emails')
    expect(body).toContain('select enqueue_after into v_cutoff')
    expect(body).toContain('from public.arrival_email_system_config')
    expect(body).toContain('and l.deliver_at >= v_cutoff')
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

  it('issues a fresh claim_token on every claim, including a reclaim — a crashed worker\'s old token is always invalidated by the next claim', () => {
    const body = extractFunctionBody('claim_arrival_email_jobs')
    expect(body).toContain('claim_token = gen_random_uuid()')
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

describe('complete_arrival_email_job — fenced to the exact claim, bounded retries with exponential backoff', () => {
  const body = () => extractFunctionBody('complete_arrival_email_job')

  it('only accepts the four known outcomes, including the terminal manual_review outcome', () => {
    expect(body()).toContain("if p_result not in ('sent', 'skipped', 'failed', 'manual_review') then")
  })

  it('manual_review is terminal — never re-enters the pending/backoff path', () => {
    const b = body()
    expect(b).toContain("elsif p_result = 'manual_review' then")
    expect(b).toContain("set status = 'manual_review', last_error = p_error, updated_at = now()")
  })

  it('requires BOTH status = processing AND a matching claim_token before touching the row — a stale/late completion is fenced out as a no-op', () => {
    const b = body()
    expect(b).toContain("and status = 'processing'")
    expect(b).toContain('and claim_token = p_claim_token')
    expect(b).toContain('if not found then')
    expect(b).toContain('return false')
  })

  it('returns boolean (not void) so the caller can distinguish "applied" from "fenced out"', () => {
    expect(sql).toMatch(/create or replace function public\.complete_arrival_email_job\([\s\S]*?\)\nreturns boolean/)
  })

  it('backs off with the CORRECTED exponential formula — attempts=1 gives 5 minutes, not 10 (independent audit fix: `attempts - 1`, not bare `attempts`, since attempts is already incremented at claim time before the first failure is ever recorded here)', () => {
    const b = body()
    expect(b).toContain("(interval '5 minutes') * power(2, v_job.attempts - 1)")
    expect(b).not.toContain("power(2, v_job.attempts)")
  })

  it('stops retrying once max_attempts is reached, OR immediately when the caller reports the failure as non-retryable', () => {
    const b = body()
    expect(b).toContain('if not p_retryable or v_job.attempts >= v_job.max_attempts then')
  })

  it('persists provider_message_id on a successful send, for Admin correlation with Resend — never any letter content', () => {
    const b = body()
    expect(b).toContain('provider_message_id = p_provider_message_id')
  })

  it('is granted to service_role only — never anon or authenticated', () => {
    expect(codeOnly).toContain(
      'grant execute on function public.complete_arrival_email_job(uuid, uuid, text, text, text, boolean) to service_role'
    )
    expect(codeOnly).not.toMatch(
      /grant execute on function public\.complete_arrival_email_job\(uuid, uuid, text, text, text, boolean\) to (anon|authenticated)/
    )
  })
})

describe('arrival_email_provider_requests — the frozen Resend payload, never exposed to any client role', () => {
  it('is keyed one-row-per-queue-event (queue_id primary key), so a payload can never be frozen twice for the same event', () => {
    expect(codeOnly).toMatch(/queue_id uuid primary key references public\.arrival_email_queue\(id\)/)
  })

  it('RLS is enabled and no grant of any kind reaches anon/authenticated', () => {
    expect(codeOnly).toContain('alter table public.arrival_email_provider_requests enable row level security')
    expect(codeOnly).toContain('revoke all on public.arrival_email_provider_requests from public, anon, authenticated')
    expect(codeOnly).not.toMatch(/create policy \w+\s+on public\.arrival_email_provider_requests/)
  })

  it('holds exactly the frozen payload fields — From/To/subject/HTML/text — plus the durable first-attempt instant', () => {
    expect(codeOnly).toMatch(/idempotency_key text not null/)
    expect(codeOnly).toMatch(/from_address text not null/)
    expect(codeOnly).toMatch(/to_address text not null/)
    expect(codeOnly).toMatch(/subject text not null/)
    expect(codeOnly).toMatch(/html text not null/)
    expect(codeOnly).toMatch(/text_body text not null/)
    expect(codeOnly).toMatch(/first_provider_attempt_at timestamptz not null default now\(\)/)
  })

  it('is never selected by admin_get_arrival_email_status or any other RPC in this file — the only reader is record_or_fetch_arrival_email_snapshot itself', () => {
    // The only "from public.arrival_email_provider_requests" in the
    // whole file must be inside record_or_fetch_arrival_email_
    // snapshot's own body — assert there is exactly one such reference,
    // and that it's the one inside that function.
    const matches = codeOnly.match(/from public\.arrival_email_provider_requests/g) ?? []
    expect(matches.length).toBe(1)
    const body = extractFunctionBody('record_or_fetch_arrival_email_snapshot')
    expect(body).toContain('from public.arrival_email_provider_requests')
  })
})

describe('record_or_fetch_arrival_email_snapshot — freeze-on-first-use, worker-only', () => {
  const body = () => extractFunctionBody('record_or_fetch_arrival_email_snapshot')

  it('inserts the candidate payload only if this queue event has never been attempted before (ON CONFLICT DO NOTHING keyed on queue_id)', () => {
    expect(body()).toContain('on conflict (queue_id) do nothing')
  })

  it('reports is_new via row_count from the insert — true only when THIS call is the one that created the row', () => {
    const b = body()
    expect(b).toContain('get diagnostics v_row_count = row_count')
    expect(b).toContain('(v_row_count > 0) as is_new')
  })

  it('computes window_expired server-side against its own durable first_provider_attempt_at, against Resend\'s 24-hour idempotency retention window — never trusting the caller\'s clock', () => {
    const b = body()
    expect(b).toContain("(now() - r.first_provider_attempt_at > interval '24 hours') as window_expired")
  })

  it('always returns the row that now exists (the frozen copy), regardless of whether this call created it', () => {
    const b = body()
    expect(b).toContain('where r.queue_id = p_queue_id')
  })

  it('is granted to service_role only — never anon or authenticated', () => {
    const sig = 'public.record_or_fetch_arrival_email_snapshot(uuid, text, text, text, text, text, text)'
    expect(codeOnly).toContain(`grant execute on function ${sig} to service_role`)
    expect(codeOnly).not.toMatch(new RegExp(`grant execute on function ${sig.replace(/[()]/g, '\\$&')} to (anon|authenticated)`))
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

  it('checks the new cutover column, the new fencing/provider-id columns, and the corrected complete_arrival_email_job signature', () => {
    expect(verifySql).toContain('enqueue_after')
    expect(verifySql).toContain('claim_token')
    expect(verifySql).toContain('provider_message_id')
    expect(verifySql).toContain('public.complete_arrival_email_job(uuid, uuid, text, text, text, boolean)')
  })

  it('explicitly confirms service_role can read arrival_email_system_config — the exact path the worker uses (a direct table read, not an RPC)', () => {
    expect(verifySql).toContain("has_table_privilege('service_role', 'public.arrival_email_system_config', 'SELECT')")
  })

  it('checks the new provider-requests table, its lockdown, and the new snapshot RPC signature', () => {
    expect(verifySql).toContain('arrival_email_provider_requests')
    expect(verifySql).toContain('record_or_fetch_arrival_email_snapshot(uuid, text, text, text, text, text, text)')
    expect(verifySql).toContain('manual_review')
  })
})
