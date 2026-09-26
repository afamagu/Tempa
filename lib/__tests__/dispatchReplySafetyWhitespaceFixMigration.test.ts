// Same convention as safetyCheckpoint4PublicSurfacesMigration.test.ts —
// CI cannot execute Postgres, so the SQL contract of the forward-only
// Reply whitespace fix is verified against the tracked migration text.
// Behaviour (reproduction of the live 22023 failure, then 11 regression
// cases) was proven on real PostgreSQL (PGlite) — see the PR description.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const DIR = path.join(__dirname, '..', '..', 'docs', 'sql')
const fix = readFileSync(path.join(DIR, '2026-10-17-dispatch-reply-safety-whitespace-fix.sql'), 'utf8').replace(/\r\n/g, '\n')
const verify = readFileSync(path.join(DIR, '2026-10-17-dispatch-reply-safety-whitespace-fix-verify.sql'), 'utf8')
const checkpoint4 = readFileSync(path.join(DIR, '2026-10-06-safety-checkpoint4-public-surfaces.sql'), 'utf8').replace(/\r\n/g, '\n')

function createReply(src: string): string {
  const start = src.indexOf('create or replace function public.create_reply(')
  expect(start).toBeGreaterThan(-1)
  const end = src.indexOf('$function$;', start)
  return src.slice(start, end + '$function$;'.length)
}
const stripComments = (s: string) => s.replace(/^\s*--.*$/gm, '')

describe('2026-10-17 Dispatch Reply Safety whitespace fix', () => {
  const fixed = createReply(fix)
  const previous = createReply(checkpoint4)

  it('is one forward-only transaction, marked not executed', () => {
    expect((fix.match(/^begin;/m) ?? []).length).toBe(1)
    expect((fix.match(/^commit;/m) ?? []).length).toBe(1)
    expect(fix).toContain('STATUS: NOT EXECUTED')
    expect(stripComments(fix)).not.toMatch(/drop function/i)
  })

  it('Safety consumes the exact screened p_body — never the trimmed v_body', () => {
    const code = stripComments(fixed)
    expect(code).toMatch(/null,\s*null,\s*null,\s*p_body,\s*p_warning_acknowledged,\s*v_new_id\s*\)/)
    expect(code).not.toMatch(/null,\s*v_body,\s*p_warning_acknowledged/)
    expect(code).toMatch(/consume_safety_evaluation\(\s*p_safety_evaluation_id,\s*auth\.uid\(\),\s*'dispatch_reply',\s*p_dispatch_id,\s*null,\s*p_parent_reply_id,/)
  })

  it('validation and storage still use the trimmed v_body', () => {
    const code = stripComments(fixed)
    expect(code).toContain("v_body := trim(both from coalesce(p_body, ''));")
    expect(code).toContain('if char_length(v_body) > 500 then')
    expect(code).toMatch(/v_new_id, p_dispatch_id, auth\.uid\(\), v_body, p_parent_reply_id, v_root_reply_id, v_reply_to_user_id/)
  })

  it('differs from the live 2026-10-06 create_reply ONLY in the consumed body (plus one comment)', () => {
    const norm = (s: string) => stripComments(s).split('\n').map((l) => l.trimEnd()).filter((l) => l.trim() !== '')
    const a = norm(previous)
    const b = norm(fixed)
    expect(b.length).toBe(a.length)
    const diffs = a.map((line, i) => [line, b[i]]).filter(([x, y]) => x !== y)
    expect(diffs).toEqual([['    v_body,', '    p_body,']])
  })

  it('keeps the signature and grants', () => {
    expect(fixed).toContain(
      'create or replace function public.create_reply(\n  p_dispatch_id uuid,\n  p_body text,\n  p_safety_evaluation_id uuid,\n  p_parent_reply_id uuid default null,\n  p_warning_acknowledged boolean default false\n)'
    )
    expect(fix).toContain('revoke all on function public.create_reply(uuid, text, uuid, uuid, boolean) from public;')
    expect(fix).toContain('grant execute on function public.create_reply(uuid, text, uuid, uuid, boolean) to authenticated;')
    expect(fix).not.toMatch(/grant execute on function public\.create_reply[^;]*to anon/)
  })

  it('does not edit the historical 2026-10-06 migration', () => {
    expect(stripComments(previous)).toMatch(/null,\s*v_body,\s*p_warning_acknowledged/)
  })

  it('verifier is one read-only SELECT with overall_pass and the fix-specific checks', () => {
    const code = stripComments(verify)
    expect(code).not.toMatch(/\b(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b\s/i)
    expect((code.match(/;/g) ?? []).length).toBe(1)
    for (const col of [
      'single_unchanged_signature',
      'consumes_raw_p_body',
      'trimmed_body_no_longer_consumed',
      'stores_trimmed_v_body',
      'account_status_gate',
      'nested_parent_validated',
      'consume_binding_intact',
      'overall_pass',
    ]) {
      expect(verify).toContain(col)
    }
  })
})
