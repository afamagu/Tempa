import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const MIGRATION_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-09-29-your-mark-production.sql')
const VERIFY_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-09-29-your-mark-production-verify.sql')
const sql = readFileSync(MIGRATION_PATH, 'utf8')
const verifySql = readFileSync(VERIFY_PATH, 'utf8')
const lower = sql.toLowerCase()

describe('Your Mark migration — durable state and profile privilege boundary', () => {
  it('grandfathers existing profiles but forces every future insert to mark', () => {
    expect(lower).toContain("add column onboarding_stage text not null default 'complete'")
    expect(lower).toContain("new.onboarding_stage := 'mark'")
    expect(lower).toContain('new.mark_id := null')
    expect(lower).toContain('security invoker')
  })

  it('gives authenticated no direct profiles UPDATE grant', () => {
    expect(lower).toContain('revoke update on table public.profiles from anon, authenticated')
    expect(lower).not.toMatch(/grant\s+update(?:\s*\([^)]*\))?\s+on(?:\s+table)?\s+public\.profiles\s+to\s+authenticated/i)
    expect(lower).not.toContain('string_agg(format')
    expect(lower).toContain("has_table_privilege('authenticated', 'public.profiles', 'update')")
    expect(lower).toContain("cp.privilege_type = 'update'")
  })

  it('does not recreate the documented-live Flagship index and requires all four readiness flags', () => {
    expect(lower).not.toMatch(/create\s+unique\s+index(?:\s+if\s+not\s+exists)?\s+questions_is_flagship_unique/i)
    for (const flag of ['indisunique', 'indisvalid', 'indisready', 'indislive']) {
      expect(lower).toContain(flag)
    }
    expect(lower).toContain("c.relname = 'questions_is_flagship_unique'")
    expect(lower).toContain("<> 'is_flagship=true'")
  })

  it('validates the live Flagship prerequisite before the first Your Mark schema mutation', () => {
    const firstTransaction = lower.indexOf('begin;')
    const prerequisiteFailure = lower.indexOf(
      "raise exception 'verify failed: live questions_is_flagship_unique prerequisite is absent or malformed.'"
    )
    const prerequisiteEnd = lower.indexOf('$flagship_prerequisite$;', prerequisiteFailure)
    const firstSchemaMutation = lower.indexOf('alter table public.profiles')

    expect(firstTransaction).toBeGreaterThan(-1)
    expect(prerequisiteFailure).toBeGreaterThan(firstTransaction)
    expect(prerequisiteEnd).toBeGreaterThan(prerequisiteFailure)
    expect(prerequisiteEnd).toBeLessThan(firstSchemaMutation)
  })
})
describe('Your Mark migration — opaque ownership and deterministic recovery', () => {
  it('allows one pending and one active Mark per owner', () => {
    expect(lower).toContain('create unique index profile_marks_one_pending_per_owner')
    expect(lower).toContain("where status = 'pending'")
    expect(lower).toContain('create unique index profile_marks_one_active_per_owner')
    expect(lower).toContain("where status = 'active'")
  })

  it('uses only a flat opaque UUID.png key and never an owner-id folder', () => {
    expect(lower).toContain("v_object_name := v_mark.id::text || '.png'")
    expect(lower).not.toContain("auth.uid()::text || '/'")
    expect(lower).not.toContain("owner_id::text || '/'")
  })

  it('makes upload owner/pending-scoped and finalization owner-only and idempotent', () => {
    expect(lower).toContain('pm.owner_id = auth.uid()')
    expect(lower).toContain("pm.status = 'pending'")
    expect(lower).toContain("v_mark.status = 'active' and v_profile.mark_id = v_mark.id")
    expect(lower).toContain("so.bucket_id = 'profile-marks'")
  })

  it('uses a public PNG-only 1 MiB bucket with no UPDATE policy', () => {
    expect(lower).toContain("values ('profile-marks', 'profile-marks', true, 1048576, array['image/png'])")
    expect(lower).not.toMatch(/create\s+policy\s+profile_marks_update/i)
    expect(lower).toContain('no update policy')
  })

  it('never introduces source-photo persistence vocabulary or an algorithm change', () => {
    expect(lower).not.toMatch(/source_(photo|image)\s+(bytea|blob|text)/i)
    expect(lower).not.toContain('generatemarkv2')
    expect(lower).not.toContain('generateMarkV3'.toLowerCase())
  })
})

describe('Your Mark migration — onboarding and public exposure', () => {
  it('advances mark to question only in validated finalization', () => {
    const start = lower.indexOf('create or replace function public.finalize_profile_mark')
    const end = lower.indexOf('create or replace function public.complete_flagship_onboarding', start)
    const body = lower.slice(start, end)
    expect(body).toContain("when onboarding_stage = 'mark' then 'question'")
    expect(body).toContain("where pm.id = p_mark_id and pm.owner_id = auth.uid()")
    expect(body).toContain("so.bucket_id = 'profile-marks'")
  })

  it('atomically completes question onboarding only for the Flagship', () => {
    const start = lower.indexOf('create or replace function public.publish_question_answer')
    const end = lower.indexOf('do $verification$', start)
    const body = lower.slice(start, end)
    expect(body).toContain('q.is_flagship = true')
    expect(body).toContain("onboarding_stage = 'complete'")
    expect(body).toContain("onboarding_stage = 'question'")
  })

  it('adds only mark_id to the audited block-aware public profile shape', () => {
    const start = lower.indexOf('create or replace view public.public_profiles')
    const end = lower.indexOf('create or replace function public.publish_question_answer', start)
    const view = lower.slice(start, end)
    expect(view).toContain('p.mark_id')
    expect(view).toContain('tempa_private.is_blocked_pair')
    expect(view).not.toContain('owner_id')
    expect(view).not.toContain('onboarding_stage')
  })
})

describe('Your Mark verifier — read-only and complete', () => {
  it('contains no mutating SQL', () => {
    expect(verifySql).not.toMatch(/^\s*(insert|update|delete|alter|create|drop|grant|revoke|truncate)\b/im)
  })

  it('checks all Flagship readiness flags and the exact predicate', () => {
    for (const flag of ['indisunique', 'indisvalid', 'indisready', 'indislive']) {
      expect(verifySql.toLowerCase()).toContain(flag)
    }
    expect(verifySql.toLowerCase()).toContain("= 'is_flagship=true'")
  })

  it('checks privileges, private state, bucket, policies, RPCs and atomic completion', () => {
    for (const marker of [
      'profile_update_boundary_ok',
      'private_ownership_table_ok',
      'public_profiles_ok',
      'bucket_ok',
      'storage_policies_ok',
      'mark_rpcs_ok',
      'flagship_completion_ok',
    ]) {
      expect(verifySql).toContain(marker)
    }
  })
})
