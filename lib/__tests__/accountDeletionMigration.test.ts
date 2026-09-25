// Same convention as the other migration tests — CI cannot execute
// Postgres, so the tracked SQL is inspected directly. The migration +
// verifier were also executed on real PostgreSQL (PGlite, outside the
// repo) together with the real discover_people, get_member_introductions
// and member publish_dispatch/update_dispatch; see the PR.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'sql')
const read = (n: string) => readFileSync(path.join(SQL_DIR, n), 'utf8').replace(/\r\n/g, '\n')
const migration = read('2026-10-16-account-deletion.sql')
const verify = read('2026-10-16-account-deletion-verify.sql')
const code = migration.replace(/^\s*--.*$/gm, '')

const fn = (name: string, end = '$function$;') => {
  const start = code.indexOf(`create or replace function ${name}(`)
  expect(start, name).toBeGreaterThan(-1)
  return code.slice(start, code.indexOf(end, start))
}
const close = () => fn('public.close_my_account')

describe('forward-only', () => {
  it('one transaction, NOT EXECUTED, never deletes auth users', () => {
    expect((migration.match(/^begin;/gm) ?? []).length).toBe(1)
    expect((migration.match(/^commit;/gm) ?? []).length).toBe(1)
    expect(migration).toContain('STATUS: NOT EXECUTED')
    expect(code).not.toMatch(/delete from auth\.users/i)
    expect(code).not.toMatch(/\bdrop\b/i)
  })
})

describe('closure state', () => {
  it('explicit account_closures table, RLS on, no member policy or privilege', () => {
    expect(code).toContain('create table if not exists public.account_closures (')
    expect(code).toContain('alter table public.account_closures enable row level security;')
    expect(code).toContain('revoke all on public.account_closures from public, anon, authenticated;')
    expect(code).not.toMatch(/create policy[^;]*account_closures/)
    expect(code).not.toMatch(/grant [^;]* on public\.account_closures/)
  })
})

describe('close_my_account — self only, retry-safe', () => {
  it('no target argument; caller from auth.uid(); anonymous rejected', () => {
    expect(close()).toContain('public.close_my_account()\nreturns jsonb')
    expect(close()).toContain('v_uid uuid := auth.uid();')
    expect(close()).toContain("if v_uid is null then\n    raise exception 'Authentication required.';")
  })

  it('grants: authenticated only; PUBLIC and anon revoked', () => {
    expect(code).toContain('revoke all on function public.close_my_account() from public, anon;')
    expect(code).toContain('grant execute on function public.close_my_account() to authenticated;')
  })

  it('retry returns the recorded state without re-running cleanup', () => {
    const c = close()
    expect(c.indexOf("'already_closed', true")).toBeLessThan(c.indexOf('insert into public.account_closures'))
  })

  it('staff and official-content creators cannot self-delete', () => {
    expect(close()).toContain('from public.staff_roles sr where sr.user_id = v_uid')
    expect(close()).toContain("d.author_id = v_uid and d.published_as <> 'member'")
  })

  it('ACTIVE -> CLOSED is written before any destructive statement', () => {
    const c = close()
    const first = Math.min(...['delete from public.', 'update public.'].map((s) => c.indexOf(s)).filter((i) => i > -1))
    expect(c.indexOf('insert into public.account_closures')).toBeLessThan(first)
  })

  it('Safety / legal / correspondence records are never deleted or modified', () => {
    for (const t of ['reports', 'safety_cases', 'safety_evaluations', 'safety_signals', 'safety_attempt_evidence', 'account_enforcement_state', 'admin_audit_log', 'legal_acceptances', 'letters', 'blocked_users', 'member_notices']) {
      expect(close()).not.toMatch(new RegExp(`(delete from|update)\\s+public\\.${t}\\b`))
    }
  })

  it('only member Dispatches: deletable ones must be unreported and without others’ replies; the rest unpublished', () => {
    const c = close()
    expect(c).toContain("and d.published_as = 'member'")
    expect(c).toContain("r.target_type = 'dispatch' and r.target_id = d.id")
    expect(c).toContain('dr.dispatch_id = d.id and dr.author_id <> v_uid')
    expect(c).toContain("set status = 'unpublished'\n  where author_id = v_uid and published_as = 'member'")
  })

  it('replies tombstoned like delete_reply; correspondences closed; emails stopped; DOB cleared', () => {
    const c = close()
    expect(c).toContain("set deleted_at = now(), body = ''")
    expect(c).toContain("set status = 'closed', closed_at = now()")
    expect(c).toContain('arrival_emails_enabled = false')
    expect(c).toContain("set status = 'skipped', skipped_reason = 'account_closed'")
    expect(c).toContain('set date_of_birth = null')
    expect(c).toContain('delete from public.profiles where id = v_uid;')
  })

  it('storage list recorded before the rows naming it are deleted; letter photos never listed', () => {
    const c = close()
    expect(c.indexOf("jsonb_build_object('profile-marks', v_marks, 'dispatch-photos', v_photos)")).toBeLessThan(c.indexOf('delete from public.dispatches'))
    expect(c).not.toContain('letter-photos')
    expect(c).toContain("(storage.foldername(dm.image_path))[1] = v_uid::text")
  })
})

describe('existing choke points learn "closed"', () => {
  it('current_account_status reports a closed caller as banned (all write gates refuse)', () => {
    expect(fn('public.current_account_status', '$$;')).toContain("when exists (select 1 from public.account_closures c where c.user_id = auth.uid()) then 'banned'")
  })
  it('public profiles, discovery and public content exclude closed members', () => {
    for (const name of ['tempa_private.account_is_banned', 'tempa_private.hidden_from_discovery', 'tempa_private.author_content_publicly_visible']) {
      expect(fn(name, '$$;')).toContain('public.account_closures')
    }
  })
})

describe('verifier', () => {
  it('read-only with a single overall_pass', () => {
    const v = verify.replace(/^\s*--.*$/gm, '').replace(/'[^']*'/g, "''").toLowerCase()
    expect(v).not.toMatch(/\b(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/)
    expect((v.match(/as overall_pass/g) ?? []).length).toBe(1)
    for (const c of ['close_fn_takes_no_target', 'close_fn_self_scoped', 'anon_cannot_close', 'public_cannot_close', 'staff_protection', 'safety_and_legal_records_untouched', 'discovery_excludes_closed', 'introductions_use_public_profiles', 'publish_dispatch_rejects_closed']) {
      expect(v).toContain(c)
    }
  })
})
