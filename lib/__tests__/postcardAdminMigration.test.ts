// Admin Phase 2A-2 — this repository cannot execute Postgres, so every
// requirement that lives purely in SQL (admin floors, no delete
// anywhere, immutable-version discipline, audit logging, revoke/grant
// pairs, the no-user-id-oracle Keepsakes RPC, storage bucket policy)
// is verified directly against the tracked migration source text, same
// convention as adminModerationMigration.test.ts/
// adminOverviewMigration.test.ts/publishDispatchMigration.test.ts.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const MIGRATION_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-09-21-postcard-admin-and-keepsakes.sql')
const sql = readFileSync(MIGRATION_PATH, 'utf8')

const REPO_ROOT = path.join(__dirname, '..', '..')

// Strips `-- ...` line comments before a blanket scan — this file's own
// (and the Core migration's own) header prose legitimately narrates the
// deadlock/three-transaction split by NAME, mentioning storage.buckets,
// storage.objects, and the policy identifiers as history/documentation,
// never as actual executable statements. Mirrors the same
// comment-stripping convention used elsewhere in this codebase (e.g.
// app/letters/[letterId]/letter-preview.test.tsx's stripComments).
function stripLineComments(text: string): string {
  return text.replace(/^--.*$/gm, '')
}
const codeOnly = stripLineComments(sql)

function extractFunctionBody(functionName: string): string {
  const start = sql.indexOf(`create or replace function public.${functionName}(`)
  expect(start, `expected to find "${functionName}" defined in ${MIGRATION_PATH}`).toBeGreaterThan(-1)
  const end = sql.indexOf('$function$;', start)
  expect(end, `expected a closing $function$; for "${functionName}"`).toBeGreaterThan(start)
  return sql.slice(start, end)
}

describe('one BEGIN/COMMIT, LIVE and applied (Repo Reconciliation pass, 2026-09-23)', () => {
  it('wraps everything in exactly one begin/commit and is explicitly marked LIVE, not a draft awaiting review', () => {
    expect((sql.match(/^begin;/m) ?? []).length).toBe(1)
    expect((sql.match(/^commit;/m) ?? []).length).toBe(1)
    expect(sql).toContain('STATUS: LIVE')
    expect(sql).not.toContain('STATUS: NOT EXECUTED')
  })

  it('documents the original combined-transaction deadlock and the three-transaction split, without silently erasing that history', () => {
    expect(sql).toContain('40P01')
    expect(sql).toContain('deadlock')
    expect(sql).toMatch(/17296/)
    expect(sql).toMatch(/17306/)
    expect(sql).toContain('postcard-artwork-bucket.sql')
    expect(sql).toContain('postcard-artwork-policies.sql')
  })

  it('never edits the already-live 2026-09-14 migration\'s executable SQL — this is a separate, additive file', () => {
    const livePath = path.join(REPO_ROOT, 'docs', 'sql', '2026-09-14-letter-level-postcards.sql')
    const liveSql = readFileSync(livePath, 'utf8')
    expect(liveSql).toContain('APPLIED LIVE AND VERIFIED')
    // The live file's own executable statements are untouched — this
    // migration only ever ALTERs/adds new objects, never re-creates
    // postcard_catalog/postcard_versions/letter_postcards from scratch.
    expect(sql).not.toMatch(/create table public\.postcard_catalog/)
    expect(sql).not.toMatch(/create table public\.postcard_versions/)
    expect(sql).not.toMatch(/create table public\.letter_postcards/)
  })
})

// Repo Reconciliation pass, 2026-09-23 — the Core file (this one) is
// now ISOLATED from every Storage operation: the original combined
// migration's Part C (bucket insert + storage.objects policies, all in
// this same transaction) deadlocked live against Supabase Storage's
// own internal locking and was split into two separate, independently-
// committing files/transactions. This file must never regain any
// Storage statement — that would silently reintroduce the exact
// single-transaction shape that deadlocked in production.
describe('Core migration contains NO Storage operations of any kind', () => {
  it('never mutates storage.buckets', () => {
    expect(codeOnly).not.toMatch(/storage\.buckets/)
  })

  it('never creates a storage.objects policy', () => {
    expect(codeOnly).not.toMatch(/on storage\.objects/)
    expect(codeOnly).not.toContain('postcard_artwork_select')
    expect(codeOnly).not.toContain('postcard_artwork_insert')
  })

  it('never references the postcard-artwork bucket at all', () => {
    expect(codeOnly).not.toContain("'postcard-artwork'")
  })
})

describe('PART A — postcard_versions widened additively, backfilled, then locked to NOT NULL', () => {
  it('adds the five presentation columns with "add column if not exists" — additive, never destructive', () => {
    for (const col of ['title', 'location', 'collection', 'postmark_text', 'footer_text']) {
      expect(sql).toContain(`add column if not exists ${col} text`)
    }
  })

  it('backfills the two existing Version 1 rows from the exact real production metadata, scoped by postcard_key and only where still null (never overwrites a later admin-authored version)', () => {
    expect(sql).toMatch(/postcard_key = 'essaouira' and title is null/)
    expect(sql).toMatch(/postcard_key = 'bangkokAfterRain' and title is null/)
    expect(sql).toContain("title = 'Essaouira'")
    expect(sql).toContain("title = 'Bangkok'")
  })

  it('locks all five columns to NOT NULL only after the backfill — order matters so live rows are never caught mid-migration', () => {
    const backfillIndex = sql.indexOf("where postcard_key = 'bangkokAfterRain' and title is null")
    const notNullIndex = sql.indexOf('alter column title set not null')
    expect(backfillIndex).toBeGreaterThan(-1)
    expect(notNullIndex).toBeGreaterThan(backfillIndex)
  })

  it('documents on every new column that admin edits must never rewrite an already-sent Postcard', () => {
    const comments = sql.match(/comment on column public\.postcard_versions\.\w+ is[\s\S]*?;/g) ?? []
    expect(comments.length).toBeGreaterThanOrEqual(5)
    expect(sql).toMatch(/ADMIN EDITS TODAY MUST NOT REWRITE YESTERDAY/)
  })
})

describe('admin RPCs (PART B) — admin floor, no delete, always-new-version discipline, audited', () => {
  const functionNames = [
    'admin_list_postcards',
    'admin_add_postcard',
    'admin_create_postcard_version',
    'admin_set_postcard_active',
  ]

  it.each(functionNames)('%s requires is_staff(\'admin\')', (fn) => {
    const body = extractFunctionBody(fn)
    expect(body).toContain("if not public.is_staff('admin') then")
    expect(body).toContain("raise exception 'Not authorized.';")
  })

  it.each(functionNames)('%s is SECURITY DEFINER with a hardened, fixed search_path', (fn) => {
    const start = sql.indexOf(`create or replace function public.${fn}(`)
    const header = sql.slice(start, start + 600)
    expect(header).toContain('security definer')
    expect(header).toContain("set search_path to 'pg_catalog'")
  })

  it.each(functionNames)('%s has a matching revoke-from-public / grant-to-authenticated pair', (fn) => {
    const revokeRe = new RegExp(`revoke all on function public\\.${fn}\\([^)]*\\) from public;`)
    const grantRe = new RegExp(`grant execute on function public\\.${fn}\\([^)]*\\) to authenticated;`)
    expect(sql).toMatch(revokeRe)
    expect(sql).toMatch(grantRe)
  })

  it('no delete/drop-of-a-Postcard RPC exists anywhere in this migration — explicitly forbidden by the checkpoint', () => {
    expect(sql).not.toMatch(/create or replace function public\.admin_delete_postcard/)
    expect(sql).not.toMatch(/delete from public\.postcard_catalog/)
    expect(sql).not.toMatch(/delete from public\.postcard_versions/)
  })

  it('admin_create_postcard_version always creates a NEW row — clears the old current, then inserts, never an UPDATE of an existing version\'s presentation/artwork columns', () => {
    const body = extractFunctionBody('admin_create_postcard_version')
    expect(body).toContain('update public.postcard_versions set is_current = false where postcard_key = v_key and is_current;')
    expect(body).toContain('insert into public.postcard_versions (')
    // Scoped to JUST the is_current-clearing statement (not the whole
    // function body) — postcard_catalog.title legitimately gets synced
    // elsewhere below (a different table entirely), which a body-wide
    // scan would otherwise false-positive on.
    const clearCurrentStart = body.indexOf('update public.postcard_versions set is_current = false')
    const clearCurrentEnd = body.indexOf(';', clearCurrentStart)
    const clearCurrentStatement = body.slice(clearCurrentStart, clearCurrentEnd)
    expect(clearCurrentStatement).not.toMatch(/title\s*=/)
    expect(clearCurrentStatement).not.toMatch(/location\s*=/)
    expect(clearCurrentStatement).not.toMatch(/front_image_path\s*=/)
  })

  it('admin_create_postcard_version computes the next version_number from max(version_number)+1, never reusing or guessing one', () => {
    const body = extractFunctionBody('admin_create_postcard_version')
    expect(body).toMatch(/coalesce\(max\(version_number\), 0\) \+ 1/)
  })

  it('admin_add_postcard validates the key format and rejects a duplicate before ever inserting', () => {
    const body = extractFunctionBody('admin_add_postcard')
    expect(body).toContain("v_key !~ '^[a-z][a-z0-9_]*$'")
    expect(body).toContain('A postcard with this key already exists.')
  })

  it('admin_add_postcard and admin_create_postcard_version both require every presentation field, not just artwork', () => {
    for (const fn of ['admin_add_postcard', 'admin_create_postcard_version']) {
      const body = extractFunctionBody(fn)
      expect(body).toContain('A title is required.')
      expect(body).toContain('A location is required.')
      expect(body).toContain('A collection name is required.')
      expect(body).toContain('Postmark text is required.')
      expect(body).toContain('Footer text is required.')
      expect(body).toContain('Artwork is required.')
    }
  })

  it('admin_set_postcard_active never touches postcard_versions visibility — deactivating only flips postcard_catalog.is_active, historical letters stay fully readable', () => {
    const body = extractFunctionBody('admin_set_postcard_active')
    expect(body).toContain('update public.postcard_catalog set is_active = p_active where key = v_key;')
    expect(body).not.toMatch(/update public\.postcard_versions/)
  })

  it('admin_set_postcard_active refuses a no-op transition rather than fabricating an audit row', () => {
    const body = extractFunctionBody('admin_set_postcard_active')
    expect(body).toContain('This Postcard is already active.')
    expect(body).toContain('This Postcard is already inactive.')
  })

  it.each(functionNames.filter((f) => f !== 'admin_list_postcards'))('%s writes an admin_audit_log row', (fn) => {
    const body = extractFunctionBody(fn)
    expect(body).toContain('insert into public.admin_audit_log')
  })
})

// Repo Reconciliation pass, 2026-09-23 — the original combined
// migration's Part C (bucket insert + storage.objects policies, one
// transaction) is now two separate LIVE files, split specifically
// because that single-transaction shape deadlocked against Supabase
// Storage in production (ERROR 40P01, storage.buckets vs.
// storage.objects). Each file is tested for exactly what it should
// (and should NOT) contain, so the deadlocked shape can never silently
// reappear by one file creeping into the other's territory.

describe('postcard-artwork-bucket.sql — bucket configuration ONLY, no policy DDL', () => {
  const BUCKET_PATH = path.join(REPO_ROOT, 'docs', 'sql', '2026-09-21-postcard-artwork-bucket.sql')
  const bucketSql = readFileSync(BUCKET_PATH, 'utf8')

  it('is LIVE, one begin/commit, and documents the deadlock/split history', () => {
    expect(bucketSql).toContain('STATUS: LIVE')
    expect((bucketSql.match(/^begin;/m) ?? []).length).toBe(1)
    expect((bucketSql.match(/^commit;/m) ?? []).length).toBe(1)
    expect(bucketSql).toContain('40P01')
    expect(bucketSql).toContain('deadlock')
  })

  it('creates a public bucket (public = true), matching the existing public/postcards/ static assets\' own access characteristics', () => {
    expect(bucketSql).toMatch(/insert into storage\.buckets[\s\S]*?'postcard-artwork'[\s\S]*?true/)
  })

  it('contains no storage.objects policy — that is the separate policies file\'s job only', () => {
    expect(bucketSql).not.toMatch(/create policy/)
    expect(bucketSql).not.toMatch(/on storage\.objects/)
  })

  it('never touches the private-storage buckets used for Photo Moments/Announcements', () => {
    expect(bucketSql).not.toMatch(/'letter-photos'/)
    expect(bucketSql).not.toMatch(/'announcement-images'/)
    expect(bucketSql).not.toMatch(/'dispatch-photos'/)
  })
})

describe('postcard-artwork-policies.sql — the two intended policies ONLY, no bucket mutation', () => {
  const POLICIES_PATH = path.join(REPO_ROOT, 'docs', 'sql', '2026-09-21-postcard-artwork-policies.sql')
  const policiesSql = readFileSync(POLICIES_PATH, 'utf8')

  it('is LIVE, one begin/commit, and documents the deadlock/split history', () => {
    expect(policiesSql).toContain('STATUS: LIVE')
    expect((policiesSql.match(/^begin;/m) ?? []).length).toBe(1)
    expect((policiesSql.match(/^commit;/m) ?? []).length).toBe(1)
    expect(policiesSql).toContain('40P01')
    expect(policiesSql).toContain('deadlock')
  })

  it('creates exactly the two intended policies, and no others', () => {
    const policyNames = [...policiesSql.matchAll(/create policy (\w+)/g)].map((m) => m[1])
    expect(policyNames.sort()).toEqual(['postcard_artwork_insert', 'postcard_artwork_select'])
  })

  it('the insert policy requires is_staff(\'admin\') — no ordinary member can write to this bucket', () => {
    const start = policiesSql.indexOf('create policy postcard_artwork_insert')
    const end = policiesSql.indexOf(';', start)
    const policy = policiesSql.slice(start, end)
    expect(policy).toContain("bucket_id = 'postcard-artwork'")
    expect(policy).toContain("public.is_staff('admin')")
  })

  it('the select policy is scoped to this bucket only, granted to authenticated (defense in depth on top of the public CDN endpoint)', () => {
    const start = policiesSql.indexOf('create policy postcard_artwork_select')
    const end = policiesSql.indexOf(';', start)
    const policy = policiesSql.slice(start, end)
    expect(policy).toContain("bucket_id = 'postcard-artwork'")
  })

  it('contains no bucket mutation — that is the separate bucket file\'s job only', () => {
    const policiesCodeOnly = stripLineComments(policiesSql)
    expect(policiesCodeOnly).not.toMatch(/insert into storage\.buckets/)
    expect(policiesCodeOnly).not.toMatch(/storage\.buckets/)
  })

  it('never touches the private-storage buckets used for Photo Moments/Announcements', () => {
    expect(policiesSql).not.toMatch(/'letter-photos'/)
    expect(policiesSql).not.toMatch(/'announcement-images'/)
    expect(policiesSql).not.toMatch(/'dispatch-photos'/)
  })
})

describe('PART D — Keepsakes: no user-id oracle, no new ownership table beyond the one narrow suppression record', () => {
  it('get_my_postcards hardcodes auth.uid() into the WHERE clause and accepts no target-user parameter at all', () => {
    const start = sql.indexOf('create or replace function public.get_my_postcards(')
    const paramsEnd = sql.indexOf(')', start)
    const params = sql.slice(start, paramsEnd)
    expect(params).not.toMatch(/p_user_id|p_target/)
    const body = extractFunctionBody('get_my_postcards')
    expect(body).toContain('l.recipient_id = auth.uid()')
  })

  it('get_my_postcards gates on delivery (deliver_at <= now()) and excludes the sender\'s own outgoing copy structurally, since only recipient_id is matched', () => {
    const body = extractFunctionBody('get_my_postcards')
    expect(body).toContain('l.deliver_at <= now()')
    expect(body).not.toContain('l.sender_id = auth.uid()')
  })

  it('get_my_postcards excludes anything the caller has removed, via postcard_keepsake_removals', () => {
    const body = extractFunctionBody('get_my_postcards')
    expect(body).toMatch(/not exists \(\s*select 1 from public\.postcard_keepsake_removals/)
  })

  it('is SECURITY DEFINER — required to read the base letters table directly, since authenticated holds zero grants on it', () => {
    const start = sql.indexOf('create or replace function public.get_my_postcards(')
    const bodyStart = sql.indexOf('as $function$', start)
    const header = sql.slice(start, bodyStart)
    expect(header).toContain('security definer')
  })

  it('postcard_keepsake_removals is the ONE new table this migration introduces, and it is a narrow 2-column-plus-timestamp suppression record, never a generic ownership table', () => {
    const createTableCount = (sql.match(/^create table public\.\w+/gm) ?? []).length
    expect(createTableCount).toBe(1)
    expect(sql).toContain('create table public.postcard_keepsake_removals')
    const start = sql.indexOf('create table public.postcard_keepsake_removals')
    const end = sql.indexOf(');', start)
    const body = sql.slice(start, end)
    expect(body).toContain('user_id uuid not null')
    expect(body).toContain('letter_id uuid not null')
    expect(body).toContain('primary key (user_id, letter_id)')
    expect(body).not.toMatch(/rarity|price|points|pack_id|purchase/i)
  })

  it('postcard_keepsake_removals has RLS enabled, a self-scoped select policy, and no direct insert/update/delete grant to authenticated', () => {
    expect(sql).toContain('alter table public.postcard_keepsake_removals enable row level security;')
    const policyStart = sql.indexOf('create policy postcard_keepsake_removals_select_own')
    const policyEnd = sql.indexOf(';', policyStart)
    expect(sql.slice(policyStart, policyEnd)).toContain('auth.uid() = user_id')
    expect(sql).toContain('revoke all on public.postcard_keepsake_removals from public, anon, authenticated;')
    expect(sql).toContain('grant select on public.postcard_keepsake_removals to authenticated;')
    expect(sql).not.toMatch(/grant insert on public\.postcard_keepsake_removals/)
    expect(sql).not.toMatch(/grant update on public\.postcard_keepsake_removals/)
    expect(sql).not.toMatch(/grant delete on public\.postcard_keepsake_removals/)
  })

  it('remove_my_postcard validates genuine, delivered receipt before ever inserting a suppression row, and never touches letter_postcards/letters', () => {
    const body = extractFunctionBody('remove_my_postcard')
    expect(body).toContain('l.recipient_id = auth.uid()')
    expect(body).toContain('l.deliver_at <= now()')
    expect(body).toContain('insert into public.postcard_keepsake_removals')
    expect(body).not.toMatch(/update public\.letter_postcards/)
    expect(body).not.toMatch(/delete from public\.letter_postcards/)
    expect(body).not.toMatch(/update public\.letters/)
    expect(body).not.toMatch(/delete from public\.letters/)
  })

  it('remove_my_postcard rejects a repeat removal rather than silently succeeding twice', () => {
    const body = extractFunctionBody('remove_my_postcard')
    expect(body).toContain('already been removed from your collection')
  })

  it('get_my_postcards and remove_my_postcard both have a revoke/grant pair to authenticated only', () => {
    for (const fn of ['get_my_postcards()', 'remove_my_postcard(uuid)']) {
      expect(sql).toContain(`revoke all on function public.${fn} from public;`)
      expect(sql).toContain(`grant execute on function public.${fn} to authenticated;`)
    }
  })
})

describe('write_letter/reply_to_letter are not touched — a new Postcard is sendable via data alone', () => {
  it('this migration never redefines write_letter or reply_to_letter', () => {
    expect(sql).not.toMatch(/create or replace function public\.write_letter/)
    expect(sql).not.toMatch(/create or replace function public\.reply_to_letter/)
  })
})

describe('no forbidden Phase-2A-2 scope (rarity, price, packs, points, purchases, gifting, physical fulfilment, bulk CMS)', () => {
  it('the migration text contains none of the explicitly forbidden commerce/ownership vocabulary', () => {
    const forbidden = ['rarity', 'price', 'pack_id', 'points_cost', 'purchase', 'gifting', 'fulfilment', 'fulfillment']
    for (const word of forbidden) {
      expect(sql.toLowerCase()).not.toContain(word)
    }
  })
})

// Independent SQL review correction pass (2026-09-22) — the live
// catalogue's own mixed-case key `bangkokAfterRain` must remain
// editable/deactivatable through Admin: the two RPCs that operate on
// an EXISTING key must compare against the exact durable identity,
// never a lower()'d one.
describe('mixed-case key regression guard — existing-key RPCs must never lower() p_key', () => {
  it.each(['admin_create_postcard_version', 'admin_set_postcard_active'])(
    '%s trims p_key but never lower()s it',
    (fn) => {
      const body = extractFunctionBody(fn)
      expect(body).toMatch(/v_key\s*:=\s*trim\(both from coalesce\(p_key, ''\)\);/)
      expect(body).not.toMatch(/v_key\s*:=\s*lower\(/)
    }
  )

  it('admin_add_postcard is the ONLY function in this migration allowed to lower() its own key — it is minting a brand NEW identity, never looking one up', () => {
    const addBody = extractFunctionBody('admin_add_postcard')
    expect(addBody).toMatch(/v_key\s*:=\s*lower\(trim\(both from coalesce\(p_key, ''\)\)\);/)

    const lowerTrimOccurrences = (sql.match(/v_key\s*:=\s*lower\(trim/g) ?? []).length
    expect(lowerTrimOccurrences).toBe(1)
  })

  it('no function anywhere in this migration could ever produce/look up the literal lowercase "bangkokafterrain"', () => {
    expect(sql).not.toContain("'bangkokafterrain'")
  })
})

describe('admin_create_postcard_version — per-key serialization lock (independent review item 3)', () => {
  it('locks the target postcard_catalog row with FOR UPDATE before computing the next version_number or flipping is_current', () => {
    const body = extractFunctionBody('admin_create_postcard_version')
    // Anchored to the actual `perform ... for update;` statement, not
    // a bare case-insensitive "for update" scan (which would also
    // match the phrase inside this function's own preceding doc
    // comment).
    const lockIndex = body.indexOf('perform 1 from public.postcard_catalog')
    const versionNumberIndex = body.indexOf('coalesce(max(version_number), 0) + 1')
    const flipCurrentIndex = body.indexOf('update public.postcard_versions set is_current = false')
    expect(lockIndex).toBeGreaterThan(-1)
    expect(versionNumberIndex).toBeGreaterThan(lockIndex)
    expect(flipCurrentIndex).toBeGreaterThan(lockIndex)
  })

  it('the lock targets postcard_catalog scoped by key — a per-Postcard lock, never a whole-table/global lock', () => {
    const body = extractFunctionBody('admin_create_postcard_version')
    // Anchored to the actual executable `perform ... for update;`
    // statement (lowercase, matching this codebase's own SQL casing
    // convention) rather than a case-insensitive body-wide scan, which
    // would otherwise also match this same phrase inside the preceding
    // doc comment.
    const lockStart = body.indexOf('perform 1 from public.postcard_catalog')
    expect(lockStart).toBeGreaterThan(-1)
    const lockEnd = body.indexOf(';', lockStart)
    const lockStatement = body.slice(lockStart, lockEnd)
    expect(lockStatement).toContain('from public.postcard_catalog')
    expect(lockStatement).toContain('where key = v_key')
    expect(lockStatement).toMatch(/for update/i)
    expect(body).not.toMatch(/lock table/i)
  })

  it('the standing unique constraints/indexes are never weakened or dropped by this correction', () => {
    expect(sql).not.toMatch(/drop index[^;]*postcard_versions_one_current_per_key/i)
    expect(sql).not.toMatch(/drop index[^;]*postcard_versions_unique_number/i)
  })
})

describe('postcard_catalog.title stays in sync with the CURRENT version (independent review item 4)', () => {
  it('admin_create_postcard_version updates postcard_catalog.title to the new version\'s title, in the same transaction', () => {
    const body = extractFunctionBody('admin_create_postcard_version')
    expect(body).toMatch(/update public\.postcard_catalog set title = v_title where key = v_key;/)
  })

  it('the catalog title sync runs AFTER the new version is inserted, and never touches postcard_versions itself (a previous version\'s own title stays frozen)', () => {
    const body = extractFunctionBody('admin_create_postcard_version')
    const insertIndex = body.indexOf('insert into public.postcard_versions (')
    const syncIndex = body.indexOf('update public.postcard_catalog set title = v_title')
    expect(insertIndex).toBeGreaterThan(-1)
    expect(syncIndex).toBeGreaterThan(insertIndex)
  })

  it('admin_add_postcard already sets postcard_catalog.title correctly at creation (Version 1 case) — unaffected by this correction', () => {
    const body = extractFunctionBody('admin_add_postcard')
    expect(body).toContain('insert into public.postcard_catalog (key, title, country_code, is_active)')
    expect(body).toContain('values (v_key, v_title, v_country_code, true);')
  })
})

describe('PART D dependency order (independent review item 6, migration-order cleanup only)', () => {
  it('postcard_keepsake_removals is created BEFORE get_my_postcards, which queries it', () => {
    const tableIndex = sql.indexOf('create table public.postcard_keepsake_removals')
    const fnIndex = sql.indexOf('create or replace function public.get_my_postcards(')
    expect(tableIndex).toBeGreaterThan(-1)
    expect(fnIndex).toBeGreaterThan(tableIndex)
  })

  it('the RLS/policy/grants for postcard_keepsake_removals are set up BEFORE get_my_postcards is defined', () => {
    const rlsIndex = sql.indexOf('alter table public.postcard_keepsake_removals enable row level security;')
    const fnIndex = sql.indexOf('create or replace function public.get_my_postcards(')
    expect(rlsIndex).toBeGreaterThan(-1)
    expect(fnIndex).toBeGreaterThan(rlsIndex)
  })

  it('get_my_postcards is created before remove_my_postcard, matching this Part\'s documented dependency order', () => {
    const getIndex = sql.indexOf('create or replace function public.get_my_postcards(')
    const removeIndex = sql.indexOf('create or replace function public.remove_my_postcard(')
    expect(getIndex).toBeGreaterThan(-1)
    expect(removeIndex).toBeGreaterThan(getIndex)
  })

  it('this is purely an ordering cleanup — the Keepsakes product semantics (accepted rules) are unchanged', () => {
    const body = extractFunctionBody('get_my_postcards')
    expect(body).toContain('l.recipient_id = auth.uid()')
    expect(body).toContain('l.deliver_at <= now()')
    expect(body).toMatch(/not exists \(\s*select 1 from public\.postcard_keepsake_removals/)
  })
})

describe('the read-only post-apply verifier exists and is genuinely read-only', () => {
  const VERIFY_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-09-21-postcard-admin-and-keepsakes-verify.sql')
  const verifySql = readFileSync(VERIFY_PATH, 'utf8')

  it('contains no INSERT, UPDATE, DELETE, ALTER, CREATE, or DROP statement anywhere', () => {
    expect(verifySql).not.toMatch(/^\s*insert into/im)
    expect(verifySql).not.toMatch(/^\s*update\s+\S/im)
    expect(verifySql).not.toMatch(/^\s*delete from/im)
    expect(verifySql).not.toMatch(/^\s*alter\s/im)
    expect(verifySql).not.toMatch(/^\s*create\s/im)
    expect(verifySql).not.toMatch(/^\s*drop\s/im)
  })

  it('declares itself READ-ONLY ONLY and safe to run repeatedly — never a pending-apply draft (it covers a state that is already LIVE)', () => {
    expect(verifySql).toContain('READ-ONLY ONLY')
    expect(verifySql).not.toMatch(/^\s*insert\s/im)
  })

  it('checks all 18 items (the original 17 plus the corrected catalog-title-sync check), numbered 01 through 18', () => {
    for (let i = 1; i <= 18; i++) {
      const padded = String(i).padStart(2, '0')
      expect(verifySql).toContain(`'${padded}'`)
    }
  })

  // Repo Reconciliation pass, 2026-09-23 — replaces the prior brittle
  // literal ILIKE-across-pg_get_functiondef-output check, which
  // false-failed in production because of a line-break/whitespace
  // difference. The corrected check uses the exact whitespace-tolerant
  // regex proven during the original live deployment's own debugging.
  it('the catalog-title-sync check (18) uses a whitespace-tolerant POSIX regex, not a literal substring/ILIKE match', () => {
    expect(verifySql).toContain(
      "update[[:space:]]+public\\.postcard_catalog[[:space:]]+set[[:space:]]+title[[:space:]]*=[[:space:]]*v_title[[:space:]]+where[[:space:]]+key[[:space:]]*=[[:space:]]*v_key"
    )
    expect(verifySql).not.toMatch(/ilike '%update%postcard_catalog%title%v_title%'/i)
  })

  // Repo Reconciliation pass — the FOR UPDATE check (11) must anchor to
  // the executable statement, not a bare case-insensitive scan that
  // would also match the phrase inside a doc comment.
  it('the FOR UPDATE check (11) is anchored to the executable perform statement, not a bare case-insensitive "for update" scan', () => {
    const check11Start = verifySql.indexOf("'11' as check_no")
    const check11End = verifySql.indexOf('check_12 as', check11Start)
    const check11Body = verifySql.slice(check11Start, check11End)
    expect(check11Body).not.toMatch(/~\*\s*'for update'/)
    expect(check11Body).toMatch(/~\s*'perform/)
  })
})
