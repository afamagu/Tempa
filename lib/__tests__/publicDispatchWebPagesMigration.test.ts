// Public Dispatch web pages — pinned against the tracked migration text.
// Behaviour proven on PGlite over a production-shaped fixture (see the
// PR): existing member Dispatches untouched, official/sponsored backfilled
// with permanent slugs, every non-public state removing page data, sitemap
// entry and anonymous photo access immediately.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const DIR = path.join(__dirname, '..', '..', 'docs', 'sql')
const read = (f: string) => readFileSync(path.join(DIR, f), 'utf8').replace(/\r\n/g, '\n')
const sql = read('2026-10-27-public-dispatch-web-pages.sql')
const verify = read('2026-10-27-public-dispatch-web-pages-verify.sql')
const body = sql.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n')
const fn = (name: string) => {
  const start = body.indexOf(`create or replace function ${name}(`)
  expect(start, name).toBeGreaterThan(-1)
  return body.slice(start, body.indexOf('$function$;', start) > -1 ? body.indexOf('$function$;', start) : body.indexOf('$$;', start))
}

describe('2026-10-27 public Dispatch web pages', () => {
  it('is forward-only and transactional; no drop, no rewrite of Dispatch content', () => {
    expect(body.trim().startsWith('begin;')).toBe(true)
    expect(body.trim().endsWith('commit;')).toBe(true)
    expect(body).not.toMatch(/drop table|drop column|update public\.dispatches set (title|body|status|published_at|moderation_status)/i)
  })

  it('member Dispatches stay members-only: the column defaults to false and the backfill touches only official/sponsored', () => {
    expect(body).toContain('add column if not exists web_public boolean not null default false')
    // top-level statements only (the setter RPC's own `set web_public = p_public` is the author's choice)
    const updates = [...body.matchAll(/update public\.dispatches set[^;]*;/g)].map((m) => m[0]).filter((u) => !u.includes('p_public'))
    expect(updates).toEqual(["update public.dispatches set web_public = true where published_as <> 'member' and not web_public;"])
  })

  it('official/sponsored are public by default on insert; slugs are generated once and are permanent', () => {
    const trig = fn('tempa_private.dispatch_web_lifecycle')
    expect(trig).toContain("if tg_op = 'INSERT' and new.published_as <> 'member' then")
    expect(trig).toContain("web address is permanent")
    expect(trig).toContain('if new.web_public and new.web_slug is null then')
    expect(trig).toContain("tempa_private.dispatch_slugify(new.title) || '-' || substr(md5(gen_random_uuid()::text), 1, 12)")
    expect(body).toContain("web_slug ~ '^[a-z0-9]+(-[a-z0-9]+)*-[0-9a-f]{12}$'")
    expect(body).not.toMatch(/\{6\}|, 1, 6\)/)
    expect(body).toContain('create unique index if not exists dispatches_web_slug_key on public.dispatches (web_slug) where web_slug is not null;')
  })

  it('dateModified moves only when the title or body actually changes', () => {
    expect(fn('tempa_private.dispatch_web_lifecycle')).toContain('if new.title is distinct from old.title or new.body is distinct from old.body then')
  })

  it('one predicate carries every gate and is used by the page, the sitemap and photo access', () => {
    const p = fn('tempa_private.dispatch_is_web_public')
    for (const gate of ['d.web_public', 'd.web_slug is not null', "d.status = 'published'", "d.moderation_status = 'visible'",
      "d.published_as <> 'member' or tempa_private.author_content_publicly_visible(d.author_id)"]) {
      expect(p, gate).toContain(gate)
    }
    expect(fn('public.get_public_dispatch')).toContain('tempa_private.dispatch_is_web_public(found_id)')
    expect(fn('public.list_public_dispatches')).toContain('tempa_private.dispatch_is_web_public(d.id)')
    expect(body).toMatch(/or exists \(\s*select 1\s*from public\.dispatch_moments dm\s*where dm\.image_path = p_path\s*and tempa_private\.dispatch_is_web_public\(dm\.dispatch_id\)/)
  })

  it('the share-link photo branch is kept exactly (only a second, web-public branch is added)', () => {
    expect(body).toMatch(/join public\.dispatch_shares ds on ds\.dispatch_id = d\.id\s*where dm\.image_path = p_path\s*and d\.status = 'published'\s*and d\.moderation_status = 'visible'\s*and ds\.revoked_at is null/)
  })

  it('the open-web read returns public fields only — never the internal id, the author id or a creating admin', () => {
    const get = fn('public.get_public_dispatch')
    const returns = get.slice(0, get.indexOf('language'))
    expect(returns).not.toMatch(/\bdispatch_id\b|\bauthor_id\b|\bid uuid\b/)
    expect(get).toContain("when 'tempa' then 'Tempa'")
    expect(get).toContain("p_slug !~ '^[a-z0-9]+(-[a-z0-9]+)*$'")
  })

  it('only the author (member) or an admin (official/sponsored) can change it; restricted accounts cannot make things public', () => {
    // one rule set, shared by the standing control and the atomic saves
    expect(fn('public.set_dispatch_web_public')).toContain('tempa_private.apply_dispatch_web_public(p_dispatch_id, p_public)')
    const set = fn('tempa_private.apply_dispatch_web_public')
    expect(set).toContain('d.author_id is distinct from v_uid')
    expect(set).toContain("public.is_staff('admin')")
    expect(set).toContain("p_public and public.current_account_status() is distinct from 'active'")
    expect(set).toContain("p_public and d.status <> 'published'")
    expect(set).toContain('for update')
  })

  it('privileges: anon may only call the two read paths; the setter is members-only; helpers are nobody’s', () => {
    expect(body).toContain('grant execute on function public.get_public_dispatch(text) to anon, authenticated;')
    expect(body).toContain('grant execute on function public.list_public_dispatches() to anon, authenticated;')
    expect(body).toContain('revoke all on function public.set_dispatch_web_public(uuid, boolean) from public, anon;')
    expect(body).toContain('revoke all on function tempa_private.apply_dispatch_web_public(uuid, boolean) from public, anon, authenticated;')
    for (const w of ['publish_dispatch_with_web_visibility(text, text, uuid, text[], jsonb, jsonb, boolean, boolean)',
      'update_dispatch_with_web_visibility(uuid, text, text, uuid, text[], jsonb, boolean, boolean)',
      'publish_official_dispatch_with_web_visibility(text, text, text, text[], jsonb, jsonb, text, text, text, boolean)',
      'update_official_dispatch_with_web_visibility(uuid, text, text, text[], jsonb, text, text, text, boolean)']) {
      expect(body).toContain(`revoke all on function public.${w} from public, anon;`)
      expect(body).toContain(`grant execute on function public.${w} to authenticated;`)
    }
    for (const f of ['dispatch_slugify(text)', 'dispatch_web_lifecycle()', 'dispatch_is_web_public(uuid)']) {
      expect(body).toContain(`revoke all on function tempa_private.${f} from public, anon, authenticated;`)
    }
    expect(body).not.toMatch(/grant (select|insert|update|delete)[^;]*on public\.dispatches/i)
  })

  it('save + requested web state are ONE transaction: members-only applied BEFORE the content is written (public → members-only)', () => {
    for (const [wrapper, inner] of [
      ['public.update_dispatch_with_web_visibility', 'public.update_dispatch('],
      ['public.update_official_dispatch_with_web_visibility', 'public.update_official_dispatch('],
    ]) {
      const w = fn(wrapper)
      const off = w.indexOf('if not p_web_public then')
      expect(off, wrapper).toBeGreaterThan(-1)
      expect(w.indexOf('tempa_private.apply_dispatch_web_public(p_dispatch_id, false)'), wrapper).toBeGreaterThan(off)
      expect(w.indexOf('tempa_private.apply_dispatch_web_public(p_dispatch_id, false)'), wrapper).toBeLessThan(w.indexOf(inner))
      // members-only → public: the content first, then the (refusable) public step — a refusal rolls back both
      expect(w.indexOf('tempa_private.apply_dispatch_web_public(p_dispatch_id, true)'), wrapper).toBeGreaterThan(w.indexOf(inner))
      expect(w, wrapper).not.toMatch(/exception\s+when/i)
    }
  })

  it('member publish is members-only unless public is requested, in the same transaction', () => {
    const w = fn('public.publish_dispatch_with_web_visibility')
    expect(w.indexOf('public.publish_dispatch(')).toBeLessThan(w.indexOf('tempa_private.apply_dispatch_web_public(d.id, true)'))
    expect(w).not.toMatch(/exception\s+when/i)
  })

  it('official/sponsored created members-only are INSERTED members-only — never the public default, even inside the transaction', () => {
    const w = fn('public.publish_official_dispatch_with_web_visibility')
    const req = w.indexOf("set_config('tempa.dispatch_web_public_request', p_web_public::text, true)")
    expect(req).toBeGreaterThan(-1)
    expect(req).toBeLessThan(w.indexOf('public.publish_official_dispatch('))
    expect(w.indexOf("set_config('tempa.dispatch_web_public_request', '', true)")).toBeGreaterThan(w.indexOf('public.publish_official_dispatch('))
    expect(w).toContain('tempa_private.apply_dispatch_web_public(d.id, p_web_public)')
    expect(fn('tempa_private.dispatch_web_lifecycle')).toContain(
      "new.web_public := coalesce(nullif(current_setting('tempa.dispatch_web_public_request', true), '')::boolean, true);")
  })

  it('the anonymous Moments payload carries position + storage path only — never dispatch_moments.id', () => {
    const get = fn('public.get_public_dispatch')
    expect(get).toContain("jsonb_build_object('position', dm.position, 'image_path', dm.image_path)")
    expect(get).not.toMatch(/'id',\s*dm\.id/)
  })

  it('the verifier is read-only and its overall_pass covers the structural guarantees', () => {
    const code = verify.split('\n').map((l) => l.replace(/--.*$/, '')).join('\n').replace(/'(?:[^']|'')*'/g, "''")
    expect(code.trim()).toMatch(/^with /)
    expect(code).not.toMatch(/\b(insert\s+into|update\s+\w+\s+set|delete\s+from|alter|create|drop|grant|revoke|truncate)\b/i)
    const overall = verify.slice(verify.lastIndexOf('select *,'))
    for (const c of ['execute_privileges_correct', 'base_table_closed', 'one_predicate_everywhere', 'no_internal_ids_exposed',
      'visibility_atomic_and_fail_closed', 'slug_suffix_12_hex', 'slug_permanent', 'every_public_dispatch_has_slug']) {
      expect(overall, c).toContain(c)
    }
  })
})
