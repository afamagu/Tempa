import { describe, it, expect, vi, afterEach } from 'vitest'
import { extractIndicators } from './indicators'
import { classifyContent } from './classify'
import { buildEvaluateResponse } from './route-contract'
import {
  evaluateSafety,
  SAFETY_CHECK_FAILED_MESSAGE,
  SAFETY_CANNOT_SEND_MESSAGE,
  SAFETY_WARNING_BODY,
} from './send-with-safety'

// Post-Safety cleanup (2026-09-24) — a real production test showed
// "Please send me money. I love you." ending in the generic Safety
// FAILURE copy, while removing "Please send me money." let the same
// letter through. This file pins, layer by layer, what the CURRENT
// canonical policy actually does with that phrase, so a fix to the
// failure path can never be mistaken for (or masked by) a change to the
// classifier's own policy.
//
// Root cause (reproduced on real Postgres via PGlite, NOT in this
// file's layers — see the handoff report): public.record_safety_
// evaluation's `on conflict (evaluation_id) do nothing` on the
// safety_signals insert is ambiguous against that function's own
// RETURNS TABLE column `evaluation_id` (42702). It only executes when a
// signal is created (band meaningful+), so `allow` content worked and
// every warn/deny evaluation returned HTTP 500. Every layer covered
// below is correct; the defect is in SQL that a TS test cannot reach.

const PHRASE = 'Please send me money. I love you.'

describe('layer 1+2 — indicators and classifier (current canonical policy)', () => {
  it('detects a directed money request in the phrase', () => {
    expect(extractIndicators(PHRASE).hasDirectedMoneyRequest).toBe(true)
  })

  it('classifies it DIRECT_MONEY_REQUEST / meaningful / warn — the existing approved policy, not a system error', () => {
    const result = classifyContent(PHRASE)
    expect(result.reasonCodes).toEqual(['DIRECT_MONEY_REQUEST'])
    expect(result.riskBand).toBe('meaningful')
    expect(result.mutationDisposition).toBe('warn')
    expect(result.escalateCase).toBe(false)
  })

  it('the request half alone classifies identically — the "I love you." half never changes the outcome', () => {
    const alone = classifyContent('Please send me money.')
    const combined = classifyContent(PHRASE)
    expect(alone.riskBand).toBe(combined.riskBand)
    expect(alone.mutationDisposition).toBe(combined.mutationDisposition)
    expect(classifyContent('I love you.').mutationDisposition).toBe('allow')
  })
})

describe('layer 3 — the route response for that classification', () => {
  it('a warn disposition is a SUCCESSFUL evaluation response carrying warning_required, never an error shape', () => {
    const { mutationDisposition } = classifyContent(PHRASE)
    const body = buildEvaluateResponse('eval-1', mutationDisposition)
    expect(body).toMatchObject({ evaluationId: 'eval-1', disposition: 'warning_required' })
    expect(JSON.stringify(body)).not.toMatch(/error|DIRECT_MONEY_REQUEST|meaningful|scam|fraud/i)
  })
})

describe('B — innocent money discussion is not prohibited merely for mentioning money', () => {
  it.each([
    'I spent a lot of money fixing my car.',
    'My hospital bill was expensive.',
    'Rent is expensive where I live and money has been tight this year.',
  ])('%s -> allow, no reason codes', (text) => {
    const result = classifyContent(text)
    expect(result.mutationDisposition).toBe('allow')
    expect(result.reasonCodes).toEqual([])
  })
})

describe('layer 5 — evaluateSafety keeps three genuinely different outcomes', () => {
  const originalFetch = global.fetch
  afterEach(() => {
    global.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('the phrase, evaluated successfully as warning_required, is NEVER status: error', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => buildEvaluateResponse('eval-9', classifyContent(PHRASE).mutationDisposition),
    }) as unknown as typeof fetch

    const result = await evaluateSafety({ surface: 'reply', letterId: 'l-1', body: PHRASE })
    expect(result).toEqual({ status: 'warning_required', evaluationId: 'eval-9' })
  })

  it('C — a genuine evaluate API failure (HTTP 500) is status: error, so the composer never sends', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({}) }) as unknown as typeof fetch

    const result = await evaluateSafety({ surface: 'reply', letterId: 'l-1', body: PHRASE })
    expect(result).toEqual({ status: 'error' })
    // Distinguishable in logs from an actual Safety intervention.
    expect(consoleSpy).toHaveBeenCalledWith('[safety] evaluateSafety returned a non-OK status', { status: 500 })
  })

  it('a rate-limit response (429) is also a service outcome, never allow and never a warning', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 429, json: async () => ({}) }) as unknown as typeof fetch
    expect(await evaluateSafety({ surface: 'reply', letterId: 'l-1', body: PHRASE })).toEqual({ status: 'error' })
  })

  it('E — cannot_send is its own restrained outcome, not the failure outcome', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ evaluationId: 'eval-x', disposition: 'cannot_send' }),
    }) as unknown as typeof fetch
    expect(await evaluateSafety({ surface: 'reply', letterId: 'l-1', body: PHRASE })).toEqual({ status: 'cannot_send' })
  })
})

describe('member-facing copy — the three outcomes never share wording', () => {
  it('failure copy is the spec wording and never accuses or mentions the member\'s writing', () => {
    expect(SAFETY_CHECK_FAILED_MESSAGE).toBe(
      'We couldn’t complete the safety check right now. Please try again in a moment.'
    )
    expect(SAFETY_CHECK_FAILED_MESSAGE).not.toMatch(/scam|fraud|written|money|unsafe/i)
  })

  it('the warning and cannot-send copy never reuse the failure wording (and vice versa)', () => {
    for (const other of [SAFETY_WARNING_BODY, SAFETY_CANNOT_SEND_MESSAGE]) {
      expect(other).not.toContain('safety check')
      expect(other).not.toBe(SAFETY_CHECK_FAILED_MESSAGE)
    }
    expect(SAFETY_CHECK_FAILED_MESSAGE).not.toContain('pause')
  })

  it('no member-facing string exposes bands, reason codes, or accusation language', () => {
    for (const text of [SAFETY_CHECK_FAILED_MESSAGE, SAFETY_WARNING_BODY, SAFETY_CANNOT_SEND_MESSAGE]) {
      expect(text).not.toMatch(/scammer|fraud|DIRECT_MONEY_REQUEST|meaningful|risk band|case/i)
    }
  })
})
