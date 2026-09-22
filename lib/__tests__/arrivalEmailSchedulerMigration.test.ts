// This repository cannot execute Postgres in CI, so every requirement
// that lives purely in SQL (the pg_cron/pg_net/Vault pattern, the
// idempotent unschedule-then-schedule install, the Vault-sourced
// bearer secret) is verified directly against the tracked migration
// source text — same convention as arrivalEmailQueueMigration.test.ts.
//
// Also proves, at the repo level, that native Vercel Cron is gone:
// vercel.json contained nothing but the now-unusable 5-minute cron
// declaration (the Vercel project is confirmed Hobby tier, which only
// allows once-daily schedules) and was deleted entirely rather than
// left with an empty/dead crons block.

import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'

const REPO_ROOT = path.join(__dirname, '..', '..')
const MIGRATION_PATH = path.join(REPO_ROOT, 'docs', 'sql', '2026-10-02-arrival-email-scheduler.sql')
const VERIFY_PATH = path.join(REPO_ROOT, 'docs', 'sql', '2026-10-02-arrival-email-scheduler-verify.sql')
const sql = readFileSync(MIGRATION_PATH, 'utf8')
const verifySql = readFileSync(VERIFY_PATH, 'utf8')

function stripLineComments(text: string): string {
  return text.replace(/^--.*$/gm, '')
}
const codeOnly = stripLineComments(sql)

describe('vercel.json — native Vercel Cron removed entirely', () => {
  it('vercel.json does not exist — it held nothing but the now-unusable 5-minute cron config', () => {
    expect(existsSync(path.join(REPO_ROOT, 'vercel.json'))).toBe(false)
  })

  it('no tracked file in the repo declares a Vercel "crons" block anymore', () => {
    // A narrow, deliberate scan (not a blanket grep for "cron", which
    // would false-positive on this very file and on the Supabase
    // scheduler SQL) — specifically the Vercel crons-config shape:
    // a "crons" JSON key paired with a "path" pointing at this route.
    const candidates = ['package.json', 'next.config.ts']
    for (const file of candidates) {
      const filePath = path.join(REPO_ROOT, file)
      if (!existsSync(filePath)) continue
      const content = readFileSync(filePath, 'utf8')
      expect(content).not.toMatch(/"crons"\s*:\s*\[/)
    }
  })

  it('the app directory contains no other *.json Vercel config declaring crons', () => {
    const rootEntries = readdirSync(REPO_ROOT, { withFileTypes: true })
    const jsonFiles = rootEntries.filter((e) => e.isFile() && e.name.endsWith('.json'))
    for (const entry of jsonFiles) {
      const content = readFileSync(path.join(REPO_ROOT, entry.name), 'utf8')
      expect(content).not.toMatch(/"crons"\s*:\s*\[/)
    }
  })
})

describe('arrival-email-scheduler migration — not yet applied', () => {
  it('wraps everything in exactly one begin/commit and is explicitly marked NOT EXECUTED', () => {
    expect((sql.match(/^begin;/m) ?? []).length).toBe(1)
    expect((sql.match(/^commit;/m) ?? []).length).toBe(1)
    expect(sql).toContain('STATUS: NOT EXECUTED')
    expect(sql).not.toContain('STATUS: LIVE')
  })

  it('is a separate file from, and never redefines anything in, the already-applied arrival-email-delivery migration', () => {
    expect(sql).not.toMatch(/create table public\.arrival_email_queue/)
    expect(sql).not.toMatch(/create table public\.arrival_email_preferences/)
    expect(sql).not.toMatch(/create table public\.arrival_email_system_config/)
    expect(sql).not.toMatch(/create or replace function public\.enqueue_arrival_emails/)
    expect(sql).not.toMatch(/create or replace function public\.complete_arrival_email_job/)
  })

  it('never touches the production sending kill switch', () => {
    expect(codeOnly).not.toMatch(/sending_enabled\s*=\s*true/)
    expect(codeOnly).not.toContain('set_arrival_email_sending_enabled')
  })
})

describe('extensions — pg_cron and pg_net, project-safe pattern', () => {
  it('enables pg_cron and pg_net with IF NOT EXISTS (safe to re-run, safe if already enabled via the Dashboard)', () => {
    expect(codeOnly).toContain('create extension if not exists pg_cron with schema pg_catalog')
    expect(codeOnly).toContain('create extension if not exists pg_net with schema extensions')
  })
})

describe('the scheduled job — exactly one, five-minute cadence, correct target', () => {
  it('schedules with the stable job name "tempa-arrival-emails"', () => {
    expect(codeOnly).toContain("cron.schedule(\n  'tempa-arrival-emails',")
  })

  it('the cadence is exactly */5 * * * * — five minutes, matching the Vercel Hobby-safe, per-provider-timeout-safe interval this replaces', () => {
    expect(codeOnly).toContain("'*/5 * * * *'")
  })

  it('POSTs (net.http_post, never net.http_get) to the exact production endpoint over HTTPS', () => {
    expect(codeOnly).toContain('net.http_post(')
    expect(codeOnly).toContain("url := 'https://jointempa.com/api/cron/arrival-emails'")
    expect(codeOnly).not.toContain('net.http_get(')
  })

  it('sends Content-Type: application/json alongside the Authorization header', () => {
    expect(codeOnly).toContain("'Content-Type', 'application/json'")
  })

  it('declares a bounded timeout comfortably under the Vercel Hobby 300s function ceiling', () => {
    const match = codeOnly.match(/timeout_milliseconds\s*:=\s*(\d+)/)
    expect(match).not.toBeNull()
    const timeoutMs = Number(match![1])
    expect(timeoutMs).toBeGreaterThan(0)
    expect(timeoutMs).toBeLessThan(300_000)
    // Comfortably above the app's own 10s per-provider-request timeout
    // (lib/email/provider.ts) — the batch, not a single request, needs
    // the bulk of this window.
    expect(timeoutMs).toBeGreaterThan(10_000)
  })
})

describe('bearer secret — sourced from Vault at run time, never a literal value', () => {
  it('builds the Authorization header from vault.decrypted_secrets, looked up by the stable secret name', () => {
    expect(codeOnly).toContain('vault.decrypted_secrets')
    expect(codeOnly).toContain("where name = 'tempa_arrival_email_cron_secret'")
    expect(codeOnly).toContain("'Authorization', 'Bearer ' || (")
  })

  it('never writes a vault secret VALUE — this file only ever reads by name, never calls vault.create_secret', () => {
    expect(codeOnly).not.toContain('vault.create_secret')
  })

  it('never contains anything that looks like a literal bearer token glued directly after "Bearer "', () => {
    // The correct form is `'Bearer ' || (select ...)` — a quote/paren
    // immediately follows "Bearer ", never 15+ raw token characters.
    expect(codeOnly).not.toMatch(/Bearer [A-Za-z0-9_\-.]{15,}/)
  })

  it('never selects the decrypted secret VALUE for display/return — the only "select decrypted_secret" is the inline header-building subquery itself', () => {
    // Distinguishes the actual column reference ("decrypted_secret",
    // singular — the plaintext value) from the view name
    // ("decrypted_secrets", plural), which legitimately appears more
    // than once (the Part 2 presence check, the Part 3 lookup).
    // Nothing in this file ever assigns the value to a variable,
    // RAISEs it, or returns it from a query result on its own.
    const matches = codeOnly.match(/select decrypted_secret\b/g) ?? []
    expect(matches.length).toBe(1)
  })
})

describe('idempotent install — re-running never creates a duplicate job, and never touches unrelated jobs', () => {
  it('unschedules any existing job with the exact same name before scheduling a fresh one', () => {
    expect(codeOnly).toContain("from cron.job where jobname = 'tempa-arrival-emails'")
    expect(codeOnly).toContain("cron.unschedule('tempa-arrival-emails')")
  })

  it('the unschedule check is scoped to the exact job name only — never a broader match that could catch an unrelated job', () => {
    expect(codeOnly).not.toMatch(/cron\.unschedule\(\s*select/i)
    expect(codeOnly).not.toContain('delete from cron.job')
  })
})

describe('scheduler verify file exists and targets this migration', () => {
  it('checks pg_cron/pg_net, the exact job name, its schedule, its command, and duplicate-safety', () => {
    expect(verifySql).toContain('pg_cron')
    expect(verifySql).toContain('pg_net')
    expect(verifySql).toContain('tempa-arrival-emails')
    expect(verifySql).toContain("'*/5 * * * *'")
    expect(verifySql).toContain('net.http_post')
    expect(verifySql).toContain('vault.decrypted_secrets')
    expect(verifySql).toContain('overall_pass')
  })

  it('checks for duplicate/near-duplicate Tempa arrival-email jobs, not just an exact-name count', () => {
    expect(verifySql).toContain('tempa_arrival_email_job_count')
    expect(verifySql).toMatch(/jobname ilike '%tempa%arrival%email%'/)
  })

  it('never selects a decrypted Vault secret value — only checks presence by name', () => {
    expect(verifySql).not.toMatch(/select\s+decrypted_secret\b/i)
    expect(verifySql).toContain('secret_present')
  })
})
