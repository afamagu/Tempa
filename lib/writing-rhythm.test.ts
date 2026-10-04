import { describe, expect, it, vi } from 'vitest'
import {
  WRITING_RHYTHMS,
  getCorrespondenceRhythm,
  getMyWritingRhythm,
  isWritingRhythm,
  rhythmStatusCopy,
  rhythmTimingState,
  writingRhythmApproximateDays,
  writingRhythmLabel,
} from './writing-rhythm'

describe('writing rhythm values', () => {
  it('has exactly four bounded rhythms and no unbounded whenever option', () => {
    expect(Object.keys(WRITING_RHYTHMS)).toEqual([
      'few_days',
      'one_week',
      'two_weeks',
      'one_month',
    ])
    expect(JSON.stringify(WRITING_RHYTHMS).toLowerCase()).not.toContain('when i have something to say')
    expect(JSON.stringify(WRITING_RHYTHMS).toLowerCase()).not.toContain('whenever')
  })

  it('maps labels and approximate horizons consistently', () => {
    expect(writingRhythmLabel('few_days')).toBe('Within a few days')
    expect(writingRhythmApproximateDays('few_days')).toBe(4)
    expect(writingRhythmApproximateDays('one_week')).toBe(7)
    expect(writingRhythmApproximateDays('two_weeks')).toBe(14)
    expect(writingRhythmApproximateDays('one_month')).toBe(30)
  })

  it('validates only canonical values', () => {
    expect(isWritingRhythm('one_week')).toBe(true)
    expect(isWritingRhythm('whenever')).toBe(false)
    expect(isWritingRhythm(null)).toBe(false)
  })
})

describe('rhythmTimingState', () => {
  const now = new Date('2026-10-10T12:00:00Z')

  it('never infers overdue state for an unset rhythm', () => {
    expect(rhythmTimingState({ waitingSince: '2026-01-01T00:00:00Z', rhythm: null, now })).toBe('unset')
  })

  it('keeps a letter within rhythm through the approximate horizon', () => {
    expect(rhythmTimingState({ waitingSince: '2026-10-06T12:00:00Z', rhythm: 'few_days', now })).toBe('within')
    expect(rhythmTimingState({ waitingSince: '2026-10-03T12:00:00Z', rhythm: 'one_week', now })).toBe('within')
  })

  it('moves beyond rhythm only after the horizon', () => {
    expect(rhythmTimingState({ waitingSince: '2026-10-06T11:59:59Z', rhythm: 'few_days', now })).toBe('beyond')
  })

  it('uses calm copy rather than deadline/late language', () => {
    expect(rhythmStatusCopy({ whoseTurn: 'viewer', timing: 'within', counterpartPseudonym: 'Maya' }))
      .toBe('Your turn · within your usual rhythm')
    expect(rhythmStatusCopy({ whoseTurn: 'viewer', timing: 'beyond', counterpartPseudonym: 'Maya' }))
      .toBe('Your turn · a little beyond your usual rhythm')
    expect(rhythmStatusCopy({ whoseTurn: 'counterpart', timing: 'beyond', counterpartPseudonym: 'Maya' }))
      .toBe('Quiet right now')
  })
})

describe('writing rhythm RPC readers', () => {
  it('maps caller default without inventing values', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ rhythm: 'one_week', approximate_days: 7 }],
      error: null,
    })
    await expect(getMyWritingRhythm({ rpc } as never)).resolves.toEqual({
      rhythm: 'one_week',
      approximateDays: 7,
    })
    expect(rpc).toHaveBeenCalledWith('get_my_writing_rhythm')
  })

  it('maps participant-only effective correspondence rhythm', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{
        viewer_id: 'viewer',
        counterpart_id: 'maya',
        viewer_rhythm: 'few_days',
        viewer_approximate_days: 4,
        viewer_uses_override: true,
        counterpart_rhythm: 'two_weeks',
        counterpart_approximate_days: 14,
      }],
      error: null,
    })

    await expect(getCorrespondenceRhythm({ rpc } as never, 'c-1')).resolves.toEqual({
      viewerId: 'viewer',
      counterpartId: 'maya',
      viewerRhythm: 'few_days',
      viewerApproximateDays: 4,
      viewerUsesOverride: true,
      counterpartRhythm: 'two_weeks',
      counterpartApproximateDays: 14,
    })
  })
})
