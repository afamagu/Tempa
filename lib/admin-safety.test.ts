import { describe, it, expect, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { listSafetyCases, getSafetyCase, listCaseSignals, getSafetyEvidence, transitionSafetyCase } from './admin-safety'

// Same lightweight convention as app/api/safety/evaluate/route.test.ts's
// own RPC mocking — this file proves the wrapper's own RPC name/param
// shape and snake_case -> camelCase mapping, NOT the server-side
// authorization/business logic itself, which is already exhaustively
// covered by lib/__tests__/safetyCheckpoint7AdminNeedsAttentionMigration
// .test.ts against the real migration source (is_staff gating,
// narrow-evidence-by-signal-id-only, concurrency-safe transitions).
// Building a full fake-database simulation of five new RPCs spanning
// safety_cases/safety_signals/safety_evaluations/reports/blocked_users
// would mean re-implementing their own SQL logic a second time in JS —
// exactly the "enormous fixture set" this checkpoint's own instruction
// says to avoid; the migration-text assertions are the deeper proof.

function fakeClient(rpcImpl: (name: string, params: Record<string, unknown>) => unknown) {
  return { rpc: vi.fn(rpcImpl) } as unknown as SupabaseClient
}

describe('listSafetyCases', () => {
  it('calls admin_list_safety_cases with the active default and maps snake_case rows to camelCase', async () => {
    const supabase = fakeClient(() => ({
      data: [
        {
          id: 'case-1',
          subject_user_id: 'user-1',
          subject_pseudonym: 'Alex',
          status: 'open',
          highest_risk_band: 'meaningful',
          signal_count: 2,
          opened_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-02T00:00:00Z',
          reason_codes: ['DIRECT_MONEY_REQUEST'],
        },
      ],
      error: null,
    }))
    const { data, error } = await listSafetyCases(supabase)
    expect(supabase.rpc).toHaveBeenCalledWith('admin_list_safety_cases', { p_status: 'active', p_limit: 30, p_offset: 0 })
    expect(error).toBeNull()
    expect(data).toEqual([
      {
        id: 'case-1',
        subjectUserId: 'user-1',
        subjectPseudonym: 'Alex',
        status: 'open',
        highestRiskBand: 'meaningful',
        signalCount: 2,
        openedAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-02T00:00:00Z',
        reasonCodes: ['DIRECT_MONEY_REQUEST'],
      },
    ])
  })

  it('passes "all" through as null so the RPC returns every status', async () => {
    const supabase = fakeClient(() => ({ data: [], error: null }))
    await listSafetyCases(supabase, { status: 'all' })
    expect(supabase.rpc).toHaveBeenCalledWith('admin_list_safety_cases', { p_status: null, p_limit: 30, p_offset: 0 })
  })

  it('a Not authorized error from a non-staff caller surfaces as the wrapper\'s own error, never thrown', async () => {
    const supabase = fakeClient(() => ({ data: null, error: { message: 'Not authorized.', code: '42501' } }))
    const { data, error } = await listSafetyCases(supabase)
    expect(data).toEqual([])
    expect(error?.message).toBe('Not authorized.')
  })
})

describe('getSafetyCase', () => {
  it('calls admin_get_safety_case with the case id and maps the full detail row', async () => {
    const supabase = fakeClient(() => ({
      data: [
        {
          id: 'case-1',
          subject_user_id: 'user-1',
          subject_pseudonym: 'Alex',
          subject_account_status: 'active',
          subject_account_created_at: '2025-01-01T00:00:00Z',
          subject_report_count: 1,
          subject_block_count: 0,
          status: 'reviewing',
          highest_risk_band: 'high',
          signal_count: 3,
          opened_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-02T00:00:00Z',
          reviewed_at: null,
          reviewed_by_pseudonym: null,
        },
      ],
      error: null,
    }))
    const { data } = await getSafetyCase(supabase, 'case-1')
    expect(supabase.rpc).toHaveBeenCalledWith('admin_get_safety_case', { p_case_id: 'case-1' })
    expect(data?.subjectAccountCreatedAt).toBe('2025-01-01T00:00:00Z')
    expect(data?.subjectReportCount).toBe(1)
    expect(data?.subjectBlockCount).toBe(0)
  })
})

describe('listCaseSignals', () => {
  it('maps warning/disposition/observed_counts fields through unchanged', async () => {
    const supabase = fakeClient(() => ({
      data: [
        {
          id: 'signal-1',
          surface: 'behavior_high_contact_velocity',
          context_id: 'user-1',
          reason_codes: ['HIGH_CONTACT_VELOCITY'],
          risk_band: 'meaningful',
          created_at: '2026-01-01T00:00:00Z',
          warning_required: false,
          warning_issued_at: null,
          warning_acknowledged_at: null,
          mutation_disposition: null,
          proceeded_at: null,
          source_content_id: null,
          observed_counts: { window_hours: 1, distinct_recipients: 8 },
        },
      ],
      error: null,
    }))
    const { data } = await listCaseSignals(supabase, 'case-1')
    expect(supabase.rpc).toHaveBeenCalledWith('admin_list_case_signals', { p_case_id: 'case-1' })
    expect(data[0].observedCounts).toEqual({ window_hours: 1, distinct_recipients: 8 })
    expect(data[0].sourceContentId).toBeNull()
  })
})

describe('getSafetyEvidence', () => {
  it('maps a letter evidence row correctly', async () => {
    const supabase = fakeClient(() => ({
      data: [
        {
          evidence_kind: 'letter',
          letter_body: 'Hello there.',
          letter_sender_pseudonym: 'Sender',
          letter_recipient_pseudonym: 'Recipient',
          letter_created_at: '2026-01-01T00:00:00Z',
          public_content_type: null,
          public_content_id: null,
          public_dispatch_id: null,
        },
      ],
      error: null,
    }))
    const { data } = await getSafetyEvidence(supabase, 'case-1', 'signal-1')
    expect(supabase.rpc).toHaveBeenCalledWith('admin_get_safety_signal_evidence', {
      p_case_id: 'case-1',
      p_signal_id: 'signal-1',
    })
    expect(data).toEqual({
      kind: 'letter',
      body: 'Hello there.',
      senderPseudonym: 'Sender',
      recipientPseudonym: 'Recipient',
      createdAt: '2026-01-01T00:00:00Z',
    })
  })

  it('maps a public evidence row correctly, never fetching the letter fields', async () => {
    const supabase = fakeClient(() => ({
      data: [
        {
          evidence_kind: 'public',
          letter_body: null,
          letter_sender_pseudonym: null,
          letter_recipient_pseudonym: null,
          letter_created_at: null,
          public_content_type: 'dispatch',
          public_content_id: 'dispatch-1',
          public_dispatch_id: 'dispatch-1',
        },
      ],
      error: null,
    }))
    const { data } = await getSafetyEvidence(supabase, 'case-2', 'signal-2')
    expect(data).toEqual({ kind: 'public', contentType: 'dispatch', contentId: 'dispatch-1', dispatchId: 'dispatch-1' })
  })

  it('maps a none/unavailable evidence row without inventing content', async () => {
    const supabase = fakeClient(() => ({ data: [{ evidence_kind: 'none' }], error: null }))
    const { data } = await getSafetyEvidence(supabase, 'case-3', 'signal-3')
    expect(data).toEqual({ kind: 'none' })
  })

  it('independent audit correction: always passes BOTH the case id and the signal id — a signal id alone is never sufficient to request evidence', async () => {
    const supabase = fakeClient(() => ({ data: [{ evidence_kind: 'none' }], error: null }))
    await getSafetyEvidence(supabase, 'case-4', 'signal-4')
    const [, params] = (supabase.rpc as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(params).toEqual({ p_case_id: 'case-4', p_signal_id: 'signal-4' })
    expect(Object.keys(params)).toHaveLength(2)
  })

  it('a "Signal not found" error (e.g. a signal that exists but belongs to a different case, or has no case at all) surfaces as the wrapper\'s own error, never fabricated evidence', async () => {
    const supabase = fakeClient(() => ({ data: null, error: { message: 'Signal not found.', code: '22023' } }))
    const { data, error } = await getSafetyEvidence(supabase, 'case-5', 'signal-not-in-this-case')
    expect(data).toBeNull()
    expect(error?.message).toBe('Signal not found.')
  })
})

describe('transitionSafetyCase', () => {
  it('passes case id, expected status, new status, and trimmed reason through positionally-named params', async () => {
    const supabase = fakeClient(() => ({ data: null, error: null }))
    await transitionSafetyCase(supabase, 'case-1', 'open', 'reviewing', '  looks suspicious  ')
    expect(supabase.rpc).toHaveBeenCalledWith('admin_transition_safety_case', {
      p_case_id: 'case-1',
      p_expected_status: 'open',
      p_new_status: 'reviewing',
      p_reason: 'looks suspicious',
    })
  })

  it('a stale-case error surfaces as the wrapper\'s own error message, never silently succeeding', async () => {
    const supabase = fakeClient(() => ({
      data: null,
      error: { message: 'This case has changed since you loaded it. Please refresh and try again.', code: '22023' },
    }))
    const { error } = await transitionSafetyCase(supabase, 'case-1', 'open', 'no_action')
    expect(error?.message).toBe('This case has changed since you loaded it. Please refresh and try again.')
  })
})
