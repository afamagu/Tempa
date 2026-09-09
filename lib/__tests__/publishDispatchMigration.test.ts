// Checkpoint 1C, §8/§9-F — a live test found publish_dispatch's INSERT
// omitted status/published_at, violating dispatches_published_at_required
// (repaired by hand in the live database at the time). This repository
// cannot execute Postgres, so unlike the rest of the RPC surface (which
// gets a JS-level fake), the only way to guard against the fix being
// silently lost from a future migration is to inspect the actual
// tracked SQL source text directly.
//
// Read the migration file itself (not reconstructed from memory) and
// assert its publish_dispatch definition explicitly sets status and
// published_at — the exact regression the live test caught.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const MIGRATION_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-09-12-scoped-blocking-and-fixes.sql')

function extractFunctionBody(sql: string, functionName: string): string {
  const start = sql.indexOf(`create or replace function public.${functionName}(`)
  expect(start, `expected to find "${functionName}" defined in ${MIGRATION_PATH}`).toBeGreaterThan(-1)
  const end = sql.indexOf('$function$;', start)
  expect(end, `expected a closing $function$; for "${functionName}"`).toBeGreaterThan(start)
  return sql.slice(start, end)
}

describe('publish_dispatch migration source — dispatches_published_at_required regression', () => {
  const sql = readFileSync(MIGRATION_PATH, 'utf8')
  const body = extractFunctionBody(sql, 'publish_dispatch')

  it('inserts into public.dispatches with status and published_at as explicit columns', () => {
    expect(body).toMatch(
      /insert into public\.dispatches\s*\(\s*author_id,\s*title,\s*body,\s*status,\s*published_at\s*\)/
    )
  })

  it('sets status to the literal \'published\' and published_at to now(), never left to an implicit default', () => {
    expect(body).toMatch(/values\s*\(\s*auth\.uid\(\),\s*p_title,\s*p_body,\s*'published',\s*now\(\)\s*\)/)
  })

  it('preserves the account-enforcement check added by the safety migration', () => {
    expect(body).toContain("public.current_account_status() in ('restricted', 'suspended', 'banned')")
  })

  it('does not weaken or drop the dispatches_published_at_required constraint anywhere in this migration', () => {
    expect(sql).not.toMatch(/drop constraint\s+dispatches_published_at_required/i)
    expect(sql).not.toMatch(/alter\s+table\s+public\.dispatches[^;]*published_at[^;]*drop not null/i)
  })

  it('reissues revoke/grant execute for the modified function (CREATE OR REPLACE preserves ACLs, but this documents the grant is still present)', () => {
    expect(sql).toContain('revoke all on function public.publish_dispatch(text, text, text[], jsonb) from public;')
    expect(sql).toContain('grant execute on function public.publish_dispatch(text, text, text[], jsonb) to authenticated;')
  })
})
