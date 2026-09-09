// Pure, in-memory simulations of publish_question_answer /
// set_current_answer's actual is_current transitions under the
// canonical three-Question model.
//
// NOT live code the app calls — the real logic is the Postgres RPCs
// themselves (docs/sql/2026-09-03-publish-question-answer-canonical.sql,
// docs/sql/2026-09-03-set-current-answer-canonical-only.sql), which
// this repository cannot execute in a test run. These mirror those
// RPCs' promotion rules byte-for-byte (see each SQL file's own
// comments for the rule being mirrored here) so the CONTRACT is under
// test, not just the read-side display logic in lib/questions.ts. If a
// future SQL change to either RPC's is_current logic ever drifts from
// what's asserted against these simulations, that drift has to be made
// deliberately here too — it can't happen silently.

export type SimAnswer = {
  id: string
  userId: string
  questionId: string
  isCanonical: boolean
  body: string
  isCurrent: boolean
}

let nextId = 0
function freshId(): string {
  nextId += 1
  return `sim-answer-${nextId}`
}

/** Mirrors publish_question_answer: promotes to current only when the
 * Question is canonical AND the member has no current answer yet;
 * otherwise leaves every is_current flag exactly as it was. */
export function simulatePublishQuestionAnswer(
  answers: SimAnswer[],
  userId: string,
  question: { id: string; isCanonical: boolean },
  body: string
): SimAnswer[] {
  const hasCurrent = answers.some((a) => a.userId === userId && a.isCurrent)
  const shouldPromote = question.isCanonical && !hasCurrent

  const next = shouldPromote
    ? answers.map((a) =>
        a.userId === userId && a.questionId !== question.id ? { ...a, isCurrent: false } : { ...a }
      )
    : answers.map((a) => ({ ...a }))

  const existingIdx = next.findIndex((a) => a.userId === userId && a.questionId === question.id)

  if (existingIdx >= 0) {
    next[existingIdx] = {
      ...next[existingIdx],
      body,
      isCurrent: shouldPromote ? true : next[existingIdx].isCurrent,
    }
  } else {
    next.push({
      id: freshId(),
      userId,
      questionId: question.id,
      isCanonical: question.isCanonical,
      body,
      isCurrent: shouldPromote,
    })
  }

  return next
}

/** Mirrors set_current_answer: rejects a non-canonical target
 * (matching the RPC's existence-check guard), otherwise demotes every
 * other answer of this member and promotes the chosen one. */
export function simulateSetCurrentAnswer(
  answers: SimAnswer[],
  userId: string,
  answerId: string
): SimAnswer[] {
  const target = answers.find((a) => a.id === answerId && a.userId === userId)
  if (!target) {
    throw new Error('Answer not found, or not yours.')
  }
  if (!target.isCanonical) {
    throw new Error(
      'Only a completed answer to one of the three canonical Questions can be shown in Minds.'
    )
  }
  return answers.map((a) => (a.userId === userId ? { ...a, isCurrent: a.id === answerId } : { ...a }))
}
