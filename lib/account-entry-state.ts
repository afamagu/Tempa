import type { SupabaseClient } from '@supabase/supabase-js'
import type { OnboardingStage } from '@/lib/onboarding'
import type { AccountEntryState, EligibilityStatus } from '@/lib/account-entry'
import { CURRENT_TERMS_VERSION, CURRENT_COMMUNITY_GUIDELINES_VERSION, isLegalCurrent } from '@/lib/legal'

// proxy.ts's account-entry read. The existing current_account_entry_state RPC
// remains untouched. Language confirmation is deliberately read from its
// private preference table alongside that RPC so this PR does not rewrite the
// already-sensitive account-state function merely to add one gate. A missing
// migration fails open (undefined) rather than trapping every member.

export type ProxyAccountEntry = {
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
  has_writing_style?: boolean | null
}

export async function readProxyAccountEntry(supabase: SupabaseClient, userId: string): Promise<ProxyAccountEntry> {
  const [entryResult, languageResult] = await Promise.all([
    supabase.rpc('current_account_entry_state', {
      p_terms_version: CURRENT_TERMS_VERSION,
      p_guidelines_version: CURRENT_COMMUNITY_GUIDELINES_VERSION,
    }),
    supabase
      .from('member_language_preferences')
      .select('language_confirmed_at')
      .eq('user_id', userId)
      .maybeSingle(),
  ])

  const { data, error } = entryResult
  const row = (Array.isArray(data) ? data[0] : data) as EntryStateRow | null | undefined
  const languageConfirmed = languageResult.error
    ? undefined
    : Boolean((languageResult.data as { language_confirmed_at?: string | null } | null)?.language_confirmed_at)

  if (!error && row) {
    return {
      accountStatus: row.account_status ?? 'active',
      state: {
        authenticated: true,
        languageConfirmed,
        eligibilityStatus: (row.eligibility_status as EligibilityStatus | null) ?? null,
        eligibleOn: null,
        legalCurrent: Boolean(row.terms_current) && Boolean(row.guidelines_current),
        hasProfile: Boolean(row.has_profile),
        onboardingStage: (row.onboarding_stage as OnboardingStage | null) ?? null,
        needsWritingStyle: row.has_writing_style === false,
      },
    }
  }

  return readLegacyProxyAccountEntry(supabase, userId, languageConfirmed)
}

async function readLegacyProxyAccountEntry(
  supabase: SupabaseClient,
  userId: string,
  languageConfirmed: boolean | undefined
): Promise<ProxyAccountEntry> {
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
      languageConfirmed,
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
