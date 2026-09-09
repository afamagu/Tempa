// Checkpoint 1C — independent PostgreSQL-level audit correction. An
// earlier draft of this migration tried to make block_user scope-aware
// by adding `p_scope text default 'full'` to the existing
// block_user(uuid) via CREATE OR REPLACE. That's invalid: CREATE OR
// REPLACE FUNCTION can only replace a function with an IDENTICAL
// argument list — changing it creates a SEPARATE new overload, and a
// DEFAULT on the new parameter would have made a one-argument call
// ambiguous between the two. The corrected design is two distinct,
// unambiguous overloads (block_user(uuid) and block_user(uuid, text),
// the latter with NO default). This repository cannot execute Postgres,
// so — same approach as publishDispatchMigration.test.ts — the tracked
// SQL source text itself is inspected directly to guard against this
// exact class of regression ever being silently reintroduced.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const MIGRATION_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-09-12-scoped-blocking-and-fixes.sql')

const sql = readFileSync(MIGRATION_PATH, 'utf8')

describe('block_user migration source — two-overload regression (independent audit correction)', () => {
  it('defines the two-argument implementation with NO default on p_scope', () => {
    expect(sql).toContain('create or replace function public.block_user(p_blocked_id uuid, p_scope text)')
    // Guard specifically against the rejected single-function design
    // reappearing: a defaulted p_scope on this exact signature.
    expect(sql).not.toContain("create or replace function public.block_user(p_blocked_id uuid, p_scope text default 'full')")
  })

  it('defines the one-argument legacy wrapper as a SEPARATE function, not folded into the two-argument version', () => {
    // Matched precisely (not as a substring of the two-argument
    // definition) via the exact closing paren for a single-parameter
    // signature.
    expect(sql).toContain('create or replace function public.block_user(p_blocked_id uuid)\nreturns void')
  })

  it('the one-argument wrapper delegates to the two-argument version with an explicit \'full\' literal', () => {
    const wrapperStart = sql.indexOf('create or replace function public.block_user(p_blocked_id uuid)\nreturns void')
    expect(wrapperStart).toBeGreaterThan(-1)
    const wrapperEnd = sql.indexOf('$function$;', wrapperStart)
    const wrapperBody = sql.slice(wrapperStart, wrapperEnd)
    expect(wrapperBody).toContain("perform public.block_user(p_blocked_id, 'full');")
  })

  it('the two-argument version is created before the one-argument wrapper, so the wrapper\'s call always resolves', () => {
    const twoArgIndex = sql.indexOf('create or replace function public.block_user(p_blocked_id uuid, p_scope text)')
    const oneArgIndex = sql.indexOf('create or replace function public.block_user(p_blocked_id uuid)\nreturns void')
    expect(twoArgIndex).toBeGreaterThan(-1)
    expect(oneArgIndex).toBeGreaterThan(-1)
    expect(twoArgIndex).toBeLessThan(oneArgIndex)
  })

  it('explicitly revokes from public/anon/authenticated and grants execute to authenticated for BOTH signatures', () => {
    expect(sql).toContain('revoke all on function public.block_user(uuid) from public, anon, authenticated;')
    expect(sql).toContain('revoke all on function public.block_user(uuid, text) from public, anon, authenticated;')
    expect(sql).toContain('grant execute on function public.block_user(uuid) to authenticated;')
    expect(sql).toContain('grant execute on function public.block_user(uuid, text) to authenticated;')
  })

  it('the two-argument implementation explicitly rejects a null scope, not just an unrecognized one', () => {
    const start = sql.indexOf('create or replace function public.block_user(p_blocked_id uuid, p_scope text)')
    const end = sql.indexOf('$function$;', start)
    const body = sql.slice(start, end)
    expect(body).toMatch(/if p_scope is null then\s*\n\s*raise exception 'Unknown block scope\.';/)
  })
})

describe('tempa_private.is_correspondence_blocked_pair migration source — explicit revoke (independent audit correction)', () => {
  it('explicitly revokes the default PUBLIC execute grant Postgres assigns on function creation', () => {
    expect(sql).toContain(
      'revoke all on function tempa_private.is_correspondence_blocked_pair(uuid, uuid)\n  from public, anon, authenticated;'
    )
  })

  it('never grants execute on this helper to anon or authenticated', () => {
    expect(sql).not.toMatch(/grant execute on function tempa_private\.is_correspondence_blocked_pair[^;]*to (anon|authenticated)/)
  })
})

describe('tempa_private.is_blocked_pair migration source — live-verified grant preserved (independent audit correction)', () => {
  it('never issues a revoke against is_blocked_pair that would disturb its live authenticated=true state', () => {
    expect(sql).not.toMatch(/revoke all on function tempa_private\.is_blocked_pair/)
  })

  it('documents the correct live privilege state (authenticated=true) rather than asserting "no client grant"', () => {
    const section = sql.slice(
      sql.indexOf('2. TEMPA_PRIVATE.IS_BLOCKED_PAIR'),
      sql.indexOf('3. TEMPA_PRIVATE.IS_CORRESPONDENCE_BLOCKED_PAIR')
    )
    // The corrected comment explicitly says the OLD claim was wrong
    // ("this is NOT 'no client grant'") — the string itself is expected
    // to appear as part of that correction. What must NOT appear is a
    // bare, uncorrected assertion that the function has no client
    // grant at all.
    expect(section).not.toMatch(/security properties \([^)]*no client grant\)/i)
    expect(section).toContain('EXECUTE = true')
    expect(section).toContain('authenticated')
  })
})
