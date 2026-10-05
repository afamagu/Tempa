import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = fs.readFileSync(
  path.join(process.cwd(), 'docs/sql/2026-10-06-phase9-pause-resume-end.sql'),
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

describe('Phase 9 pause / resume / end contract', () => {
  it('adds paused as a durable correspondence state and keeps it open per pair', () => {
    expect(migration).toContain("status in ('pending', 'active', 'paused', 'closed')")
    expect(migration).toContain("where status in ('pending', 'active', 'paused')")
  })

  it('pause is unilateral and releases the active chair', () => {
    const pause = functionBody('pause_correspondence')
    expect(pause).toContain("status = 'paused'")
    expect(pause).toContain('paused_by = auth.uid()')
    expect(migration).toContain("relationship_capacity_state(uuid)")
    expect(migration).toContain("like '%c.status = ''active''%' as paused_releases_capacity")
  })

  it('resume is mutual and capacity checked for both participants', () => {
    const respond = functionBody('respond_resume_correspondence')
    expect(respond).toContain('resume_requested_by = auth.uid()')
    expect(respond).toContain('lock_relationship_capacity_pair')
    expect(respond).toContain('relationship_capacity_state(v_corr.participant_low)')
    expect(respond).toContain('relationship_capacity_state(v_corr.participant_high)')
    expect(respond).toContain("status = 'active'")
  })

  it('ending is terminal for the current episode and preserves letters', () => {
    const end = functionBody('end_correspondence')
    expect(end).toContain("status = 'closed'")
    expect(end).toContain('ended_by = auth.uid()')
    expect(end).not.toContain('delete from public.letters')
    expect(end).not.toContain('update public.letters')
  })

  it('paused relationships remain excluded from discovery and new first contact', () => {
    expect(migration).toContain("where c.status in (''pending'', ''active'', ''paused'')")
    expect(migration).toContain("array[''pending''::text, ''active''::text, ''paused''::text]")
  })

  it('existing active-only reminder and writing gates fail closed for paused state', () => {
    expect(migration).toContain("paused_suppresses_in_product_reminders")
    expect(migration).toContain("paused_suppresses_reminder_email_jobs")
    expect(migration).not.toContain('create or replace function public.write_letter')
  })
})
