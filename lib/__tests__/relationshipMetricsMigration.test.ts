import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const MIGRATION_PATH = path.join(
  __dirname,
  '..',
  '..',
  'docs',
  'sql',
  '2026-10-04-phase1-relationship-metrics.sql'
)
const VERIFY_PATH = path.join(
  __dirname,
  '..',
  '..',
  'docs',
  'sql',
  '2026-10-04-phase1-relationship-metrics-verify.sql'
)

const sql = readFileSync(MIGRATION_PATH, 'utf8')
const verifySql = readFileSync(VERIFY_PATH, 'utf8')

function stripLineComments(text: string): string {
  return text.replace(/^\s*--.*$/gm, '')
}

function extractFunctionBody(qualifiedName: string): string {
  const start = sql.indexOf(`create or replace function ${qualifiedName}(`)
  expect(start, `expected ${qualifiedName} in ${MIGRATION_PATH}`).toBeGreaterThan(-1)
  const end = sql.indexOf('$function$;', start)
  expect(end, `expected closing $function$ for ${qualifiedName}`).toBeGreaterThan(start)
  return sql.slice(start, end)
}

const codeOnly = stripLineComments(sql)

describe('Phase 1 relationship-health measurement migration', () => {
  it('is one forward transaction and is explicitly review-before-production', () => {
    expect((sql.match(/^begin;/gm) ?? []).length).toBe(1)
    expect((sql.match(/^commit;/gm) ?? []).length).toBe(1)
    expect(sql).toContain('PREPARED 2026-10-04. REVIEW BEFORE PRODUCTION EXECUTION.')
  })

  it('requires the canonical Phase 1 capacity state instead of inventing another capacity definition', () => {
    expect(codeOnly).toContain(
      "to_regprocedure('tempa_private.relationship_capacity_state(uuid)') is null"
    )
    const capture = extractFunctionBody(
      'tempa_private.capture_relationship_establishment_snapshot'
    )
    expect(capture).toContain(
      'from tempa_private.relationship_capacity_state(v_user_id)'
    )
  })

  it('stores metadata-only establishment snapshots for both participants', () => {
    expect(codeOnly).toContain(
      'create table if not exists public.relationship_establishment_snapshots'
    )
    for (const field of [
      'correspondence_id',
      'user_id',
      'counterpart_id',
      'established_at',
      'active_limit_at_establishment',
      'established_count_at_establishment',
      'outgoing_pending_count_at_establishment',
      'incoming_pending_count_at_establishment',
      'committed_count_at_establishment',
    ]) {
      expect(codeOnly).toContain(field)
    }

    const capture = extractFunctionBody(
      'tempa_private.capture_relationship_establishment_snapshot'
    )
    expect(capture).toContain(
      'foreach v_user_id in array array[new.participant_low, new.participant_high]'
    )
    expect(capture).toContain('v_counterpart_id := case')
  })

  it('never copies private letter content into the snapshot table', () => {
    const tableStart = codeOnly.indexOf(
      'create table if not exists public.relationship_establishment_snapshots'
    )
    const tableEnd = codeOnly.indexOf(');', tableStart)
    const tableDefinition = codeOnly.slice(tableStart, tableEnd)

    expect(tableDefinition).not.toMatch(/\bbody\b/)
    expect(tableDefinition).not.toMatch(/\bmoment\b/i)
    expect(tableDefinition).not.toMatch(/\bpostcard\b/i)
    expect(tableDefinition).not.toMatch(/\bnote\b/i)
  })

  it('keeps the snapshot table private from client roles', () => {
    expect(codeOnly).toContain(
      'alter table public.relationship_establishment_snapshots enable row level security;'
    )
    expect(codeOnly).toContain(
      'revoke all on table public.relationship_establishment_snapshots from public, anon, authenticated;'
    )
    expect(codeOnly).toContain(
      'grant select on table public.relationship_establishment_snapshots to service_role;'
    )
  })

  it('captures only the pending-to-active establishment transition and deliberately does not backfill old relationships', () => {
    const capture = extractFunctionBody(
      'tempa_private.capture_relationship_establishment_snapshot'
    )
    expect(capture).toContain("old.status = 'pending'")
    expect(capture).toContain('old.established_at is null')
    expect(capture).toContain("new.status = 'active'")
    expect(capture).toContain('new.established_at is not null')

    expect(codeOnly).toContain(
      'create trigger correspondences_capture_relationship_establishment_snapshot'
    )
    expect(codeOnly).toContain(
      'after update of status, established_at on public.correspondences'
    )

    // There must be no general INSERT...SELECT backfill into snapshots.
    const snapshotInsertSelect = /insert\s+into\s+public\.relationship_establishment_snapshots[\s\S]*?select\s+/i
    expect(codeOnly).not.toMatch(snapshotInsertSelect)
  })

  it('collapses consecutive same-sender letters into turns rather than inflating reciprocity with raw letter count', () => {
    const metrics = extractFunctionBody('public.get_relationship_pilot_metrics')
    expect(metrics).toContain('lag(l.sender_id) over')
    expect(metrics).toContain('previous_sender_id is distinct from o.sender_id')
    expect(metrics).toContain('starts_new_turn')
    expect(metrics).toContain('sum(m.starts_new_turn) over')
    expect(metrics).toContain('turn_number')
  })

  it('reports third/fifth turn progression, 30-day activity, chair bands and reciprocity ratio', () => {
    const metrics = extractFunctionBody('public.get_relationship_pilot_metrics')

    expect(metrics).toContain('min(t.turn_at) filter (where t.turn_number = 3) as third_turn_at')
    expect(metrics).toContain('min(t.turn_at) filter (where t.turn_number = 5) as fifth_turn_at')
    expect(metrics).toContain("s.established_at + interval '30 days'")
    expect(metrics).toContain("then '1-3'")
    expect(metrics).toContain("then '4-5'")
    expect(metrics).toContain("then '6-10'")
    expect(metrics).toContain("else '11+'")
    expect(metrics).toContain('least(coalesce(m.user_turns, 0), coalesce(m.counterpart_turns, 0))')
    expect(metrics).toContain('greatest(coalesce(m.user_turns, 0), coalesce(m.counterpart_turns, 0))')
  })

  it('keeps pilot metric reports service-only', () => {
    expect(codeOnly).toContain(
      'revoke all on function public.get_relationship_pilot_metrics() from public, anon, authenticated;'
    )
    expect(codeOnly).toContain(
      'grant execute on function public.get_relationship_pilot_metrics() to service_role;'
    )
    expect(codeOnly).toContain(
      'revoke all on function public.get_relationship_first_contact_funnel(timestamptz) from public, anon, authenticated;'
    )
    expect(codeOnly).toContain(
      'grant execute on function public.get_relationship_first_contact_funnel(timestamptz) to service_role;'
    )
  })

  it('counts first-contact outcomes by correspondence episode, so crossed roots cannot double-count an attempt', () => {
    const funnel = extractFunctionBody('public.get_relationship_first_contact_funnel')
    expect(funnel).toContain('c.id as correspondence_id')
    expect(funnel).toContain('group by c.id, c.status, c.established_at')
    expect(funnel).toContain("when e.established_at is not null then 'established'")
    expect(funnel).toContain("when e.recipient_passed then 'passed'")
    expect(funnel).toContain("then 'unanswered'")
    expect(funnel).toContain("else 'pending'")
  })
})

describe('Phase 1 relationship-health verifier', () => {
  it('is read-only and ends with overall_pass', () => {
    const verifyCode = stripLineComments(verifySql).toLowerCase()
    expect(verifyCode).not.toMatch(/\binsert\s+into\b/)
    expect(verifyCode).not.toMatch(/\bupdate\s+public\./)
    expect(verifyCode).not.toMatch(/\bdelete\s+from\b/)
    expect(verifyCode).not.toMatch(/\bdrop\s+(table|function|trigger|index)\b/)
    expect(verifyCode).not.toMatch(/\bcreate\s+(table|function|trigger|index)\b/)
    expect(verifySql).toContain('overall_pass')
  })

  it('checks the snapshot, trigger, metrics RPC, funnel RPC, RLS and service-only grants', () => {
    for (const required of [
      'relationship_establishment_snapshots',
      'capture_relationship_establishment_snapshot',
      'correspondences_capture_relationship_establishment_snapshot',
      'get_relationship_pilot_metrics',
      'get_relationship_first_contact_funnel',
      'relrowsecurity',
      'service_role',
      'overall_pass',
    ]) {
      expect(verifySql).toContain(required)
    }
  })
})
