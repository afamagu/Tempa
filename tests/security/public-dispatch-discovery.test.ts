import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  PUBLIC_TOPIC_MIN_INDEXABLE_COUNT,
  publicTopicIsIndexable,
  publicTopicSlug,
  type PublicDispatchTopic,
} from '@/lib/public-dispatch-discovery'

const SQL = readFileSync(
  path.join(process.cwd(), 'docs', 'sql', '2026-10-28-public-dispatch-discovery.sql'),
  'utf8'
).replace(/\r\n/g, '\n')
const BODY = SQL.split('\n').map((line) => line.replace(/--.*$/, '')).join('\n')

function fn(name: string) {
  const start = BODY.indexOf(`create or replace function ${name}(`)
  expect(start, name).toBeGreaterThan(-1)
  const end = BODY.indexOf('$function$;', start)
  expect(end, `${name} terminator`).toBeGreaterThan(start)
  return BODY.slice(start, end)
}

describe('public Dispatch discovery migration', () => {
  it('is additive and transactional — it never rewrites Dispatch rows or widens table grants', () => {
    expect(BODY.trim().startsWith('begin;')).toBe(true)
    expect(BODY.trim().endsWith('commit;')).toBe(true)
    expect(BODY).not.toMatch(/\b(update|insert into|delete from|alter table|drop table|truncate)\b/i)
    expect(BODY).not.toMatch(/grant\s+(select|insert|update|delete)[^;]*on\s+public\.dispatches/i)
  })

  it('every discovery RPC is gated by the same public-web predicate', () => {
    for (const name of [
      'public.list_public_dispatch_previews',
      'public.list_related_public_dispatches',
      'public.list_public_dispatch_topics',
    ]) {
      expect(fn(name)).toContain('tempa_private.dispatch_is_web_public(d.id)')
    }
  })

  it('preview and related result contracts expose no internal Dispatch id or author id', () => {
    for (const name of ['public.list_public_dispatch_previews', 'public.list_related_public_dispatches']) {
      const code = fn(name)
      const returns = code.slice(0, code.indexOf('language'))
      expect(returns).not.toMatch(/\b(dispatch_id|author_id)\b|\bid uuid\b/i)
    }
  })

  it('bounds anonymous list sizes and makes related reading topic-based', () => {
    expect(fn('public.list_public_dispatch_previews')).toContain('limit least(greatest(coalesce(p_limit, 24), 1), 100)')
    const related = fn('public.list_related_public_dispatches')
    expect(related).toContain('limit least(greatest(coalesce(p_limit, 4), 1), 12)')
    expect(related).toContain('unnest(coalesce(p_topics')
    expect(related).toContain('shared_topic_count')
  })

  it('grants anonymous execution only on the read-only RPCs', () => {
    expect(BODY).toContain('grant execute on function public.list_public_dispatch_previews(integer, text) to anon, authenticated;')
    expect(BODY).toContain('grant execute on function public.list_related_public_dispatches(text, text[], integer) to anon, authenticated;')
    expect(BODY).toContain('grant execute on function public.list_public_dispatch_topics() to anon, authenticated;')
  })
})

describe('public topic URLs', () => {
  it('are stable across case/outer whitespace and disambiguate labels with the same readable words', () => {
    expect(publicTopicSlug(' Friendship ')).toBe(publicTopicSlug('friendship'))
    expect(publicTopicSlug('Life & Work')).not.toBe(publicTopicSlug('Life Work'))
    expect(publicTopicSlug('Life & Work')).toMatch(/^life-work-[0-9a-f]{8}$/)
  })

  it('gives non-Latin topics a stable URL-safe fallback', () => {
    expect(publicTopicSlug('友情')).toMatch(/^topic-[0-9a-f]{8}$/)
  })

  it('keeps thin topic collections out of the index until the threshold is reached', () => {
    const topic = (count: number): PublicDispatchTopic => ({
      key: 'friendship',
      label: 'Friendship',
      count,
      lastModified: '2026-09-29T00:00:00Z',
    })
    expect(PUBLIC_TOPIC_MIN_INDEXABLE_COUNT).toBe(3)
    expect(publicTopicIsIndexable(topic(2))).toBe(false)
    expect(publicTopicIsIndexable(topic(3))).toBe(true)
  })
})
