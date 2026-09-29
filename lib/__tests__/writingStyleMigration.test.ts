// Writing Style (2026-10-29). CI cannot run Postgres, so the SQL contract
// is checked against the tracked text, same convention as the other
// migration tests.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { WRITING_STYLE_IDS } from '@/lib/writing-style'

const ROOT = path.join(__dirname, '..', '..')
const read = (f: string) => readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n')
const strip = (s: string) => s.replace(/--.*$/gm, '')
const migration = read('docs/sql/2026-10-29-writing-style.sql')
const verify = read('docs/sql/2026-10-29-writing-style-verify.sql')
const code = strip(migration)

function block(startMarker: string) {
  const start = code.indexOf(startMarker)
  expect(start, startMarker).toBeGreaterThan(-1)
  return code.slice(start, code.indexOf('$function$;', start))
}

const ID_LIST = WRITING_STYLE_IDS.map((id) => `'${id}'`).join(', ')

describe('2026-10-29 writing style — shape', () => {
  it('one transaction, marked not yet applied, with a read-only verifier', () => {
    expect((migration.match(/^begin;/gm) ?? []).length).toBe(1)
    expect((migration.match(/^commit;/gm) ?? []).length).toBe(1)
    expect(migration).toContain('STATUS: NOT YET APPLIED')
    expect(strip(verify)).not.toMatch(/\b(insert|update|delete|alter|drop|create|grant|revoke)\b/i)
    expect(verify).toContain('overall_pass')
  })

  it('stores only semantic ids — every check constraint lists exactly the registry ids', () => {
    const constraints = code.match(/in \('ink'[^)]*\)/g) ?? []
    expect(constraints.length).toBeGreaterThanOrEqual(4)
    for (const c of constraints) expect(c).toBe(`in (${ID_LIST})`)
    expect(code).not.toMatch(/Kalam|Patrick Hand|Caveat|Lora|Garamond|Courier/)
  })
})

describe('existing members are never assigned an identity', () => {
  it('profiles.writing_style_id is nullable with no default and no backfill', () => {
    expect(code).toContain('add column if not exists writing_style_id text;')
    const added = code.match(/add column if not exists \w*writing_style_id[^;]*;/g) ?? []
    expect(added).toHaveLength(3)
    for (const stmt of added) expect(stmt).toMatch(/writing_style_id text;$/)
    // The only UPDATE of profiles is inside the member's own setter.
    const updates = code.match(/update public\.profiles[\s\S]*?;/g) ?? []
    expect(updates).toHaveLength(1)
    expect(updates[0]).toContain('where id = auth.uid()')
    expect(code).not.toMatch(/update public\.(letters|dispatches)/)
  })

  it('new profiles always start without a style, whatever the insert supplied', () => {
    expect(block('create or replace function tempa_private.force_initial_profile_writing_style()')).toContain(
      'new.writing_style_id := null;'
    )
    expect(code).toContain('before insert on public.profiles')
  })
})

describe('the one write path — set_my_writing_style', () => {
  const fn = block('create or replace function public.set_my_writing_style(p_style_id text)')

  it('is SECURITY DEFINER, search_path pinned, authenticated-only', () => {
    expect(fn).toContain('security definer')
    expect(fn).toContain("set search_path to 'pg_catalog'")
    expect(code).toContain('revoke all on function public.set_my_writing_style(text) from public, anon;')
    expect(code).toContain('grant execute on function public.set_my_writing_style(text) to authenticated;')
  })

  it('rejects unknown ids and never runs before Mark/Question are done', () => {
    expect(fn).toContain(`p_style_id not in (${ID_LIST})`)
    expect(fn).toContain("if v_stage <> 'complete' then")
    expect(fn).toContain('where id = auth.uid()')
  })
})

describe('historical correspondence never changes — send-time snapshots', () => {
  it('letters snapshot the sender’s profile style on INSERT, ignoring any caller-supplied value', () => {
    const fn = block('create or replace function tempa_private.snapshot_letter_writing_style()')
    expect(fn).toMatch(/if tg_op = 'INSERT' then\s+[\s\S]*new\.author_writing_style_id := \(\s*select p\.writing_style_id from public\.profiles p where p\.id = new\.sender_id/)
    expect(fn).toContain('security definer')
  })

  it('an UPDATE can never restyle a sent letter (edit window included)', () => {
    const fn = block('create or replace function tempa_private.snapshot_letter_writing_style()')
    expect(fn).toContain('new.author_writing_style_id := old.author_writing_style_id;')
    expect(code).toContain('before insert or update of author_writing_style_id on public.letters')
  })

  it('member Dispatches snapshot at publish; official/sponsored speak in Tempa’s voice', () => {
    const fn = block('create or replace function tempa_private.snapshot_dispatch_writing_style()')
    expect(fn).toContain("coalesce(new.published_as, 'member') = 'member'")
    expect(fn).toContain('where p.id = new.author_id')
    expect(fn).toContain('new.author_writing_style_id := old.author_writing_style_id;')
    expect(code).toContain('before insert or update of author_writing_style_id on public.dispatches')
  })

  it('legacy rows stay null (Tempa classic prose) — no default, no backfill', () => {
    expect(code).toMatch(/alter table public\.letters\s+add column if not exists author_writing_style_id text;/)
    expect(code).toMatch(/alter table public\.dispatches\s+add column if not exists author_writing_style_id text;/)
  })

  it('does not touch letters_for_participant or public_profiles (row types other RPCs return)', () => {
    expect(code).not.toMatch(/create or replace view/i)
  })
})

describe('read paths expose ids only, under existing visibility rules', () => {
  it('member styles only for members the caller can already see; letter snapshots only for readable letters', () => {
    const members = block('create or replace function public.member_writing_styles(p_user_ids uuid[])')
    expect(members).toContain('exists (select 1 from public.public_profiles pp where pp.id = p.id)')
    expect(members).toContain('p_user_ids[1:200]')
    const letters = block('create or replace function public.letter_writing_styles(p_letter_ids uuid[])')
    expect(letters).toContain('exists (select 1 from public.letters_for_participant v where v.id = l.id)')
    for (const f of ['member_writing_styles(uuid[])', 'letter_writing_styles(uuid[])']) {
      expect(code).toContain(`revoke all on function public.${f} from public, anon;`)
    }
  })

  it('the only anonymous paths reuse the shared/public Dispatch predicates', () => {
    expect(block('create or replace function public.shared_dispatch_writing_style(p_token uuid)')).toContain(
      'tempa_private.author_content_publicly_visible(d.author_id)'
    )
    expect(block('create or replace function public.public_dispatch_writing_style(p_slug text)')).toContain(
      'tempa_private.dispatch_is_web_public(d.id)'
    )
    const anonGrants = [...code.matchAll(/grant\s+[^;]*?\s+to\s+([^;]*);/gi)].filter((g) => /\banon\b/.test(g[1]))
    expect(anonGrants.map((g) => g[0].match(/function (\S+\([^)]*\))/)?.[1])).toEqual([
      'public.shared_dispatch_writing_style(uuid)',
      'public.public_dispatch_writing_style(text)',
    ])
  })
})

describe('account entry — has_writing_style', () => {
  const fn = code.slice(code.indexOf('create function public.current_account_entry_state('))

  it('recreates the entry-state RPC with the new column and the same grants', () => {
    expect(code).toContain('drop function if exists public.current_account_entry_state(text, text);')
    expect(fn).toContain('has_writing_style boolean')
    expect(fn).toContain('p.writing_style_id is not null')
    expect(fn).toContain('security invoker')
    expect(code).toContain('revoke all on function public.current_account_entry_state(text, text) from public, anon;')
    expect(code).toContain('grant execute on function public.current_account_entry_state(text, text) to authenticated;')
  })

  it('keeps every lifecycle/eligibility/legal column of the 2026-10-16 version', () => {
    for (const col of ['account_status', 'eligibility_status', 'has_profile', 'onboarding_stage', 'terms_current', 'guidelines_current']) {
      expect(fn).toContain(`as ${col}`)
    }
    expect(fn).toContain("when 'deactivated' then 'deactivated'")
  })
})
