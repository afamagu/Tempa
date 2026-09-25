// Same convention as the other migration tests — CI cannot execute
// Postgres, so the tracked SQL source is inspected directly. The
// migration + verifier were also executed on real PostgreSQL (PGlite,
// outside the repo) against the acceptance cases and a 5,000-member
// synthetic population; see the PR.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'sql')
const read = (name: string) => readFileSync(path.join(SQL_DIR, name), 'utf8').replace(/\r\n/g, '\n')
const migration = read('2026-10-14-member-introductions.sql')
const verify = read('2026-10-14-member-introductions-verify.sql')
const code = migration.replace(/^\s*--.*$/gm, '')

function fn(qualified: string): string {
  const start = code.indexOf(`create or replace function ${qualified}(`)
  expect(start, qualified).toBeGreaterThan(-1)
  return code.slice(start, code.indexOf('$function$;', start))
}

describe('member introductions migration — forward-only', () => {
  it('one transaction, NOT EXECUTED, no DROP / DELETE / edits to existing policies', () => {
    expect((migration.match(/^begin;/gm) ?? []).length).toBe(1)
    expect((migration.match(/^commit;/gm) ?? []).length).toBe(1)
    expect(migration).toContain('STATUS: NOT EXECUTED')
    expect(code.toLowerCase()).not.toMatch(/\bdrop\b|\bdelete\s+from\b|\balter policy\b/)
    // only its own two tables get policies
    for (const m of code.matchAll(/create policy \w+\s+on public\.(\w+)/g)) {
      expect(['member_introduction_state', 'member_introduction_history']).toContain(m[1])
    }
  })

  it('history is keyed (viewer_id, candidate_id), lazily written, with bounded consume reasons', () => {
    expect(code).toContain('primary key (viewer_id, candidate_id)')
    expect(code).toContain("check (consumed_reason in ('advanced', 'write', 'profile'))")
    expect(code).toContain('create index if not exists member_introduction_history_candidate_idx')
    // never pre-created for the population
    expect(code).not.toMatch(/insert into public\.member_introduction_history[\s\S]{0,200}select/i)
  })

  it('RLS: own-viewer policies only, no DELETE grant, anon has nothing', () => {
    expect(code).toContain('alter table public.member_introduction_state enable row level security;')
    expect(code).toContain('alter table public.member_introduction_history enable row level security;')
    const policies = code.match(/create policy[\s\S]*?;/g) ?? []
    expect(policies).toHaveLength(5)
    for (const p of policies) {
      expect(p).toContain('to authenticated')
      expect(p).toMatch(/viewer_id = auth\.uid\(\)/)
    }
    expect(code).toContain('grant select, insert on public.member_introduction_state to authenticated;')
    expect(code).toContain('grant select, insert, update on public.member_introduction_history to authenticated;')
    expect(code).not.toMatch(/grant [^;]*\bto anon\b/)
  })
})

describe('get_member_introductions', () => {
  const body = () => fn('public.get_member_introductions')

  it('no viewer argument; hard cap of 7 at the database boundary', () => {
    expect(body()).toContain('public.get_member_introductions(p_limit integer default 7)')
    expect(body()).toContain('limit least(greatest(coalesce(p_limit, 7), 1), 7)')
    expect(body()).toContain("raise exception 'Authentication required.'")
  })

  it('SECURITY INVOKER over the current Safety/discovery surfaces', () => {
    const b = body()
    expect(b).toContain('security invoker')
    expect(b).toContain("set search_path to 'pg_catalog'")
    for (const surface of ['public.public_profiles', 'public.question_answers', 'public.correspondences', 'public.letters_for_participant']) {
      expect(b).toContain(surface)
    }
    expect(b).toContain("qa.moderation_status = 'visible'")
    expect(b).not.toContain('is_blocked_pair')
  })

  it('reuses People eligibility: self, partners, contacted and Flagship→current→latest', () => {
    const b = body()
    expect(b).toContain('qa.user_id <> v.id')
    expect(b).toContain('not exists (select 1 from partners x where x.user_id = p.id)')
    expect(b).toContain('not exists (select 1 from contacted c where c.answer_id = r.id)')
    expect(b).toContain('(qa.question_id = (select f.id from flagship f)) desc nulls last,\n      qa.is_current desc nulls last,\n      qa.updated_at desc nulls last')
  })

  it('priority: tier (new 0 / established 1 / presented 2) → shared languages → shared intents → per-viewer hash', () => {
    const b = body()
    expect(b).toContain('when h.user_id is not null then 2\n        when nc.user_id is not null then 0\n        else 1')
    expect(b).toContain('(h.user_id is null or h.consumed_at is null)')
    expect(b).toContain(
      'c.tier,\n      c.last_presented_at asc nulls first,\n      cardinality(c.shared_languages) desc,\n      cardinality(c.shared_intents) desc,\n      c.sort_key,\n      c.id'
    )
    expect(b).toContain("hashtext('intro:' || v.id::text || ':' || p.id::text)")
  })

  it('matches only on public languages / intent — never Reading Interests, age or gender', () => {
    const b = body().toLowerCase()
    expect(b).not.toContain('interest')
    const ranking = b.slice(b.indexOf('picked as'), b.indexOf('limit least'))
    expect(ranking).not.toMatch(/age_range|gender|country/)
  })

  it('materializes every working set (no per-candidate re-scan of public_profiles)', () => {
    const b = body()
    for (const cte of ['viewer', 'partners', 'contacted', 'history', 'newcomers', 'representative', 'visible_profiles', 'candidates']) {
      expect(b).toContain(`${cte} as materialized (`)
    }
    expect(b).toContain('join visible_profiles p on p.id = r.user_id')
  })
})

describe('newcomer helper — the one SECURITY DEFINER', () => {
  it('argument-free, caller-scoped, ids only', () => {
    const b = fn('tempa_private.member_introduction_newcomer_ids')
    expect(b).toContain('tempa_private.member_introduction_newcomer_ids()\nreturns table (id uuid)')
    expect(b).toContain('security definer')
    expect(b).toContain("set search_path to 'pg_catalog'")
    expect(b).toContain('on s.viewer_id = auth.uid()')
    expect(b).toContain('u.created_at > s.baseline_at')
  })
})

describe('presented / consumed mutations', () => {
  it('act only for auth.uid(); no viewer argument; invoker rights', () => {
    for (const [name, sig] of [
      ['public.mark_member_introduction_presented', 'p_candidate_id uuid)'],
      ['public.consume_member_introduction', 'p_candidate_id uuid, p_reason text)'],
    ]) {
      const b = fn(name)
      expect(b).toContain(`${name}(${sig}`)
      expect(b).toContain('security invoker')
      expect(b).toContain('values (auth.uid(), p_candidate_id')
      expect(b).toContain('where h.consumed_at is null')
    }
  })

  it('grants: authenticated only, PUBLIC and anon revoked', () => {
    for (const sig of [
      'public.get_member_introductions(integer)',
      'public.mark_member_introduction_presented(uuid)',
      'public.consume_member_introduction(uuid, text)',
      'tempa_private.member_introduction_newcomer_ids()',
    ]) {
      expect(code).toContain(`revoke all on function ${sig} from public, anon;`)
      expect(code).toContain(`grant execute on function ${sig} to authenticated;`)
    }
  })
})

describe('verifier — read-only, single overall_pass', () => {
  it('only reads the catalog', () => {
    // string literals ('DELETE', 'UPDATE' privilege names) are data, not statements
    const v = verify.replace(/^\s*--.*$/gm, '').replace(/'[^']*'/g, "''").toLowerCase()
    expect(v).not.toMatch(/\b(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/)
    expect((v.match(/as overall_pass/g) ?? []).length).toBe(1)
    for (const c of ['limit_clamped_to_7', 'no_viewer_argument', 'mutations_self_scoped', 'public_execute_revoked', 'anon_cannot_execute', 'no_reading_interests', 'answers_policy_enforces_safety', 'history_candidate_idx']) {
      expect(v).toContain(c)
    }
  })
})
