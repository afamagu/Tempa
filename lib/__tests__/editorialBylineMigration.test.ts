// Editorial byline ("Tempa House Columnist") — pinned against the tracked
// migration text. CI cannot run Postgres; behaviour (members refused on
// their own and other accounts, directly and inside a SECURITY DEFINER
// RPC; forged inserts neutralised; service role and SQL editor allowed;
// preflight aborting with nothing changed) was proven on PGlite with the
// verifier itself, with and without the 2026-09-29 direct-UPDATE revoke
// in place — see the PR.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const DIR = path.join(__dirname, '..', '..', 'docs', 'sql')
const read = (f: string) => readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n')
const stripComments = (s: string) => s.replace(/--.*$/gm, '')
const sql = stripComments(read('2026-09-30-editorial-byline.sql'))
const verify = read('2026-09-30-editorial-byline-verify.sql')
const lookup = stripComments(read('2026-09-30-editorial-byline-lookup.sql'))
const fn = (name: string) => {
  const start = sql.indexOf(`create or replace function ${name}(`)
  expect(start, name).toBeGreaterThan(-1)
  return sql.slice(start, sql.indexOf('$function$;', start))
}

describe('2026-09-30 editorial byline', () => {
  it('is transactional and self-contained: only the 2026-08-30 pseudonym key is assumed, and checked first', () => {
    expect(sql.trim().startsWith('begin;')).toBe(true)
    expect(sql.trim().endsWith('commit;')).toBe(true)
    expect(sql).toContain("to_regprocedure('public.canonicalize_pseudonym(text)') is null")
    expect(sql).toMatch(/column_name = 'pseudonym_key'/)
    // Nothing from later, possibly-unapplied migrations.
    for (const dep of ['writing_style', 'dispatch_is_web_public', 'public_profiles', 'is_staff', 'account_is_banned', 'onboarding_stage', 'published_as']) {
      expect(sql, dep).not.toContain(dep)
    }
    expect(lookup).not.toContain('onboarding_stage')
  })

  it('adds exactly the two columns, with both-or-neither shape', () => {
    expect(sql).toContain('add column if not exists is_editorial boolean not null default false')
    expect(sql).toContain('add column if not exists editorial_title text;')
    expect(sql).toMatch(/\(is_editorial and editorial_title is not null[\s\S]*char_length\(editorial_title\) between 1 and 60\)\s*or \(not is_editorial and editorial_title is null\)/)
  })

  it('a new profile can never start editorial, whatever the insert supplied', () => {
    const f = fn('tempa_private.force_initial_profile_editorial')
    expect(f).toContain('new.is_editorial := false;')
    expect(f).toContain('new.editorial_title := null;')
    expect(sql).toMatch(/create trigger profiles_force_initial_editorial\s+before insert on public\.profiles/)
  })

  it('any change to either column is refused unless service role or a direct database session — by JWT role, so it holds inside definer RPCs', () => {
    const f = fn('tempa_private.guard_profile_editorial')
    expect(f).toContain('security invoker')
    expect(f).toContain('new.is_editorial is not distinct from old.is_editorial')
    expect(f).toContain('new.editorial_title is not distinct from old.editorial_title')
    expect(f).toContain("current_setting('request.jwt.claims', true)")
    expect(f).toContain("v_jwt_role not in ('', 'service_role')")
    expect(f).toContain("current_user::text in ('anon', 'authenticated')")
    expect(f).toContain("errcode = '42501'")
    // Inlined: a member session must not need EXECUTE on a helper to be refused.
    expect(f.slice(f.indexOf('$function$'))).not.toMatch(/tempa_private\.\w+\(/)
    expect(sql).toMatch(/create trigger profiles_editorial_guard\s+before update on public\.profiles/)
  })

  it('the one read path returns only the key and title of house accounts', () => {
    const f = fn('public.editorial_bylines')
    expect(f).toContain('returns table (pseudonym_key text, editorial_title text)')
    expect(f).toContain('select p.pseudonym_key, p.editorial_title')
    expect(f).toContain('where p.is_editorial')
    expect(f).not.toMatch(/p\.id|country|mark_id|email/)
    expect(sql).toContain('revoke all on function public.editorial_bylines() from public, anon, authenticated;')
    expect(sql).toContain('grant execute on function public.editorial_bylines() to anon, authenticated;')
  })

  it('marks Lady Larkspur only, by canonical key, and refuses anything but exactly one row', () => {
    const updates = [...sql.matchAll(/update public\.profiles[\s\S]*?;/g)].map((m) => m[0])
    expect(updates).toHaveLength(1)
    expect(updates[0]).toContain("editorial_title = 'Tempa House Columnist'")
    expect(updates[0]).toContain("where pseudonym_key = public.canonicalize_pseudonym('Lady Larkspur')")
    expect(sql).toContain('if v_count <> 1 then')
  })

  it('the verifier probes members directly AND inside an RPC, leaves nothing behind, and reports OVERALL', () => {
    expect(verify).toContain("execute 'set local role authenticated'")
    expect(verify).toContain("json_build_object('sub', v_member, 'role', 'authenticated')")
    expect(verify).toContain('Member, inside an RPC: cannot change ANOTHER account (Lady Larkspur)')
    expect(verify).toContain("raise exception using errcode = 'P0099', message = 'probe rollback'")
    expect(verify).toContain("'OVERALL', bool_and(pass) and count(*) = 12")
    expect(stripComments(verify)).not.toMatch(/^\s*(commit|update public\.profiles set is_editorial = false)/m)
  })
})
