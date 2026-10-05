import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = fs.readFileSync(
  path.join(process.cwd(), 'docs/sql/2026-10-05-phase7-return-cards.sql'),
  'utf8'
)

function functionBody(name: string) {
  const start = migration.indexOf(`create or replace function public.${name}`)
  expect(start).toBeGreaterThanOrEqual(0)
  const bodyStart = migration.indexOf('as $function$', start)
  const bodyEnd = migration.indexOf('$function$;', bodyStart + 1)
  expect(bodyStart).toBeGreaterThan(start)
  expect(bodyEnd).toBeGreaterThan(bodyStart)
  return migration.slice(bodyStart, bodyEnd)
}

describe('Phase 7 Return Card database contract', () => {
  it('enforces one Return Card per source substantive letter', () => {
    expect(migration).toMatch(/source_letter_id uuid not null unique/)
  })

  it('keeps the strict rhythm edge: equality is still within rhythm', () => {
    expect(functionBody('return_card_available')).toContain(
      'now() > v_source.created_at + make_interval(days => v_days)'
    )
    expect(functionBody('send_return_card')).toContain(
      'now() <= v_source.created_at + make_interval(days => v_days)'
    )
  })

  it('requires the source to remain the latest substantive letter', () => {
    const body = functionBody('send_return_card')
    expect(body).toContain('where l.correspondence_id = v_corr.id')
    expect(body).toContain('if v_latest_id is distinct from v_source.id then')
  })

  it('cannot establish, reply to, or otherwise mutate substantive correspondence state', () => {
    const body = functionBody('send_return_card').toLowerCase()
    expect(body).not.toContain('update public.letters')
    expect(body).not.toContain('update public.correspondences')
    expect(body).not.toContain('insert into public.letters')
    expect(body).toContain('insert into public.return_cards')
  })

  it('keeps the bridge complimentary and server-authoritative', () => {
    const body = functionBody('send_return_card')
    expect(body).toContain("cp.product_type = 'postcard'")
    expect(body).toContain('cp.is_complimentary')
    expect(body).toContain("cp.lifecycle_state = 'published'")
    expect(body).toContain('tempa_private.is_correspondence_blocked_pair')
  })
})
