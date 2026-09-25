// Same convention as the other migration tests — CI cannot execute
// Postgres, so the tracked SQL is inspected directly. The migration +
// verifier were also executed on real PostgreSQL (PGlite, outside the
// repo) together with the REAL, unchanged member publish_dispatch /
// update_dispatch from 2026-10-06; see the PR for the 41 checks.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const SQL_DIR = path.join(__dirname, '..', '..', 'docs', 'sql')
const read = (n: string) => readFileSync(path.join(SQL_DIR, n), 'utf8').replace(/\r\n/g, '\n')
const migration = read('2026-10-15-official-sponsored-dispatches.sql')
const verify = read('2026-10-15-official-sponsored-dispatches-verify.sql')
const code = migration.replace(/^\s*--.*$/gm, '')

const fn = (name: string) => {
  const start = code.indexOf(`create or replace function ${name}(`)
  expect(start, name).toBeGreaterThan(-1)
  return code.slice(start, code.indexOf('$function$;', start))
}

describe('forward-only', () => {
  it('one transaction, NOT EXECUTED, no historical function touched except get_shared_dispatch', () => {
    expect((migration.match(/^begin;/gm) ?? []).length).toBe(1)
    expect((migration.match(/^commit;/gm) ?? []).length).toBe(1)
    expect(migration).toContain('STATUS: NOT EXECUTED')
    expect(code).not.toContain('function public.publish_dispatch(')
    expect(code).not.toContain('function public.update_dispatch(')
    const drops = code.match(/\bdrop\b[^;]*;/gi) ?? []
    expect(drops).toEqual(['drop function if exists public.get_shared_dispatch(uuid);'])
  })
})

describe('publication identity model', () => {
  it('one canonical column, defaulting existing and member rows to member', () => {
    expect(code).toContain("add column if not exists published_as text not null default 'member'")
    expect(code).toContain("check (published_as in ('member', 'tempa', 'sponsored'))")
  })

  it('sponsored requires a sponsor; member/tempa carry no sponsor metadata; https-only CTA', () => {
    expect(code).toContain('dispatches_sponsor_shape')
    expect(code).toMatch(/published_as <> 'sponsored'\s+and sponsor_name is null\s+and sponsor_cta_label is null\s+and sponsor_cta_url is null/)
    expect(code).toContain("sponsor_cta_url ~ '^https://")
  })

  it('trigger: only admin-authored rows may be non-member; identity immutable', () => {
    const t = fn('tempa_private.dispatches_publication_identity_guard')
    expect(t).toContain("where sr.user_id = new.author_id and sr.role = 'admin'")
    expect(t).toContain('new.published_as is distinct from old.published_as')
    expect(code).toContain('create trigger dispatches_publication_identity_guard')
  })
})

describe('staff-only publish/update', () => {
  it('is_staff(admin) is checked before anything is written; never creates member rows', () => {
    const p = fn('public.publish_official_dispatch')
    expect(p.indexOf("public.is_staff('admin')")).toBeGreaterThan(-1)
    expect(p.indexOf("public.is_staff('admin')")).toBeLessThan(p.indexOf('insert into public.dispatches'))
    expect(p).toContain("p_published_as not in ('tempa', 'sponsored')")
    expect(fn('public.update_official_dispatch')).toContain("public.is_staff('admin')")
  })

  it('does not consume a member Safety evaluation (staff content action)', () => {
    expect(fn('public.publish_official_dispatch')).not.toContain('consume_safety_evaluation')
    expect(fn('public.update_official_dispatch')).not.toContain('consume_safety_evaluation')
  })

  it('Postcard sender: Tempa / sponsor — never a profiles lookup', () => {
    const p = fn('public.publish_official_dispatch')
    expect(p).toContain("v_sender := 'Tempa'")
    expect(p).toContain('v_sender := v_sponsor_name')
    expect(p).not.toContain('from public.profiles')
  })

  it('same edit window and reply lock as members', () => {
    const u = fn('public.update_official_dispatch')
    expect(u).toContain("interval '30 minutes'")
    expect(u).toContain('from public.dispatch_replies')
  })

  it('grants: authenticated only; PUBLIC/anon revoked', () => {
    for (const sig of [
      'public.publish_official_dispatch(text, text, text, text[], jsonb, jsonb, text, text, text)',
      'public.update_official_dispatch(uuid, text, text, text[], jsonb, text, text, text)',
    ]) {
      expect(code).toContain(`revoke all on function ${sig} from public, anon, authenticated;`)
      expect(code).toContain(`grant execute on function ${sig} to authenticated;`)
    }
  })
})

describe('get_shared_dispatch', () => {
  const s = () => fn('public.get_shared_dispatch')
  it('share-token gate unchanged', () => {
    expect(s()).toContain('where ds.id = p_token\n    and ds.revoked_at is null\n    and d.status = \'published\'\n    and d.moderation_status = \'visible\'')
  })
  it('official/sponsored identity never reads the admin profile; author_id never returned', () => {
    expect(s()).toContain("when 'tempa' then 'Tempa'")
    expect(s()).toContain("when 'sponsored' then d.sponsor_name")
    expect(s()).toContain("when d.published_as = 'member'")
    const returns = s().slice(0, s().indexOf('language plpgsql'))
    expect(returns).not.toContain('author_id')
  })
  it('anon keeps execute', () => {
    expect(code).toContain('grant execute on function public.get_shared_dispatch(uuid) to anon, authenticated;')
  })
})

describe('verifier', () => {
  it('read-only with a single overall_pass', () => {
    const v = verify.replace(/^\s*--.*$/gm, '').replace(/'[^']*'/g, "''").toLowerCase()
    expect(v).not.toMatch(/\b(insert|update|delete|create|alter|drop|grant|revoke|truncate)\b/)
    expect((v.match(/as overall_pass/g) ?? []).length).toBe(1)
    for (const c of ['member_publish_has_no_identity_choice', 'official_publish_staff_gated', 'official_postcard_sender_resolved', 'shared_never_returns_author_id', 'anon_cannot_mutate', 'public_execute_revoked', 'no_spoofed_sponsor_metadata']) {
      expect(v).toContain(c)
    }
  })
})

describe('board_feed_page — relationship signals isolated to member rows', () => {
  const extract = (sql: string) => {
    const start = sql.indexOf('create or replace function public.board_feed_page(')
    expect(start).toBeGreaterThan(-1)
    const grant = 'grant execute on function public.board_feed_page(\n  timestamptz, text, integer, smallint, numeric, integer, uuid\n) to authenticated;'
    return sql.slice(start, sql.indexOf(grant, start) + grant.length)
  }
  const historical = extract(read('2026-09-27-topical-interests.sql'))
  const current = extract(migration)

  it('is the 2026-09-27 definition byte-for-byte except the three marked identity-isolation edits', () => {
    const reverted = current
      .replace(/\n\s*-- PUBLICATION IDENTITY \(2026-10-15\)[^\n]*(\n\s*--[^\n]*)*/g, '')
      .replace(/, d2?\.published_as\n/g, '\n')
      .replace("\n        and d2.published_as = 'member'", '')
      .replace(" and ce.published_as = 'member'", '')
      .replace('partition by c.seen_bucket, c.author_id, c.published_as order by', 'partition by c.seen_bucket, c.author_id order by')
    expect(reverted).toBe(historical)
  })

  it('Keep/correspondent familiarity only joins member rows; augmentation only pulls member rows', () => {
    expect(current).toContain("left join familiar_authors fa on fa.author_id = ce.author_id and ce.published_as = 'member'")
    expect(current).toContain("where d2.author_id = fa.author_id\n        -- PUBLICATION IDENTITY")
    expect(current).toContain("and d2.published_as = 'member'")
  })

  it('same signature, RETURNS TABLE, SECURITY INVOKER, search_path, keyset order and grants', () => {
    const header = (fn: string) => fn.slice(0, fn.indexOf('as $$'))
    expect(header(current)).toBe(header(historical))
    expect(current).toContain('order by f.seen_bucket, f.rank_key, f.seed_hash, f.id')
    expect(current).toContain('grant execute on function public.board_feed_page(\n  timestamptz, text, integer, smallint, numeric, integer, uuid\n) to authenticated;')
  })

  it('no official/paid boost is introduced', () => {
    expect(current).not.toMatch(/published_as\s*(=|in)\s*\(?'(tempa|sponsored)'/)
  })
})
