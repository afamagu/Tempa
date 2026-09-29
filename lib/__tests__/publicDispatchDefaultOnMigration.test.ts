import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const DIR = path.join(__dirname, '..', '..', 'docs', 'sql')
const sql = readFileSync(path.join(DIR, '2026-10-29-public-dispatch-default-on-and-mark.sql'), 'utf8').replace(/\r\n/g, '\n')
const body = sql.split('\n').map((line) => line.replace(/--.*$/, '')).join('\n')

function fn(name: string) {
  const start = body.indexOf(`create or replace function ${name}(`)
  expect(start, name).toBeGreaterThan(-1)
  const end = body.indexOf('$function$;', start)
  expect(end, `${name} end`).toBeGreaterThan(start)
  return body.slice(start, end)
}

describe('2026-10-29 public Dispatch default-on + Mark', () => {
  it('is transactional and never backfills existing Dispatch visibility', () => {
    expect(body.trim().startsWith('begin;')).toBe(true)
    expect(body.trim().endsWith('commit;')).toBe(true)
    expect(body).not.toMatch(/update\s+public\.dispatches\s+set\s+web_public\s*=\s*true/i)
  })

  it('defaults only the explicit atomic member publish wrapper to public', () => {
    const publish = fn('public.publish_dispatch_with_web_visibility')
    expect(publish).toContain('p_web_public boolean default true')
    expect(publish).toContain('public.publish_dispatch(')
    expect(publish).toContain('tempa_private.apply_dispatch_web_public(d.id, true)')
    expect(body).not.toMatch(/alter table public\.dispatches[^;]*web_public[^;]*default true/i)
  })

  it('returns only the opaque Mark UUID after the same public-web gate', () => {
    const mark = fn('public.get_public_dispatch_mark')
    expect(mark).toContain('returns uuid')
    expect(mark).toContain("d.published_as = 'member'")
    expect(mark).toContain('tempa_private.dispatch_is_web_public(v_dispatch_id)')
    expect(mark).toContain('select p.mark_id into v_mark_id')
    expect(mark).not.toMatch(/returns table/i)
  })

  it('lets anonymous readers call only the gated Mark resolver, not the member publish wrapper', () => {
    expect(body).toContain('grant execute on function public.get_public_dispatch_mark(text) to anon, authenticated;')
    expect(body).toContain('revoke all on function public.publish_dispatch_with_web_visibility(text, text, uuid, text[], jsonb, jsonb, boolean, boolean)')
    expect(body).toContain('from public, anon;')
  })
})
