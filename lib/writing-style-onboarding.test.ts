import { describe, expect, it } from 'vitest'
import {
  WRITING_STYLE_ONBOARDING_HREF,
  WRITING_STYLE_PATH,
  isWritingStyleExemptPath,
  resolveOnboardingDestination,
  writingStyleStepHref,
  type OnboardingStage,
} from './onboarding'
import { resolveAccountEntryDestination } from './account-entry'
import { readProxyAccountEntry } from './account-entry-state'
import type { SupabaseClient } from '@supabase/supabase-js'

const complete = { authenticated: true, hasProfile: true, onboardingStage: 'complete' as OnboardingStage }

describe('Writing Style — onboarding order: Mark → Flagship Question → Writing Style → Tempa', () => {
  it('earlier steps always win: Mark and Question are never skipped or restarted by the style step', () => {
    for (const onboardingStage of ['mark', 'question'] as const) {
      const dest = resolveOnboardingDestination(
        { authenticated: true, hasProfile: true, onboardingStage, needsWritingStyle: true },
        '/home'
      )
      expect(dest).toBe(onboardingStage === 'mark' ? '/profile/mark' : '/profile/question')
    }
  })

  it('after the Flagship Question (stage complete, no style yet) the member is sent to the style step, carrying where they were going', () => {
    expect(resolveOnboardingDestination({ ...complete, needsWritingStyle: true }, '/minds')).toBe(
      `${WRITING_STYLE_PATH}?next=%2Fminds`
    )
    expect(resolveOnboardingDestination({ ...complete, needsWritingStyle: true }, '/letters/abc?x=1')).toBe(
      writingStyleStepHref('/letters/abc?x=1')
    )
  })

  it('the Flagship completion screen continues to the step, then People', () => {
    expect(WRITING_STYLE_ONBOARDING_HREF).toBe('/profile/writing-style?next=%2Fminds')
  })

  it('refresh/back to the step itself is never redirected away while the choice is pending (no loop)', () => {
    for (const path of [WRITING_STYLE_PATH, `${WRITING_STYLE_PATH}?next=%2Fminds`]) {
      expect(resolveOnboardingDestination({ ...complete, needsWritingStyle: true }, path)).toBe(path)
    }
  })

  it('account & privacy and staff tools stay reachable before choosing', () => {
    for (const path of ['/you/account', '/you/account?panel=delete', '/admin', '/admin/members']) {
      expect(isWritingStyleExemptPath(path)).toBe(true)
      expect(resolveOnboardingDestination({ ...complete, needsWritingStyle: true }, path)).toBe(path)
    }
    // A prefix look-alike is not exempt.
    expect(isWritingStyleExemptPath('/profile/writing-styles-evil')).toBe(false)
    expect(isWritingStyleExemptPath('/you/accountant')).toBe(false)
  })

  it('once a style is saved the member is never interrupted again', () => {
    expect(resolveOnboardingDestination({ ...complete, needsWritingStyle: false }, '/board')).toBe('/board')
  })

  it('an unknown/absent signal never gates (the app is safe to deploy before the migration)', () => {
    expect(resolveOnboardingDestination(complete, '/board')).toBe('/board')
  })

  it('the account-entry layer passes the signal through unchanged, after eligibility and legal gates', () => {
    const base = { authenticated: true, eligibilityStatus: 'eligible' as const, eligibleOn: null, legalCurrent: true, hasProfile: true, onboardingStage: 'complete' as const }
    expect(resolveAccountEntryDestination({ ...base, needsWritingStyle: true }, '/home')).toBe('/profile/writing-style?next=%2Fhome')
    expect(resolveAccountEntryDestination({ ...base, legalCurrent: false, needsWritingStyle: true }, '/home')).toBe('/begin')
  })
})

function fakeEntryRpc(row: Record<string, unknown> | null, error: unknown = null) {
  return {
    rpc: async () => ({ data: row ? [row] : null, error }),
  } as unknown as SupabaseClient
}

const ROW = {
  account_status: 'active',
  eligibility_status: 'eligible',
  has_profile: true,
  onboarding_stage: 'complete',
  terms_current: true,
  guidelines_current: true,
}

describe('proxy entry-state read — derived from a valid saved style, never a local flag', () => {
  it('has_writing_style = false → needs the one-time choice (existing members included)', async () => {
    const { state } = await readProxyAccountEntry(fakeEntryRpc({ ...ROW, has_writing_style: false }), 'u')
    expect(state.needsWritingStyle).toBe(true)
  })

  it('has_writing_style = true → never again', async () => {
    const { state } = await readProxyAccountEntry(fakeEntryRpc({ ...ROW, has_writing_style: true }), 'u')
    expect(state.needsWritingStyle).toBe(false)
  })

  it('an RPC from before the migration (no column) never gates', async () => {
    const { state } = await readProxyAccountEntry(fakeEntryRpc(ROW), 'u')
    expect(state.needsWritingStyle).toBe(false)
  })
})
