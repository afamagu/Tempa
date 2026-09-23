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
const QUESTION_ANSWER_ID = '44444444-4444-4444-8444-444444444444'

describe('parseEvaluateRequest — strict per-surface parsing', () => {
  it('accepts a valid first_letter request, mapping recipientId to contextId and carrying questionAnswerId', () => {
    const result = parseEvaluateRequest({
      surface: 'first_letter',
      recipientId: RECIPIENT_ID,
      questionAnswerId: QUESTION_ANSWER_ID,
      body: 'Hello there.',
    })
    expect(result).toEqual({
      ok: true,
      request: {
        surface: 'first_letter',
        contextId: RECIPIENT_ID,
        questionAnswerId: QUESTION_ANSWER_ID,
        postcard: null,
        body: 'Hello there.',
      },
    })
  })

  it('rejects a first_letter request missing questionAnswerId — context_id (the recipient) alone is not the real mutation context', () => {
    const result = parseEvaluateRequest({ surface: 'first_letter', recipientId: RECIPIENT_ID, body: 'Hello there.' })
    expect(result.ok).toBe(false)
  })

  it('rejects a first_letter request with a non-UUID questionAnswerId', () => {
    const result = parseEvaluateRequest({
      surface: 'first_letter',
      recipientId: RECIPIENT_ID,
      questionAnswerId: 'not-a-uuid',
      body: 'Hello there.',
    })
    expect(result.ok).toBe(false)
  })

  describe('first_letter — its own 2,000-char product cap, not the generic 200,000-char abuse ceiling (independent audit correction: do not persist Safety evidence for a mutation-impossible payload)', () => {
    it('accepts a first_letter body right at the 2,000-char cap', () => {
      const result = parseEvaluateRequest({
        surface: 'first_letter',
        recipientId: RECIPIENT_ID,
        questionAnswerId: QUESTION_ANSWER_ID,
        body: 'x'.repeat(2000),
      })
      expect(result.ok).toBe(true)
    })

    it('rejects a first_letter body of 2,001 chars — well under the generic 200,000-char ceiling, so this is the Letter-1 cap actually firing, not the abuse guard', () => {
      const result = parseEvaluateRequest({
        surface: 'first_letter',
        recipientId: RECIPIENT_ID,
        questionAnswerId: QUESTION_ANSWER_ID,
        body: 'x'.repeat(2001),
      })
      expect(result.ok).toBe(false)
    })

    it('uses the same Unicode code-point counting as first-letter-composer.tsx\'s own charLength and send_first_letter\'s own char_length() — a 2,000-code-point body built from surrogate-pair characters is not over-counted by .length and wrongly rejected', () => {
      // Each of these is one code point but two UTF-16 code units — a
      // plain `.length` count would see 4,000 and reject this body,
      // which is actually exactly at the real 2,000-character cap.
      const body = '𝟙'.repeat(2000)
      expect(body.length).toBe(4000)
      const result = parseEvaluateRequest({
        surface: 'first_letter',
        recipientId: RECIPIENT_ID,
        questionAnswerId: QUESTION_ANSWER_ID,
        body,
      })
      expect(result.ok).toBe(true)
    })

    it('a reply/write_anytime body well over 2,000 chars is unaffected — the Letter-1 cap is first_letter-only', () => {
      const longEstablishedLetter = 'x'.repeat(5000)
      const replyResult = parseEvaluateRequest({ surface: 'reply', letterId: LETTER_ID, body: longEstablishedLetter })
      expect(replyResult.ok).toBe(true)
    })
  })

  it('accepts a valid reply request, mapping letterId to contextId, with questionAnswerId and postcard both null when omitted', () => {
    const result = parseEvaluateRequest({ surface: 'reply', letterId: LETTER_ID, body: 'Thanks for writing.' })
    expect(result).toEqual({
      ok: true,
      request: { surface: 'reply', contextId: LETTER_ID, questionAnswerId: null, postcard: null, body: 'Thanks for writing.' },
    })
  })

  it('accepts a valid write_anytime request, mapping correspondenceId to contextId, with questionAnswerId and postcard both null when omitted', () => {
    const result = parseEvaluateRequest({ surface: 'write_anytime', correspondenceId: CORRESPONDENCE_ID, body: 'More news.' })
    expect(result).toEqual({
      ok: true,
      request: {
        surface: 'write_anytime',
        contextId: CORRESPONDENCE_ID,
        questionAnswerId: null,
        postcard: null,
        body: 'More news.',
      },
    })
  })

  describe('postcard — reply/write_anytime only, first_letter never parses one', () => {
    const VALID_POSTCARD = { postcardKey: 'seaside', revealLine: 'Wish you were here', backMessage: 'Thinking of you.' }

    it('accepts a valid postcard on reply, mapped into the parsed request', () => {
      const result = parseEvaluateRequest({ surface: 'reply', letterId: LETTER_ID, body: 'Thanks!', postcard: VALID_POSTCARD })
      expect(result).toEqual({
        ok: true,
        request: {
          surface: 'reply',
          contextId: LETTER_ID,
          questionAnswerId: null,
          postcard: VALID_POSTCARD,
          body: 'Thanks!',
        },
      })
    })

    it('accepts a valid postcard on write_anytime, mapped into the parsed request', () => {
      const result = parseEvaluateRequest({
        surface: 'write_anytime',
        correspondenceId: CORRESPONDENCE_ID,
        body: 'More news.',
        postcard: VALID_POSTCARD,
      })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.request.postcard).toEqual(VALID_POSTCARD)
    })

    it('accepts a postcard with a null revealLine, carried through as null', () => {
      const result = parseEvaluateRequest({
        surface: 'reply',
        letterId: LETTER_ID,
        body: 'Thanks!',
        postcard: { postcardKey: 'seaside', revealLine: null, backMessage: 'Thinking of you.' },
      })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.request.postcard).toEqual({ postcardKey: 'seaside', revealLine: null, backMessage: 'Thinking of you.' })
    })

    it('never even parses a postcard field for first_letter — always null regardless of what was sent', () => {
      const result = parseEvaluateRequest({
        surface: 'first_letter',
        recipientId: RECIPIENT_ID,
        questionAnswerId: QUESTION_ANSWER_ID,
        body: 'Hi',
        postcard: VALID_POSTCARD,
      })
      expect(result.ok).toBe(true)
      if (result.ok) expect(result.request.postcard).toBeNull()
    })

    it('rejects a postcard with a missing/empty postcardKey', () => {
      const result = parseEvaluateRequest({
        surface: 'reply',
        letterId: LETTER_ID,
        body: 'Thanks!',
        postcard: { revealLine: 'Hi', backMessage: 'Thinking of you.' },
      })
      expect(result.ok).toBe(false)
    })

    it('rejects a postcard with a missing/blank backMessage', () => {
      const result = parseEvaluateRequest({
        surface: 'reply',
        letterId: LETTER_ID,
        body: 'Thanks!',
        postcard: { postcardKey: 'seaside', backMessage: '   ' },
      })
      expect(result.ok).toBe(false)
    })

    it('rejects a non-object postcard', () => {
      const result = parseEvaluateRequest({ surface: 'reply', letterId: LETTER_ID, body: 'Thanks!', postcard: 'not-an-object' })
      expect(result.ok).toBe(false)
    })

    it('rejects an absurdly long backMessage as an abuse guard, same ceiling as body', () => {
      const result = parseEvaluateRequest({
        surface: 'reply',
        letterId: LETTER_ID,
        body: 'Thanks!',
        postcard: { postcardKey: 'seaside', backMessage: 'x'.repeat(200_001) },
      })
      expect(result.ok).toBe(false)
    })

    it('rejects a postcardKey past its own modest technical ceiling (independent audit correction)', () => {
      const result = parseEvaluateRequest({
        surface: 'reply',
        letterId: LETTER_ID,
        body: 'Thanks!',
        postcard: { postcardKey: 'x'.repeat(201), backMessage: 'Thinking of you.' },
      })
      expect(result.ok).toBe(false)
    })

    it('rejects a revealLine past its own modest technical ceiling — previously had no ceiling at all (independent audit correction)', () => {
      const result = parseEvaluateRequest({
        surface: 'reply',
        letterId: LETTER_ID,
        body: 'Thanks!',
        postcard: { postcardKey: 'seaside', revealLine: 'x'.repeat(501), backMessage: 'Thinking of you.' },
      })
      expect(result.ok).toBe(false)
    })

    it('accepts a postcardKey/revealLine right at their own technical ceilings', () => {
      const result = parseEvaluateRequest({
        surface: 'reply',
        letterId: LETTER_ID,
        body: 'Thanks!',
        postcard: { postcardKey: 'x'.repeat(200), revealLine: 'x'.repeat(500), backMessage: 'Thinking of you.' },
      })
      expect(result.ok).toBe(true)
    })

    it('never re-derives the real 32-char Reveal Line product limit here — a 33-char revealLine, well under the technical ceiling, is not rejected at this layer (that authoritative check lives only in tempa_private.postcard_shape_is_valid)', () => {
      const result = parseEvaluateRequest({
        surface: 'reply',
        letterId: LETTER_ID,
        body: 'Thanks!',
        postcard: { postcardKey: 'seaside', revealLine: 'x'.repeat(33), backMessage: 'Thinking of you.' },
      })
      expect(result.ok).toBe(true)
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
    const result = parseEvaluateRequest({ surface: 'reply', letterId: LETTER_ID, body: 'x'.repeat(200_001) })
    expect(result.ok).toBe(false)
  })

  it('does not impose a smaller Safety-only ceiling on established reply/write-anytime correspondence, which has no product-level cap', () => {
    // Well past the Letter-1-only 2000-char first-contact cap
    // (QUESTION_ANSWER_MAX_CHARS) and well past what any real letter
    // would ever reach, but still comfortably under this endpoint's own
    // abuse guard — proves the guard is generous enough not to quietly
    // become a new, smaller Tempa Letter limit.
    const longEstablishedLetter = 'This is a very long, otherwise-legitimate letter. '.repeat(1000)
    expect(longEstablishedLetter.length).toBeGreaterThan(20_000)
    expect(longEstablishedLetter.length).toBeLessThan(200_000)

    const replyResult = parseEvaluateRequest({ surface: 'reply', letterId: LETTER_ID, body: longEstablishedLetter })
    expect(replyResult.ok).toBe(true)

    const writeAnytimeResult = parseEvaluateRequest({
      surface: 'write_anytime',
      correspondenceId: CORRESPONDENCE_ID,
      body: longEstablishedLetter,
    })
    expect(writeAnytimeResult.ok).toBe(true)
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
      questionAnswerId: QUESTION_ANSWER_ID,
      body: 'hi',
      userId: 'attacker-supplied-id',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.request).not.toHaveProperty('userId')
      expect(Object.keys(result.request)).toEqual(['surface', 'contextId', 'questionAnswerId', 'postcard', 'body'])
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
