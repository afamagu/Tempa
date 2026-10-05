import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const migration = fs.readFileSync(
  path.join(process.cwd(), 'docs/sql/2026-10-05-phase8-gentle-reply-reminders.sql'),
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

function executableSql(body: string) {
  return body
    .split('\n')
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
    .toLowerCase()
}

describe('Phase 8 gentle reply reminder database contract', () => {
  it('is explicit opt-in and permits only one reminder episode per source letter', () => {
    expect(migration).toContain('reminders_enabled boolean not null default false')
    expect(migration).toContain('email_enabled boolean not null default false')
    expect(migration).toMatch(/source_letter_id uuid not null unique/)
  })

  it('starts the provider kill switch off', () => {
    expect(migration).toContain('sending_enabled boolean not null default false')
    expect(migration).toContain('values (true, false)')
  })

  it('keeps the same strict rhythm edge as the relationship surface', () => {
    const enqueue = functionBody('enqueue_reply_reminders')
    expect(enqueue).toContain('now() > e.created_at + make_interval(')
    const context = functionBody('resolve_reply_reminder_email_context')
    expect(context).toContain('now() <= v_source.created_at + make_interval(')
  })

  it('suppresses an episode after a Return Card', () => {
    expect(functionBody('enqueue_reply_reminders')).toContain('public.return_cards')
    expect(functionBody('get_my_reply_reminders')).toContain('public.return_cards')
    expect(functionBody('claim_reply_reminder_email_jobs')).toContain("'return_card_sent'")
    expect(functionBody('resolve_reply_reminder_email_context')).toContain('public.return_cards')
  })

  it('does not mutate substantive Letter or correspondence state', () => {
    for (const name of [
      'enqueue_reply_reminders',
      'get_my_reply_reminders',
      'claim_reply_reminder_email_jobs',
      'resolve_reply_reminder_email_context',
      'record_or_fetch_reply_reminder_email_snapshot',
      'complete_reply_reminder_email_job',
    ]) {
      const body = executableSql(functionBody(name))
      expect(body).not.toContain('insert into public.letters')
      expect(body).not.toContain('update public.letters')
      expect(body).not.toContain('update public.correspondences')
    }
  })

  it('revalidates live relationship and safety state before a provider send', () => {
    const context = functionBody('resolve_reply_reminder_email_context')
    expect(context).toContain("v_corr.status <> 'active'")
    expect(context).toContain('v_corr.established_at is null')
    expect(context).toContain('tempa_private.is_correspondence_blocked_pair')
    expect(context).toContain('public.account_deactivations')
    expect(context).toContain('public.account_closures')
  })
})
