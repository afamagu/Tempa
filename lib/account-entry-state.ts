import type { SupabaseClient } from '@supabase/supabase-js'
import type { OnboardingStage } from '@/lib/onboarding'
import type { AccountEntryState, EligibilityStatus } from '@/lib/account-entry'
import { CURRENT_TERMS_VERSION, CURRENT_COMMUNITY_GUIDELINES_VERSION, isLegalCurrent } from '@/lib/legal'

// proxy.ts's account-entry read. One self-scoped RPC
// (current_account_entry_state — see docs/sql/2026-10-13-prelaunch-
// performance.sql) replaces the status RPC + three table reads the
// proxy used to make on every protected navigation. The routing
// decision itself stays in lib/account-entry.ts's pure resolver.
//
// The legacy four-read path is kept ONLY as a fallback for when the RPC
// errors (e.g. the migration has not been applied yet), so a deploy
// ordering mistake can never send every member to /begin.

export type ProxyAccountEntry = {
  /** 'active' | 'restricted' | 'suspended' | 'banned' — defaults to
   * 'active' when unreadable, matching current_account_status()'s own
   * fallback. Every write is still refused server-side for a banned
   * account regardless. */
  accountStatus: string
  state: AccountEntryState
}

type EntryStateRow = {
  account_status: string | null
  eligibility_status: string | null
  has_profile: boolean | null
  onboarding_stage: string | null
  terms_current: boolean | null
  guidelines_current: boolean | null
}

export async function readProxyAccountEntry(supabase: SupabaseClient, userId: string): Promise<ProxyAccountEntry> {
  const { data, error } = await supabase.rpc('current_account_entry_state', {
    p_terms_version: CURRENT_TERMS_VERSION,
    p_guidelines_version: CURRENT_COMMUNITY_GUIDELINES_VERSION,
  })
  const row = (Array.isArray(data) ? data[0] : data) as EntryStateRow | null | undefined

  if (!error && row) {
    return {
      accountStatus: row.account_status ?? 'active',
      state: {
        authenticated: true,
        eligibilityStatus: (row.eligibility_status as EligibilityStatus | null) ?? null,
        eligibleOn: null,
        legalCurrent: Boolean(row.terms_current) && Boolean(row.guidelines_current),
        hasProfile: Boolean(row.has_profile),
        onboardingStage: (row.onboarding_stage as OnboardingStage | null) ?? null,
      },
    }
  }

  return readLegacyProxyAccountEntry(supabase, userId)
}

async function readLegacyProxyAccountEntry(supabase: SupabaseClient, userId: string): Promise<ProxyAccountEntry> {
  const [{ data: accountStatus }, { data: profile }, { data: eligibility }, { data: legalRows }] = await Promise.all([
    supabase.rpc('current_account_status'),
    supabase.from('profiles').select('id, onboarding_stage').eq('id', userId).maybeSingle(),
    supabase.from('account_eligibility').select('status').eq('user_id', userId).maybeSingle(),
    supabase.from('legal_acceptances').select('document_type, document_version').eq('user_id', userId),
  ])

  return {
    accountStatus: (accountStatus as string | null) ?? 'active',
    state: {
      authenticated: true,
      eligibilityStatus: (eligibility?.status as EligibilityStatus | undefined) ?? null,
      eligibleOn: null,
      legalCurrent: isLegalCurrent(
        ((legalRows ?? []) as { document_type: string; document_version: string }[]).map((r) => ({
          documentType: r.document_type as 'terms_of_service' | 'community_guidelines',
          documentVersion: r.document_version,
        }))
      ),
      hasProfile: Boolean(profile),
      onboardingStage: (profile?.onboarding_stage as OnboardingStage | undefined) ?? null,
    },
  }
}
