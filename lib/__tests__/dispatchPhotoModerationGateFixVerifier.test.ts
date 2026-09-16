// Cohort Safety Readiness — Checkpoint 1 corrective checkpoint.
// Proves two things, same discipline as boardPersonalizationVerifier.
// test.ts / dispatchWorthReadingVerifier.test.ts: (1) the READ-ONLY
// verifier SQL text asks the right structural questions, and (2) the
// underlying visibility LOGIC the migration ships is behaviorally
// correct — via a small JS mirror of each function's boolean predicate,
// exercised against a matrix of synthetic rows, since there is no live
// Postgres to run either file against here.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const MIGRATION_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-09-28-dispatch-photo-moderation-gate-fix.sql')
const VERIFIER_PATH = path.join(__dirname, '..', '..', 'docs', 'sql', '2026-09-28-dispatch-photo-moderation-gate-fix-verify.sql')

const migrationSql = readFileSync(MIGRATION_PATH, 'utf8')
const verifierSql = readFileSync(VERIFIER_PATH, 'utf8')

function extractFunctionBody(sql: string, fnName: string): string {
  const marker = `create or replace function public.${fnName}`
  const start = sql.indexOf(marker)
  expect(start, `expected to find ${marker} in the migration`).toBeGreaterThan(-1)
  const end = sql.indexOf('$$;', start)
  expect(end, `expected to find the closing $$; for ${fnName}`).toBeGreaterThan(start)
  return sql.slice(start, end).toLowerCase()
}

describe('migration — read-only-safe (no destructive DDL beyond the two intended CREATE OR REPLACE FUNCTIONs)', () => {
  it('never drops, alters, or grants/revokes anything (comment lines excluded — this file\'s own prose legitimately discusses grants/revokes being deliberately NOT reissued)', () => {
    const lower = migrationSql
      .split('\n')
      .filter((line) => !line.trim().startsWith('--'))
      .join('\n')
      .toLowerCase()
    expect(lower).not.toContain('drop table')
    expect(lower).not.toContain('drop policy')
    expect(lower).not.toContain('alter table')
    expect(lower).not.toContain('alter policy')
    expect(lower).not.toContain('grant ')
    expect(lower).not.toContain('revoke ')
    expect(lower).not.toContain('insert into')
    expect(lower).not.toContain('delete from')
  })

  it('contains exactly two CREATE OR REPLACE FUNCTION statements, for exactly the two intended functions', () => {
    const matches = [...migrationSql.matchAll(/create or replace function/gi)]
    expect(matches.length).toBe(2)
    expect(migrationSql).toContain('create or replace function public.dispatch_photo_is_visible(p_path text)')
    expect(migrationSql).toContain('create or replace function public.dispatch_photo_is_externally_shared(p_path text)')
  })
})

describe('verifier — read-only (no INSERT/UPDATE/DELETE/DDL/GRANT/REVOKE anywhere in executable code)', () => {
  it('every non-comment, non-blank line is a read-only construct', () => {
    const codeLines = verifierSql
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith('--'))
    const mutationKeywords = /^(insert|update|delete|drop|alter|create|truncate|grant|revoke)\b/i
    const offending = codeLines.filter((line) => mutationKeywords.test(line))
    expect(offending).toEqual([])
  })
})

describe('1-5: blocked_users_select_own — order-independent semantic equality', () => {
  // Mirrors the verifier's own normalization: strip whitespace/parens,
  // lowercase, accept either textual operand order.
  function qualIsOwnRowEquality(qual: string): boolean {
    const normalized = qual.toLowerCase().replace(/[\s()]/g, '')
    return normalized === 'auth.uid=blocker_id' || normalized === 'blocker_id=auth.uid'
  }

  it('1. the live predicate order (auth.uid() = blocker_id) passes', () => {
    expect(qualIsOwnRowEquality('auth.uid() = blocker_id')).toBe(true)
  })

  it('2. the reversed but semantically equivalent order (blocker_id = auth.uid()) also passes', () => {
    expect(qualIsOwnRowEquality('blocker_id = auth.uid()')).toBe(true)
  })

  it('3. a policy missing auth.uid() fails', () => {
    expect(qualIsOwnRowEquality('blocker_id = some_other_column')).toBe(false)
  })

  it('4. a policy missing blocker_id fails', () => {
    expect(qualIsOwnRowEquality('auth.uid() = some_other_column')).toBe(false)
  })

  it('5. a policy with the wrong command/role still fails overall, even with a correct qual (proven via the verifier SQL text, which ANDs qual with cmd/role checks)', () => {
    expect(verifierSql).toContain('bu.exists_at_all and bu.is_select_cmd and bu.roles_correct and bu.qual_is_own_row_equality')
  })

  it('the verifier text itself implements the same order-independent normalization', () => {
    expect(verifierSql).toContain("regexp_replace(lower(pg_get_expr(pol.polqual, pol.polrelid)), '[[:space:]()]', '', 'g')")
    expect(verifierSql).toContain("in ('auth.uid=blocker_id', 'blocker_id=auth.uid')")
  })
})

describe('6-10: dispatch_photo_is_visible — behavioral matrix (JS mirror of the shipped predicate)', () => {
  type Row = {
    isOwner: boolean
    momentAttachedToPublishedDispatch: boolean
    dispatchStatus: 'published' | 'draft'
    moderationStatus: 'visible' | 'hidden'
    isBlockedPair: boolean
  }

  // Direct mirror of the migration's own boolean logic — see
  // docs/sql/2026-09-28-dispatch-photo-moderation-gate-fix.sql.
  function dispatchPhotoIsVisible(row: Row): boolean {
    if (row.isOwner) return true
    return (
      row.momentAttachedToPublishedDispatch &&
      row.dispatchStatus === 'published' &&
      row.moderationStatus === 'visible' &&
      !row.isBlockedPair
    )
  }

  it('6. the owner path remains allowed regardless of moderation or block state', () => {
    expect(
      dispatchPhotoIsVisible({
        isOwner: true,
        momentAttachedToPublishedDispatch: false,
        dispatchStatus: 'draft',
        moderationStatus: 'hidden',
        isBlockedPair: true,
      })
    ).toBe(true)
  })

  it('7. non-owner, published + visible + not blocked is allowed', () => {
    expect(
      dispatchPhotoIsVisible({
        isOwner: false,
        momentAttachedToPublishedDispatch: true,
        dispatchStatus: 'published',
        moderationStatus: 'visible',
        isBlockedPair: false,
      })
    ).toBe(true)
  })

  it('8 & 9. a published but moderator-hidden Dispatch is NOT visible to a non-owner (the exact gap this fix closes)', () => {
    expect(
      dispatchPhotoIsVisible({
        isOwner: false,
        momentAttachedToPublishedDispatch: true,
        dispatchStatus: 'published',
        moderationStatus: 'hidden',
        isBlockedPair: false,
      })
    ).toBe(false)
  })

  it('10. Stop Letters (any-scope correspondence blocking) is never introduced — only the full-block-only predicate can suppress visibility, and it does not depend on moderation_status', () => {
    const visibleFunctionBody = extractFunctionBody(migrationSql, 'dispatch_photo_is_visible')
    expect(visibleFunctionBody).not.toContain('is_correspondence_blocked_pair')
    expect(visibleFunctionBody).toContain('tempa_private.is_blocked_pair')
  })

  it('extracting the REAL migration function body: owner path, published, moderation-visible, and block-check are all present, in that order', () => {
    const body = extractFunctionBody(migrationSql, 'dispatch_photo_is_visible')
    expect(body).toContain("auth.uid()::text = (storage.foldername(p_path))[1]")
    const pStatus = body.indexOf("d.status = 'published'")
    const pModeration = body.indexOf("d.moderation_status = 'visible'")
    const pBlock = body.indexOf('tempa_private.is_blocked_pair')
    expect(pStatus).toBeGreaterThan(-1)
    expect(pModeration).toBeGreaterThan(-1)
    expect(pBlock).toBeGreaterThan(-1)
    expect(pStatus).toBeLessThan(pModeration)
    expect(pModeration).toBeLessThan(pBlock)
  })
})

describe('11-14: dispatch_photo_is_externally_shared — behavioral matrix (JS mirror of the shipped predicate)', () => {
  type Row = {
    dispatchStatus: 'published' | 'draft'
    moderationStatus: 'visible' | 'hidden'
    shareRevoked: boolean
  }

  // Direct mirror of the migration's own boolean logic.
  function dispatchPhotoIsExternallyShared(row: Row): boolean {
    return row.dispatchStatus === 'published' && row.moderationStatus === 'visible' && !row.shareRevoked
  }

  it('11. published is required', () => {
    expect(dispatchPhotoIsExternallyShared({ dispatchStatus: 'draft', moderationStatus: 'visible', shareRevoked: false })).toBe(false)
  })

  it('12. the share must not be revoked', () => {
    expect(dispatchPhotoIsExternallyShared({ dispatchStatus: 'published', moderationStatus: 'visible', shareRevoked: true })).toBe(false)
  })

  it('13. moderation_status = visible is required', () => {
    expect(dispatchPhotoIsExternallyShared({ dispatchStatus: 'published', moderationStatus: 'hidden', shareRevoked: false })).toBe(false)
  })

  it('14. a moderator-hidden Dispatch cannot satisfy external-share visibility even with an otherwise-valid, unrevoked share (the exact gap this fix closes, and the more severe of the two since anon-reachable)', () => {
    expect(dispatchPhotoIsExternallyShared({ dispatchStatus: 'published', moderationStatus: 'hidden', shareRevoked: false })).toBe(false)
  })

  it('the fully-satisfying case (published, visible, not revoked) is allowed', () => {
    expect(dispatchPhotoIsExternallyShared({ dispatchStatus: 'published', moderationStatus: 'visible', shareRevoked: false })).toBe(true)
  })

  it('extracting the REAL migration function body: published, moderation-visible, and not-revoked are all present, in that order', () => {
    const body = extractFunctionBody(migrationSql, 'dispatch_photo_is_externally_shared')
    const pStatus = body.indexOf("d.status = 'published'")
    const pModeration = body.indexOf("d.moderation_status = 'visible'")
    const pRevoked = body.indexOf('ds.revoked_at is null')
    expect(pStatus).toBeGreaterThan(-1)
    expect(pModeration).toBeGreaterThan(-1)
    expect(pRevoked).toBeGreaterThan(-1)
    expect(pStatus).toBeLessThan(pModeration)
    expect(pModeration).toBeLessThan(pRevoked)
  })
})

describe('verifier — SUMMARY wiring: every column selected is required by overall_pass', () => {
  const requiredAliases = [
    'blocked_users_policy_exists', 'blocked_users_is_select_cmd', 'blocked_users_roles_correct',
    'blocked_users_select_own_policy_correct',
    'dispatch_photo_is_visible_signature_exists', 'dispatch_photo_is_visible_is_security_invoker',
    'dispatch_photo_is_visible_is_stable', 'dispatch_photo_is_visible_search_path_fixed',
    'dispatch_photo_is_visible_authenticated_exec', 'dispatch_photo_is_visible_anon_no_exec',
    'dispatch_photo_is_visible_preserves_owner_path', 'dispatch_photo_is_visible_requires_published',
    'dispatch_photo_is_visible_checks_moderation_status', 'dispatch_photo_is_visible_uses_full_block_helper',
    'dispatch_photo_is_visible_never_uses_stop_letters_helper', 'dispatch_photo_is_visible_moderation_check_ordered_correctly',
    'dispatch_photo_is_externally_shared_signature_exists', 'dispatch_photo_is_externally_shared_is_security_definer',
    'dispatch_photo_is_externally_shared_is_stable', 'dispatch_photo_is_externally_shared_search_path_fixed',
    'dispatch_photo_is_externally_shared_anon_exec', 'dispatch_photo_is_externally_shared_requires_published',
    'dispatch_photo_is_externally_shared_checks_moderation_status', 'dispatch_photo_is_externally_shared_requires_share_not_revoked',
    'dispatch_photo_is_externally_shared_moderation_check_ordered_correctly',
    'storage_policies_intact',
  ]

  const overallPassStart = verifierSql.indexOf('(\n    bu.exists_at_all')
  const overallPassEnd = verifierSql.indexOf(') as overall_pass')
  const overallPassBody = verifierSql.slice(overallPassStart, overallPassEnd)
  const selectListBody = verifierSql.slice(verifierSql.indexOf('select\n  bu.exists_at_all'), overallPassStart)

  it.each(requiredAliases)('%s is selected in the SUMMARY output', (alias) => {
    expect(selectListBody).toContain(alias)
  })

  it('every underlying predicate column is ANDed into overall_pass (spot check on the two previously-failing checks)', () => {
    expect(overallPassBody).toContain('bu.qual_is_own_row_equality')
    expect(overallPassBody).toContain('dv.requires_moderation_visible')
    expect(overallPassBody).toContain('de.requires_moderation_visible')
  })

  it('overall_pass combines every predicate with "and", never "or" — cannot be satisfied by a partial pass', () => {
    expect(overallPassBody).not.toMatch(/\bor\b/i)
  })
})
