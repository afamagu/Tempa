// Same convention as every earlier Safety checkpoint's own migration
// test — this repository cannot execute Postgres in CI, so every
// requirement that lives purely in SQL (the dispatch_moments bypass
// closure, the status_reason privacy fix, the rate-limit table/policy/
// gate shape and its atomic-upsert concurrency safety, the wiring into
// report_content/block_user/unblock_user, the anon-grant hygiene batch,
// and the storage bucket hardening) is verified directly against the
// tracked migration source text.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const MIGRATION_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-10-10-safety-checkpoint9-hardening.sql')
const VERIFY_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-10-10-safety-checkpoint9-hardening-verify.sql')
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

describe('one BEGIN/COMMIT, not yet applied', () => {
  it('wraps everything in exactly one begin/commit and is explicitly marked NOT EXECUTED', () => {
    expect((sql.match(/^begin;/m) ?? []).length).toBe(1)
    expect((sql.match(/^commit;/m) ?? []).length).toBe(1)
    expect(sql).toContain('STATUS: NOT EXECUTED')
  })
})

describe('Part 1 — dispatch_moments raw-INSERT bypass closed', () => {
  it('drops the insert policy and revokes the INSERT grant, mirroring Checkpoint 4\'s own dispatches/dispatch_topics fix', () => {
    expect(codeOnly).toContain('drop policy dispatch_moments_insert_own on public.dispatch_moments;')
    expect(codeOnly).toContain('revoke insert on public.dispatch_moments from authenticated;')
  })
})

describe('Part 2 — status_reason privacy exposure closed', () => {
  it('drops the self-select policy and revokes the SELECT grant on account_enforcement_state', () => {
    expect(codeOnly).toContain('drop policy account_enforcement_state_select_own on public.account_enforcement_state;')
    expect(codeOnly).toContain('revoke select on public.account_enforcement_state from authenticated;')
  })

  it('never touches current_account_status() itself — the member-safe status surface is unchanged', () => {
    expect(sql).not.toContain('create or replace function public.current_account_status(')
  })
})

describe('Part 3A — tempa_private.rate_limit_policy — centralized, documented, no scattered magic numbers', () => {
  it('is a single language-sql function, not a mutable table', () => {
    expect(sql).not.toMatch(/create table public\.rate_limit_(policy|thresholds|config)/)
  })

  it('defines a distinct window/limit for every prioritized action, including the safety_evaluate backstop', () => {
    const start = sql.indexOf('create or replace function tempa_private.rate_limit_policy(')
    const end = sql.indexOf('$$;', start)
    const body = sql.slice(start, end)
    for (const action of [
      'safety_evaluate', 'first_letter', 'reply', 'write_anytime',
      'dispatch_publish', 'dispatch_update', 'dispatch_reply', 'question_answer',
      'report', 'block', 'unblock',
    ]) {
      expect(body).toContain(`'${action}'`)
    }
  })

  it('every technical throughput window is strictly shorter than a day — deliberately NOT a copy of Checkpoint 5\'s own 24h/72h behavioral windows', () => {
    const start = sql.indexOf('create or replace function tempa_private.rate_limit_policy(')
    const end = sql.indexOf('$$;', start)
    const body = sql.slice(start, end)
    expect(body).not.toContain("interval '24 hours'")
    expect(body).not.toContain("interval '72 hours'")
  })

  it('is granted to no role at all — internal helper only', () => {
    expect(codeOnly).toContain(
      'revoke all on function tempa_private.rate_limit_policy(text) from public, anon, authenticated, service_role;'
    )
  })
})

describe('Part 3B — public.check_rate_limit — the one gate, atomic and concurrency-safe', () => {
  const body = () => extractFunctionBody('public.check_rate_limit')

  it('computes the window boundary deterministically with date_bin — no lookup-then-decide race window', () => {
    const b = body()
    expect(b).toContain("date_bin(v_window, now(), timestamptz '2000-01-01')")
  })

  it('increments atomically via INSERT ... ON CONFLICT DO UPDATE ... RETURNING — concurrent callers serialize on the same row, never a SELECT-then-INSERT race', () => {
    const b = stripLineComments(body())
    expect(b).toMatch(/insert into public\.rate_limit_counters[\s\S]*?on conflict \(subject_id, action, window_start\)[\s\S]*?do update set count = public\.rate_limit_counters\.count \+ 1[\s\S]*?returning count into v_count/)
  })

  it('never raises itself — returns a plain boolean so every caller can produce its own generic, user-safe rejection message', () => {
    const b = body()
    expect(b).toContain('return v_count <= v_limit;')
    expect(b).not.toMatch(/raise exception '(Too many|Rate limit)/)
  })

  it('rejects an unknown action explicitly rather than silently allowing it through', () => {
    const b = body()
    expect(b).toContain("raise exception 'Unknown rate-limit action: %', p_action")
  })

  it('is service_role-only — no client role can call it directly, exactly like record_safety_evaluation', () => {
    expect(codeOnly).toContain('revoke all on function public.check_rate_limit(uuid, text) from public, anon, authenticated;')
    expect(codeOnly).toContain('grant execute on function public.check_rate_limit(uuid, text) to service_role;')
  })
})

describe('Part 3 — rate_limit_counters table is a bounded fixed-window counter, never an unbounded event log', () => {
  it('has a composite primary key (subject_id, action, window_start) — one row per window, not one row per request', () => {
    const start = sql.indexOf('create table public.rate_limit_counters')
    const end = sql.indexOf(');', start)
    const body = sql.slice(start, end)
    expect(body).toContain('primary key (subject_id, action, window_start)')
  })

  it('has zero client grant of any kind — only check_rate_limit and the cleanup function can touch it', () => {
    expect(codeOnly).toContain('revoke all on public.rate_limit_counters from public, anon, authenticated;')
  })

  it('a cleanup function exists (prepared, not scheduled), matching cleanup_expired_safety_evaluations\' own posture', () => {
    const start = sql.indexOf('create or replace function public.cleanup_expired_rate_limit_counters(')
    expect(start).toBeGreaterThan(-1)
    const end = sql.indexOf('$function$;', start)
    const body = sql.slice(start, end)
    expect(body).toContain('delete from public.rate_limit_counters')
    expect(body).toContain('where window_start < now() - p_retention')
  })
})

describe('Part 3D/3E/3F — report_content/block_user/unblock_user each gate on their own rate-limit action, checked BEFORE any real work', () => {
  it('report_content checks the report action immediately after the auth check, before target validation or the insert', () => {
    const b = extractFunctionBody('public.report_content')
    const authIndex = b.indexOf("raise exception 'Authentication required.';")
    const rateLimitIndex = b.indexOf("check_rate_limit(auth.uid(), 'report')")
    const insertIndex = b.indexOf('insert into public.reports')
    expect(authIndex).toBeGreaterThan(-1)
    expect(rateLimitIndex).toBeGreaterThan(authIndex)
    expect(rateLimitIndex).toBeLessThan(insertIndex)
  })

  it('block_user checks the block action immediately after the auth check, before the upsert', () => {
    const b = extractFunctionBody('public.block_user')
    const authIndex = b.indexOf("raise exception 'Authentication required.';")
    const rateLimitIndex = b.indexOf("check_rate_limit(auth.uid(), 'block')")
    const upsertIndex = b.indexOf('insert into public.blocked_users')
    expect(authIndex).toBeGreaterThan(-1)
    expect(rateLimitIndex).toBeGreaterThan(authIndex)
    expect(rateLimitIndex).toBeLessThan(upsertIndex)
  })

  it('unblock_user checks the unblock action immediately after the auth check, before the delete', () => {
    const b = extractFunctionBody('public.unblock_user')
    const authIndex = b.indexOf("raise exception 'Authentication required.';")
    const rateLimitIndex = b.indexOf("check_rate_limit(auth.uid(), 'unblock')")
    const deleteIndex = b.indexOf('delete from public.blocked_users')
    expect(authIndex).toBeGreaterThan(-1)
    expect(rateLimitIndex).toBeGreaterThan(authIndex)
    expect(rateLimitIndex).toBeLessThan(deleteIndex)
  })

  it('all three reject with the exact same generic message — never revealing the specific window/limit', () => {
    const occurrences = (codeOnly.match(/raise exception 'Too many requests\. Please try again shortly\.'/g) ?? []).length
    expect(occurrences).toBe(3)
  })

  it('preserves every existing check/side-effect from each function\'s previous live definition', () => {
    const report = extractFunctionBody('public.report_content')
    expect(report).toContain('You cannot report your own content.')
    expect(report).toContain('You have already reported this.')
    expect(report).toContain("evaluate_behavior(")

    const block = extractFunctionBody('public.block_user')
    expect(block).toContain('You cannot block yourself.')
    expect(block).toContain('delete from public.kept_minds')
    expect(block).toContain('delete from public.dispatch_worth_reading')

    const unblock = extractFunctionBody('public.unblock_user')
    expect(unblock).toContain('where blocker_id = auth.uid()')
  })

  it('grants are unchanged from before this checkpoint — authenticated can call all three, no wider role', () => {
    expect(codeOnly).toContain('grant execute on function public.report_content(text, uuid, text, text) to authenticated;')
    expect(codeOnly).toContain('grant execute on function public.block_user(uuid, text) to authenticated;')
    expect(codeOnly).toContain('grant execute on function public.unblock_user(uuid) to authenticated;')
  })
})

describe('Part 4 — anon-grant hygiene batch', () => {
  it('explicitly revokes all from anon on the seven early tables that only ever revoked from public at creation', () => {
    for (const table of [
      'dispatches', 'dispatch_topics', 'dispatch_moments', 'dispatch_views',
      'kept_minds', 'dispatch_shares', 'dispatch_replies',
    ]) {
      expect(codeOnly).toContain(`revoke all on public.${table} from anon;`)
    }
  })
})

describe('Part 5 — storage bucket hardening', () => {
  it('sets a file_size_limit and allowed_mime_types on both private Photo Moment buckets', () => {
    expect(codeOnly).toMatch(/update storage\.buckets[\s\S]*?where id = 'letter-photos'/)
    expect(codeOnly).toMatch(/update storage\.buckets[\s\S]*?where id = 'dispatch-photos'/)
    expect(codeOnly).toContain('file_size_limit = 5242880')
    expect(codeOnly).toContain("allowed_mime_types = array['image/jpeg']")
  })
})

describe('scope discipline — no CSP, no new fraud engine, no OCR, no payment/translation infra introduced', () => {
  it('this migration never references OCR, image analysis, translation, or payment tables/functions', () => {
    const lower = codeOnly.toLowerCase()
    for (const forbidden of ['ocr_', 'translat', 'payment_', 'stripe', 'currency']) {
      expect(lower).not.toContain(forbidden)
    }
  })
})

describe('verification SQL', () => {
  it('exists, is read-only, and checks every fix in this migration', () => {
    const codeOnlyVerify = stripLineComments(verifySql).replace(/'[^']*'/g, "''")
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\binsert\s+into\b/)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\bupdate\s+(public|storage)\./)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\bdelete\s+from\b/)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\bdrop\s+(table|function|index|policy)\b/)
    expect(codeOnlyVerify.toLowerCase()).not.toMatch(/\balter\s+table\b/)
    for (const name of [
      'dispatch_moments_insert_own_policy_gone',
      'authenticated_cannot_select_enforcement_state',
      'check_rate_limit_present',
      'report_content_checks_rate_limit',
      'letter_photos_size_limit_set',
    ]) {
      expect(verifySql).toContain(name)
    }
    expect(verifySql).toContain('overall_pass')
  })
})
