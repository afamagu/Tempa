import { describe, expect, it } from 'vitest'
import { introductionReminderCookie, introductionReminderSnoozed, needsIntroduction, INTRODUCTION_SNOOZE_MS } from './introduction-reminder'

describe('introduction reminder', () => {
  it('stops only after the introduction answer exists, not after an unrelated weekly answer', () => {
    expect(needsIntroduction('intro', [{ questionId: 'weekly' }])).toBe(true)
    expect(needsIntroduction('intro', [{ questionId: 'intro' }])).toBe(false)
    expect(needsIntroduction(null, [])).toBe(false)
  })
  it('snoozes for a bounded day, then becomes eligible again', () => {
    const now = 100000000
    const until = String(now + INTRODUCTION_SNOOZE_MS)
    expect(introductionReminderSnoozed(until, now)).toBe(true)
    expect(introductionReminderSnoozed(until, now + INTRODUCTION_SNOOZE_MS)).toBe(false)
    for (const bad of [undefined, '', 'bad', '-1', String(now + INTRODUCTION_SNOOZE_MS + 1)]) {
      expect(introductionReminderSnoozed(bad, now)).toBe(false)
    }
  })
  it('does not reuse one member’s dismissal for another member', () => {
    expect(introductionReminderCookie('member-a')).not.toBe(introductionReminderCookie('member-b'))
  })
})
