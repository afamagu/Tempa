import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getMyReadingLanguage, saveMyReadingLanguage } from './reading-language-data'

// A fake that behaves like the migration's RLS: SELECT returns only the
// row belonging to the session user, whatever filter the caller asks for,
// and the RPC writes only the session user's row.
function fakeSupabase(sessionUserId: string, rows: Map<string, string>) {
  const calls: Array<{ kind: string; args: unknown }> = []
  const client = {
    from(table: string) {
      calls.push({ kind: 'from', args: table })
      const filters: Record<string, unknown> = {}
      const query = {
        select: () => query,
        eq: (column: string, value: unknown) => {
          filters[column] = value
          return query
        },
        maybeSingle: async () => {
          if (table !== 'member_language_preferences') return { data: null, error: { message: 'unexpected table' } }
          const visible = filters.user_id === sessionUserId ? rows.get(sessionUserId) : undefined
          return { data: visible ? { reading_language: visible } : null, error: null }
        },
      }
      return query
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ kind: 'rpc', args: { name, ...args } })
      if (name !== 'set_my_reading_language') return { data: null, error: { message: 'unexpected rpc' } }
      rows.set(sessionUserId, String(args.p_language))
      return { data: args.p_language, error: null }
    },
  }
  return { client: client as unknown as SupabaseClient, calls }
}

const A = '00000000-0000-4000-8000-00000000000a'
const B = '00000000-0000-4000-8000-00000000000b'
let rows: Map<string, string>

beforeEach(() => {
  rows = new Map()
})

describe('Reading language — a member reads and writes only their own', () => {
  it('no row = not chosen (no default is ever invented)', async () => {
    expect(await getMyReadingLanguage(fakeSupabase(A, rows).client, A)).toEqual({ ok: true, code: null })
  })

  it('a member saves and reads back their own choice', async () => {
    const { client, calls } = fakeSupabase(A, rows)
    expect(await saveMyReadingLanguage(client, 'fr')).toEqual({ ok: true, code: 'fr' })
    expect(await getMyReadingLanguage(client, A)).toEqual({ ok: true, code: 'fr' })
    // The write carries only the language — never a user id to spoof.
    expect(calls.find((c) => c.kind === 'rpc')?.args).toEqual({ name: 'set_my_reading_language', p_language: 'fr' })
  })

  it('another member cannot read it, even by asking for that user id', async () => {
    await saveMyReadingLanguage(fakeSupabase(A, rows).client, 'fr')
    expect(await getMyReadingLanguage(fakeSupabase(B, rows).client, A)).toEqual({ ok: true, code: null })
    await saveMyReadingLanguage(fakeSupabase(B, rows).client, 'ja')
    expect(rows.get(A)).toBe('fr')
  })

  it('unsupported languages are refused before the RPC', async () => {
    const { client, calls } = fakeSupabase(A, rows)
    for (const bad of ['xx', 'tlh-Latn', '', '<script>', null]) {
      expect(await saveMyReadingLanguage(client, bad)).toEqual({ ok: false, reason: 'unsupported' })
    }
    expect(calls.filter((c) => c.kind === 'rpc')).toEqual([])
  })

  it('a stored code the registry no longer knows reads back as not chosen', async () => {
    rows.set(A, 'tlh-Latn')
    expect(await getMyReadingLanguage(fakeSupabase(A, rows).client, A)).toEqual({ ok: true, code: null })
  })

  it('a read failure is distinct from "not chosen"', async () => {
    const failing = {
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: 'x' } }) }) }) }),
    } as unknown as SupabaseClient
    expect(await getMyReadingLanguage(failing, A)).toEqual({ ok: false })
  })
})

describe('Reading language — server action', () => {
  it('derives identity from the session and passes only the code', async () => {
    vi.resetModules()
    const saved: unknown[] = []
    vi.doMock('next/cache', () => ({ revalidatePath: () => {} }))
    vi.doMock('@/lib/supabase/server', () => ({
      createClient: async () => ({
        auth: { getUser: async () => ({ data: { user: null } }) },
        rpc: async (...args: unknown[]) => {
          saved.push(args)
          return { data: null, error: null }
        },
      }),
    }))
    const { saveReadingLanguage } = await import('@/app/reading-language-actions')
    expect(await saveReadingLanguage('fr')).toEqual({ ok: false, reason: 'failed' })
    expect(saved).toEqual([])
    expect(saveReadingLanguage.length).toBe(1)
    vi.doUnmock('@/lib/supabase/server')
    vi.doUnmock('next/cache')
  })
})

describe('Reading language — SQL contract (docs/sql/2026-09-30-reading-language.sql)', () => {
  const sql = readFileSync(path.join(__dirname, '..', 'docs', 'sql', '2026-09-30-reading-language.sql'), 'utf8')
  const verify = readFileSync(path.join(__dirname, '..', 'docs', 'sql', '2026-09-30-reading-language-verify.sql'), 'utf8')
  const code = sql.replace(/--.*$/gm, '')

  it('is marked NOT EXECUTED, as is its verifier', () => {
    expect(sql).toMatch(/STATUS: NOT EXECUTED/)
    expect(verify).toMatch(/STATUS: NOT EXECUTED/)
    expect(verify.trimEnd()).toMatch(/rollback;[\s\S]*$/)
  })

  it('a private table, own-row SELECT only, no direct client writes, no anon', () => {
    expect(code).toContain('create table if not exists public.member_language_preferences')
    expect(code).toContain('enable row level security')
    expect(code).toContain('revoke all on public.member_language_preferences from public, anon, authenticated')
    expect(code).toContain('grant select on public.member_language_preferences to authenticated')
    expect(code).toMatch(/for select\s+to authenticated\s+using \(auth\.uid\(\) = user_id\)/)
    expect(code).not.toMatch(/grant (insert|update|delete|all)[^;]*member_language_preferences/i)
    expect(code).not.toMatch(/to anon/i)
  })

  it('the only write path is keyed on auth.uid() with no user-id parameter', () => {
    expect(code).toContain('create or replace function public.set_my_reading_language(p_language text)')
    expect(code).toMatch(/security definer\s+set search_path to 'pg_catalog'/)
    expect(code).toContain('values (auth.uid(), v_language')
    expect(code).toContain('revoke all on function public.set_my_reading_language(text) from public, anon')
  })

  it('never touches profiles/public_profiles, and closes with the account via FK cascade', () => {
    expect(code).not.toMatch(/alter table public\.profiles|public_profiles/)
    expect(code).toContain('references public.profiles(id) on delete cascade')
    expect(code).not.toMatch(/interface_locale/)
  })
})
