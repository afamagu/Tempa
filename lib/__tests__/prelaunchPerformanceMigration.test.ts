// Same convention as the other migration tests — CI cannot execute
// Postgres, so the tracked SQL source is inspected directly. (The
// migration + verifier were also executed against real PostgreSQL —
// PGlite, outside the repo — with a synthetic population; see the PR.)

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'sql')
const read = (name: string) => readFileSync(path.join(SQL_DIR, name), 'utf8').replace(/\r\n/g, '\n')

const migration = read('2026-10-13-prelaunch-performance.sql')
const verify = read('2026-10-13-prelaunch-performance-verify.sql')
const code = migration.replace(/^\s*--.*$/gm, '')

function fn(name: string): string {
  const start = code.indexOf(`create or replace function public.${name}(`)
  expect(start).toBeGreaterThan(-1)
  return code.slice(start, code.indexOf('$function$;', start))
}

describe('pre-launch performance migration — forward-only', () => {
  it('one transaction, NOT EXECUTED, no DROP / DELETE / UPDATE / policy change', () => {
    expect((migration.match(/^begin;/gm) ?? []).length).toBe(1)
    expect((migration.match(/^commit;/gm) ?? []).length).toBe(1)
    expect(migration).toContain('STATUS: NOT EXECUTED')
    const lower = code.toLowerCase()
    expect(lower).not.toMatch(/\bdrop\b|\bdelete\s+from\b|\bupdate\s+public\.|\bcreate policy\b|\balter policy\b|\bsecurity definer\b/)
  })
})

describe('current_account_entry_state — self-scoped proxy read', () => {
  const entry = () => fn('current_account_entry_state')

  it('takes no user id — only the two legal version strings', () => {
    expect(entry()).toContain('p_terms_version text,\n  p_guidelines_version text\n)')
    expect(entry()).not.toMatch(/p_user|user_id uuid/)
  })

  it('is SECURITY INVOKER with a pinned search_path', () => {
    expect(entry()).toContain('security invoker')
    expect(entry()).toContain("set search_path to 'pg_catalog'")
  })

  it('every table read is keyed to auth.uid(); ban status comes from current_account_status()', () => {
    const body = entry()
    expect(body).toContain('public.current_account_status() as account_status')
    expect(body.match(/= auth\.uid\(\)/g)?.length).toBe(5)
    expect(body).toContain('where auth.uid() is not null')
  })

  it('granted to authenticated only', () => {
    expect(code).toContain('revoke all on function public.current_account_entry_state(text, text) from public, anon;')
    expect(code).toContain('grant execute on function public.current_account_entry_state(text, text) to authenticated;')
  })
})

describe('discover_people — bounded, invoker-rights discovery', () => {
  const discover = () => fn('discover_people')

  it('SECURITY INVOKER over the existing RLS / block-aware surfaces', () => {
    const body = discover()
    expect(body).toContain('security invoker')
    expect(body).toContain('from public.public_profiles p')
    expect(body).toContain('from public.question_answers qa')
    expect(body).toContain('from public.correspondences c')
    expect(body).toContain('from public.letters_for_participant l')
  })

  it('never returns more than 24 rows; ordering is deterministic per viewer, no random()', () => {
    const body = discover()
    expect(body).toContain('limit least(greatest(coalesce(p_limit, 6), 1), 24)')
    expect(body).toContain('offset greatest(coalesce(p_offset, 0), 0)')
    expect(body).not.toMatch(/random\(\)/)
  })

  it('excludes self, active partners and already-contacted representative answers', () => {
    const body = discover()
    expect(body).toContain('qa.user_id <> v.id')
    expect(body).toContain('not exists (select 1 from partners x where x.user_id = r.user_id)')
    expect(body).toContain('not exists (select 1 from contacted c where c.answer_id = r.id)')
  })

  it('applies country / gender (incl. self-described) / age filters in SQL', () => {
    const body = discover()
    expect(body).toContain("(nullif(p_country, '') is null or e.country = p_country)")
    expect(body).toContain("(e.gender = 'Self-describe' and e.gender_custom = p_gender)")
    expect(body).toContain("(nullif(p_age_range, '') is null or e.age_range = p_age_range)")
  })

  it('granted to authenticated only', () => {
    expect(code).toContain('revoke all on function public.discover_people(text, text, text, integer, integer) from public, anon;')
    expect(code).toContain('grant execute on function public.discover_people(text, text, text, integer, integer) to authenticated;')
  })

  it('adds the participant_high partial index', () => {
    expect(code).toMatch(/create index if not exists correspondences_active_participant_high_idx\s+on public\.correspondences \(participant_high\)\s+where status = 'active';/)
  })
})

describe('verifier — read-only', () => {
  it('only reads the catalog and reports overall_pass', () => {
    const vcode = verify.replace(/^\s*--.*$/gm, '').toLowerCase()
    expect(vcode).not.toMatch(/\b(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/)
    expect(vcode).toContain('as overall_pass')
    for (const check of ['entry_fn_self_scoped', 'discover_fn_security_invoker', 'answers_policy_enforces_safety', 'no_public_execute', 'participant_high_index_present']) {
      expect(vcode).toContain(check)
    }
  })
})
