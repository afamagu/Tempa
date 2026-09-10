// Independent-review corrections (post-Phase-1-audit) — this repository
// cannot execute Postgres, so the two fixes requested (Photo Moments
// spanning Dispatches, and the daily-series query shape) are verified
// directly against the tracked SQL source text, the same convention as
// publishDispatchMigration.test.ts and blockUserOverloadMigration.test.ts.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const MIGRATION_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-09-10-admin-overview-metrics.sql')
const sql = readFileSync(MIGRATION_PATH, 'utf8')

function extractFunctionBody(functionName: string): string {
  const start = sql.indexOf(`create or replace function public.${functionName}(`)
  expect(start, `expected to find "${functionName}" defined in ${MIGRATION_PATH}`).toBeGreaterThan(-1)
  const end = sql.indexOf('$function$;', start)
  expect(end, `expected a closing $function$; for "${functionName}"`).toBeGreaterThan(start)
  return sql.slice(start, end)
}

describe('admin_overview_counts migration source — Photo Moments span all of TEMPA', () => {
  const body = extractFunctionBody('admin_overview_counts')

  it('sums letter Photo Moments (moments.type=\'photo\') and Dispatch Photo Moments (dispatch_moments)', () => {
    expect(body).toContain("select count(*) from public.moments where type = 'photo'")
    expect(body).toContain('select count(*) from public.dispatch_moments')
  })

  it('never filters dispatch_moments by a postcard-shaped type — that table has no type column at all', () => {
    const dispatchMomentsUse = body.slice(body.indexOf('public.dispatch_moments'))
    expect(dispatchMomentsUse.slice(0, 60)).not.toContain("type = 'postcard'")
  })

  it('still excludes historical Postcard Moments from the letter side of the sum', () => {
    expect(body).not.toMatch(/moments where type = 'postcard'\)\s*\n\s*\+/)
  })
})

describe('admin_overview_daily_series migration source — grouped-once aggregation', () => {
  const body = extractFunctionBody('admin_overview_daily_series')

  it('groups each source by day exactly once via its own CTE, never a per-day correlated subquery', () => {
    expect(body).toContain('members_by_day as (')
    expect(body).toContain('letters_by_day as (')
    expect(body).toContain('correspondences_by_day as (')
    expect(body).toContain('reports_by_day as (')
    expect(body).toMatch(/members_by_day[\s\S]*group by 1/)
    expect(body).toMatch(/letters_by_day[\s\S]*group by 1/)
  })

  it('LEFT JOINs the four grouped sources onto the generated calendar, coalescing quiet days to 0', () => {
    expect(body).toContain('left join members_by_day mbd on mbd.day = d.day')
    expect(body).toContain('left join letters_by_day lbd on lbd.day = d.day')
    expect(body).toContain('left join correspondences_by_day cbd on cbd.day = d.day')
    expect(body).toContain('left join reports_by_day rbd on rbd.day = d.day')
    expect(body).toContain('coalesce(mbd.n, 0)')
    expect(body).toContain('coalesce(lbd.n, 0)')
    expect(body).toContain('coalesce(cbd.n, 0)')
    expect(body).toContain('coalesce(rbd.n, 0)')
  })

  it('pre-filters each grouped source to the requested window (v_start), never scanning full table history', () => {
    expect(body).toContain('v_start date')
    expect(body).toMatch(/members_by_day as \([\s\S]*?where \(u\.created_at at time zone 'utc'\)::date >= v_start/)
    expect(body).toMatch(/letters_by_day as \([\s\S]*?where \(l\.created_at at time zone 'utc'\)::date >= v_start/)
  })

  it('still requires a genuine public.profiles row for member counting — never raw auth.users', () => {
    expect(body).toContain('from public.profiles p')
    expect(body).toContain('join auth.users u on u.id = p.id')
  })

  it('still clamps p_days to [1, 90]', () => {
    expect(body).toContain('v_days := least(greatest(coalesce(p_days, 30), 1), 90);')
  })
})

describe('admin overview migration — unchanged invariants (signatures, security, no RLS/Realtime)', () => {
  it('both RPC signatures are unchanged', () => {
    expect(sql).toContain('create or replace function public.admin_overview_counts()')
    expect(sql).toContain('create or replace function public.admin_overview_daily_series(p_days integer default 30)')
  })

  it('both return only the same aggregate columns as before — no new/renamed/removed columns', () => {
    const countsBody = extractFunctionBody('admin_overview_counts')
    expect(countsBody).toContain('total_members bigint,')
    expect(countsBody).toContain('living_postcards_total bigint')

    const seriesBody = extractFunctionBody('admin_overview_daily_series')
    expect(seriesBody).toContain('day date,')
    expect(seriesBody).toContain('new_members bigint,')
    expect(seriesBody).toContain('letters_sent bigint,')
    expect(seriesBody).toContain('new_correspondences bigint,')
    expect(seriesBody).toContain('reports bigint')
  })

  it('is_staff() is still checked as the first statement in both functions, SECURITY DEFINER, fixed search_path', () => {
    for (const fn of ['admin_overview_counts', 'admin_overview_daily_series']) {
      const start = sql.indexOf(`create or replace function public.${fn}(`)
      const bodyStart = sql.indexOf('$function$', start)
      const declaration = sql.slice(start, bodyStart)
      expect(declaration).toContain('security definer')
      expect(declaration).toContain("set search_path to 'pg_catalog'")

      const body = extractFunctionBody(fn)
      expect(body).toContain('if not public.is_staff() then')
      expect(body).toContain('raise exception \'Not authorized.\';')
    }
  })

  it('grants/revokes are present for both functions, unchanged in shape', () => {
    expect(sql).toContain('revoke all on function public.admin_overview_counts() from public;')
    expect(sql).toContain('grant execute on function public.admin_overview_counts() to authenticated;')
    expect(sql).toContain('revoke all on function public.admin_overview_daily_series(integer) from public;')
    expect(sql).toContain('grant execute on function public.admin_overview_daily_series(integer) to authenticated;')
  })

  it('never touches RLS, indexes, or Realtime', () => {
    expect(sql).not.toMatch(/alter\s+table[^;]*\benable\s+row\s+level\s+security/i)
    expect(sql).not.toContain('create policy')
    expect(sql).not.toContain('create index')
    expect(sql).not.toContain('supabase_realtime')
  })

  it('the migration remains wrapped in exactly one begin/commit, still not marked as executed', () => {
    expect(sql.trimStart().startsWith('-- =')).toBe(true)
    expect(sql).toContain('NOT EXECUTED')
    expect((sql.match(/^begin;/m) ?? []).length).toBe(1)
    expect((sql.match(/^commit;/m) ?? []).length).toBe(1)
  })
})
