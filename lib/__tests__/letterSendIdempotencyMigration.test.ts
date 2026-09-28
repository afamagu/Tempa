// write_letter_once (2026-09-28). CI cannot run Postgres; the SQL
// contract is checked against the tracked text, like the other
// migration tests.

import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const DIR = path.join(__dirname, '..', '..', 'docs', 'sql')
const read = (f: string) => readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n')
const strip = (s: string) => s.replace(/--.*$/gm, '')
const migration = read('2026-10-05-write-letter-send-idempotency.sql')
const verify = read('2026-10-05-write-letter-send-idempotency-verify.sql')
const code = strip(migration)
const fn = code.slice(code.indexOf('create or replace function public.write_letter_once('), code.indexOf('$function$;', code.indexOf('$function$')) )

describe('2026-09-28 letter send idempotency', () => {
  it('one forward-only transaction, not yet applied, and write_letter itself untouched', () => {
    expect((migration.match(/^begin;/gm) ?? []).length).toBe(1)
    expect((migration.match(/^commit;/gm) ?? []).length).toBe(1)
    expect(migration).toContain('STATUS: NOT YET APPLIED')
    expect(code).not.toMatch(/create or replace function public\.write_letter\(/)
    expect(code).not.toMatch(/\bdrop\b/i)
  })

  it('sorts after the last migration that defines write_letter (clean replay in filename order)', () => {
    const files = readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort()
    const definers = files.filter((f) => /create or replace function public\.write_letter\(/.test(read(f)))
    const self = files.indexOf('2026-10-05-write-letter-send-idempotency.sql')
    expect(self).toBeGreaterThan(-1)
    expect(definers.length).toBeGreaterThan(0)
    for (const f of definers) expect(files.indexOf(f)).toBeLessThan(self)
  })

  it('submissions table: one letter per (sender, submission id), RLS on, no member privilege', () => {
    expect(code).toContain('primary key (sender_id, client_submission_id)')
    expect(code).toContain('alter table public.letter_submissions enable row level security;')
    expect(code).toContain('revoke all on public.letter_submissions from public, anon, authenticated;')
    expect(code).not.toMatch(/grant [^;]* on public\.letter_submissions/)
  })

  it('locks the correspondence, returns an existing submission before doing anything, else delegates to write_letter', () => {
    const lock = fn.indexOf('from public.correspondences where id = p_correspondence_id for update')
    const lookup = fn.indexOf('from public.letter_submissions s')
    const early = fn.indexOf('return v_result;')
    const delegate = fn.indexOf('v_result := public.write_letter(')
    const record = fn.indexOf('insert into public.letter_submissions')
    expect(lock).toBeGreaterThan(-1)
    expect(lock).toBeLessThan(lookup)
    expect(lookup).toBeLessThan(early)
    expect(early).toBeLessThan(delegate)
    expect(delegate).toBeLessThan(record)
    expect(fn).toContain('where s.sender_id = auth.uid() and s.client_submission_id = p_client_submission_id')
    expect(fn).toContain('security definer')
    expect(fn).toContain("set search_path to 'pg_catalog'")
  })

  it('authenticated-only execute', () => {
    expect(code).toContain('revoke all on function public.write_letter_once(uuid, uuid, text, uuid, uuid, jsonb, jsonb, boolean) from public, anon, authenticated;')
    expect(code).toContain('grant execute on function public.write_letter_once(uuid, uuid, text, uuid, uuid, jsonb, jsonb, boolean) to authenticated;')
  })

  it('verifier is read-only and ends in overall_pass', () => {
    expect(strip(verify)).not.toMatch(/\b(insert|update|delete|grant|revoke|alter|create|drop)\b\s/i)
    expect(verify).toContain('overall_pass')
    expect(verify).toContain('one_letter_per_submission')
  })
})
