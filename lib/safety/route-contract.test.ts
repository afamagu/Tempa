import { describe, it, expect } from 'vitest'
import {
  parseEvaluateRequest,
  toMemberFacingDisposition,
  buildEvaluateResponse,
  GENERIC_WARNING_COPY_KEY,
} from './route-contract'

const RECIPIENT_ID = '11111111-1111-4111-8111-111111111111'
const LETTER_ID = '22222222-2222-4222-8222-222222222222'
const CORRESPONDENCE_ID = '33333333-3333-4333-8333-333333333333'

describe('parseEvaluateRequest — strict per-surface parsing', () => {
  it('accepts a valid first_letter request, mapping recipientId to contextId', () => {
    const result = parseEvaluateRequest({ surface: 'first_letter', recipientId: RECIPIENT_ID, body: 'Hello there.' })
    expect(result).toEqual({
      ok: true,
      request: { surface: 'first_letter', contextId: RECIPIENT_ID, body: 'Hello there.' },
    })
  })

  it('accepts a valid reply request, mapping letterId to contextId', () => {
    const result = parseEvaluateRequest({ surface: 'reply', letterId: LETTER_ID, body: 'Thanks for writing.' })
    expect(result).toEqual({
      ok: true,
      request: { surface: 'reply', contextId: LETTER_ID, body: 'Thanks for writing.' },
    })
  })

  it('accepts a valid write_anytime request, mapping correspondenceId to contextId', () => {
    const result = parseEvaluateRequest({ surface: 'write_anytime', correspondenceId: CORRESPONDENCE_ID, body: 'More news.' })
    expect(result).toEqual({
      ok: true,
      request: { surface: 'write_anytime', contextId: CORRESPONDENCE_ID, body: 'More news.' },
    })
  })

  it('rejects an unknown surface — no generic surface+fields[] interface', () => {
    const result = parseEvaluateRequest({ surface: 'anything_else', body: 'hi', someField: '1' })
    expect(result.ok).toBe(false)
  })

  it('rejects a missing surface', () => {
    const result = parseEvaluateRequest({ body: 'hi' })
    expect(result.ok).toBe(false)
  })

  it('rejects first_letter with a non-UUID recipientId', () => {
    const result = parseEvaluateRequest({ surface: 'first_letter', recipientId: 'not-a-uuid', body: 'hi' })
    expect(result.ok).toBe(false)
  })

  it('rejects first_letter with a letterId instead of recipientId — each surface owns its own field name', () => {
    const result = parseEvaluateRequest({ surface: 'first_letter', letterId: LETTER_ID, body: 'hi' })
    expect(result.ok).toBe(false)
  })

  it('rejects a missing body', () => {
    const result = parseEvaluateRequest({ surface: 'reply', letterId: LETTER_ID })
    expect(result.ok).toBe(false)
  })

  it('rejects an empty/whitespace-only body', () => {
    const result = parseEvaluateRequest({ surface: 'reply', letterId: LETTER_ID, body: '   ' })
    expect(result.ok).toBe(false)
  })

  it('rejects a non-string body', () => {
    const result = parseEvaluateRequest({ surface: 'reply', letterId: LETTER_ID, body: 12345 })
    expect(result.ok).toBe(false)
  })

  it('rejects an absurdly long body as an abuse guard', () => {
    const result = parseEvaluateRequest({ surface: 'reply', letterId: LETTER_ID, body: 'x'.repeat(20_001) })
    expect(result.ok).toBe(false)
  })

  it('rejects a non-object payload', () => {
    expect(parseEvaluateRequest(null).ok).toBe(false)
    expect(parseEvaluateRequest('a string').ok).toBe(false)
    expect(parseEvaluateRequest(['array']).ok).toBe(false)
    expect(parseEvaluateRequest(42).ok).toBe(false)
  })

  it('never accepts a client-supplied userId — the shape has no such field at all', () => {
    const result = parseEvaluateRequest({
      surface: 'first_letter',
      recipientId: RECIPIENT_ID,
      body: 'hi',
      userId: 'attacker-supplied-id',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.request).not.toHaveProperty('userId')
      expect(Object.keys(result.request)).toEqual(['surface', 'contextId', 'body'])
    }
  })
})

describe('toMemberFacingDisposition — maps classifier disposition to the narrow browser-facing enum', () => {
  it('allow -> allow', () => {
    expect(toMemberFacingDisposition('allow')).toBe('allow')
  })
  it('warn -> warning_required', () => {
    expect(toMemberFacingDisposition('warn')).toBe('warning_required')
  })
  it('deny -> cannot_send', () => {
    expect(toMemberFacingDisposition('deny')).toBe('cannot_send')
  })
})

describe('buildEvaluateResponse — never leaks risk band/reason codes, only id + coarse disposition', () => {
  it('omits warningCopyKey when allowed', () => {
    const response = buildEvaluateResponse('eval-id', 'allow')
    expect(response).toEqual({ evaluationId: 'eval-id', disposition: 'allow' })
    expect(response).not.toHaveProperty('warningCopyKey')
  })

  it('includes warningCopyKey when a warning is required', () => {
    const response = buildEvaluateResponse('eval-id', 'warn')
    expect(response).toEqual({ evaluationId: 'eval-id', disposition: 'warning_required', warningCopyKey: GENERIC_WARNING_COPY_KEY })
  })

  it('includes warningCopyKey when denied', () => {
    const response = buildEvaluateResponse('eval-id', 'deny')
    expect(response).toEqual({ evaluationId: 'eval-id', disposition: 'cannot_send', warningCopyKey: GENERIC_WARNING_COPY_KEY })
  })

  it('the response shape never contains a riskBand, reasonCodes, or indicators key', () => {
    const response = buildEvaluateResponse('eval-id', 'deny') as Record<string, unknown>
    expect(response).not.toHaveProperty('riskBand')
    expect(response).not.toHaveProperty('reasonCodes')
    expect(response).not.toHaveProperty('indicators')
  })
})
