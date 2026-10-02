export const INTRODUCTION_SNOOZE_MS = 24 * 60 * 60 * 1000

export function needsIntroduction(questionId: string | null, answers: readonly { questionId: string }[]): boolean {
  return questionId !== null && !answers.some(answer => answer.questionId === questionId)
}

export function introductionReminderCookie(userId: string): string {
  return `tempa-introduction-${userId}`
}

export function introductionReminderSnoozed(value: string | undefined, now = Date.now()): boolean {
  if (!value || !/^\d+$/.test(value)) return false
  const until = Number(value)
  return Number.isSafeInteger(until) && until > now && until <= now + INTRODUCTION_SNOOZE_MS
}
