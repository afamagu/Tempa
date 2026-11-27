import type { MyQuestionAnswer } from '@/lib/questions'

export function canWriteToMind(state: {
  isSelf: boolean
  alreadyCorresponding: boolean
  hasCurrentAnswer: boolean
  currentAnswerAlreadyContacted: boolean
}): boolean {
  return !state.isSelf && !state.alreadyCorresponding && state.hasCurrentAnswer && !state.currentAnswerAlreadyContacted
}

/** Stable introduction first, then a live/historical Room response, then latest. */
export function chooseProfileAnswer(answers: MyQuestionAnswer[]): MyQuestionAnswer | null {
  return (
    answers.find((answer) => answer.isPrimary) ??
    answers.find((answer) => answer.isCurrent) ??
    [...answers].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ??
    null
  )
}
