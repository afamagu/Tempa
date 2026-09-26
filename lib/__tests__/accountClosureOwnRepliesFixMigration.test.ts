// Forward-only fix for the production account-deletion failure (23503 on
// dispatch_replies_dispatch_id_fkey when a member had replied under their
// own Dispatch). CI cannot run Postgres, so the SQL contract is checked
// against the tracked text; behaviour was proven on real PostgreSQL
// (PGlite) with the production foreign key — see the PR description.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const DIR = path.join(__dirname, '..', '..', 'docs', 'sql')
const read = (f: string) => readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n')
const fix = read('2026-10-18-account-closure-own-replies-fix.sql')
const verify = read('2026-10-18-account-closure-own-replies-fix-verify.sql')
const lifecycle = read('2026-10-16-account-lifecycle.sql')
const repliesMigration = read('2026-09-23-dispatch-replies.sql')

function closeFn(src: string): string {
  const start = src.indexOf('create or replace function public.close_my_account(')
  expect(start).toBeGreaterThan(-1)
  const end = src.indexOf('$function$;', src.indexOf('$function$', start) + 10)
  return src.slice(start, end + '$function$;'.length)
}
const code = (s: string) => s.split('\n').map((l) => l.replace(/--.*$/, '').trimEnd()).filter((l) => l.trim() !== '')

describe('2026-10-18 account closure own-replies fix', () => {
  const fixed = closeFn(fix)
  const applied = closeFn(lifecycle)

  it('reproduces the production premise: dispatch_replies.dispatch_id has no ON DELETE action', () => {
    expect(repliesMigration).toMatch(/dispatch_id uuid not null\n\s+references public\.dispatches\(id\),/)
  })

  it('is one forward-only transaction, recorded as applied, and does not edit 2026-10-16', () => {
    expect((fix.match(/^begin;/m) ?? []).length).toBe(1)
    expect((fix.match(/^commit;/m) ?? []).length).toBe(1)
    expect(fix).toContain('STATUS: APPLIED TO PRODUCTION 2026-09-26')
    expect(code(fix).join('\n')).not.toMatch(/drop function|alter table|drop table/i)
    expect(applied).not.toContain('delete from public.dispatch_replies')
  })

  it('deletes only the member’s own replies under deletable Dispatches, before deleting those Dispatches', () => {
    const body = code(fixed).join('\n')
    const replyDelete = body.indexOf('delete from public.dispatch_replies\n  where dispatch_id = any (v_deletable) and author_id = v_uid;')
    const dispatchDelete = body.indexOf('delete from public.dispatches where id = any (v_deletable);')
    expect(replyDelete).toBeGreaterThan(-1)
    expect(replyDelete).toBeLessThan(dispatchDelete)
    expect(body.indexOf('insert into public.account_closures')).toBeLessThan(replyDelete)
  })

  it('a Dispatch with a reported reply is never deletable (evidence retained)', () => {
    expect(code(fixed).join('\n')).toContain("where r.target_type = 'reply' and dr.dispatch_id = d.id")
  })

  it('otherwise identical to the applied 2026-10-16 close_my_account', () => {
    const a = code(applied)
    const b = code(fixed)
    const added = b.filter((l) => !a.includes(l))
    const removed = a.filter((l) => !b.includes(l))
    expect(removed).toEqual([])
    // 7 new code lines: `)`, `and not exists (` and `select 1 from
    // public.reports r` (text already present elsewhere) plus the four below.
    expect(b.length - a.length).toBe(7)
    expect(added).toEqual([
      '      join public.dispatch_replies dr on dr.id = r.target_id',
      "      where r.target_type = 'reply' and dr.dispatch_id = d.id",
      '  delete from public.dispatch_replies',
      '  where dispatch_id = any (v_deletable) and author_id = v_uid;',
    ])
  })

  it('keeps the signature and grants', () => {
    expect(fixed).toContain('create or replace function public.close_my_account(\n  p_reason_code text default null,\n  p_reason_detail text default null\n)')
    expect(fix).toContain('revoke all on function public.close_my_account(text, text) from public, anon;')
    expect(fix).toContain('grant execute on function public.close_my_account(text, text) to authenticated;')
  })

  it('verifier is one read-only SELECT with overall_pass and the fix-specific checks', () => {
    // Quoted pattern strings (e.g. 'delete from public…' inside strpos) are data, not statements.
    const v = code(verify).join('\n').replace(/'(?:[^']|'')*'/g, "''")
    expect(v).not.toMatch(/\b(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b\s+(into|table|function|from|on|public)/i)
    expect((v.match(/;/g) ?? []).length).toBe(1)
    for (const col of [
      'own_replies_deleted_scoped_to_self',
      'own_replies_deleted_before_dispatches',
      'reported_reply_keeps_dispatch',
      'others_replies_keep_dispatch',
      'closure_recorded_first',
      'overall_pass',
    ]) {
      expect(verify).toContain(col)
    }
  })
})
