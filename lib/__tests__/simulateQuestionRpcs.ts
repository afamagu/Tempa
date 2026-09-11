// Pure, in-memory simulations of publish_question_answer /
// set_current_answer's actual is_current transitions.
//
// NOT live code the app calls — the real logic is the Postgres RPCs
// themselves (docs/sql/2026-09-18-admin-operations-refinement.sql,
// section 1b, which supersedes the 2026-09-10 definitions), which this
// repository cannot execute in a test run. These mirror those RPCs'
// promotion rules byte-for-byte (see that file's own comments for the
// rule being mirrored here) so the CONTRACT is under test, not just the
// read-side display logic in lib/questions.ts. If a future SQL change
// to either RPC's is_current logic ever drifts from what's asserted
// against these simulations, that drift has to be made deliberately
// here too — it can't happen silently.
//
// Question source-of-truth correction: neither RPC restricts by
// canonical/slug membership anymore. A member's first-ever answer to
// ANY active Question is auto-featured (publish_question_answer), and
// any of a member's own visible answers, to any Question, may be set
// as their one featured Minds answer (set_current_answer).

export type SimAnswer = {
  id: string
  userId: string
  questionId: string
  body: string
  isCurrent: boolean
  // Independent review item 5 — defaults to 'visible' when omitted, so
  // every pre-existing call site is unaffected.
  moderationStatus?: 'visible' | 'hidden'
}

let nextId = 0
function freshId(): string {
  nextId += 1
  return `sim-answer-${nextId}`
}

/** Mirrors publish_question_answer: promotes to current whenever the
 * member has no current answer yet, regardless of which Question this
 * is; otherwise leaves every is_current flag exactly as it was.
 *
 * Independent review items 5 and 8: `question.isActive` (default true)
 * mirrors the server-side rejection of ANY write — insert or edit —
 * against an inactive Question; a hidden existing row for this
 * (userId, questionId) pair mirrors the rejection of edits to
 * frozen/moderated content. Both throw rather than silently no-op,
 * matching the RPC's own RAISE EXCEPTION contract. */
export function simulatePublishQuestionAnswer(
  answers: SimAnswer[],
  userId: string,
  question: { id: string; isActive?: boolean },
  body: string
): SimAnswer[] {
  const isActive = question.isActive ?? true
  if (!isActive) {
    throw new Error('This Question is no longer accepting answers.')
  }

  const existing = answers.find((a) => a.userId === userId && a.questionId === question.id)
  if (existing && (existing.moderationStatus ?? 'visible') === 'hidden') {
    throw new Error('This answer has been hidden and cannot be edited.')
  }

  const hasCurrent = answers.some((a) => a.userId === userId && a.isCurrent)
  const shouldPromote = !hasCurrent

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
      body,
      isCurrent: shouldPromote,
    })
  }

  return next
}

/** Mirrors set_current_answer: rejects a hidden target (reusing the
 * SAME error message the real RPC folds into one `exists (...)`
 * check), otherwise demotes every other visible answer of this member
 * and promotes the chosen one. No canonical/slug restriction — any of
 * a member's own visible answers may be their featured one. */
export function simulateSetCurrentAnswer(
  answers: SimAnswer[],
  userId: string,
  answerId: string
): SimAnswer[] {
  const target = answers.find((a) => a.id === answerId && a.userId === userId)
  if (!target || (target.moderationStatus ?? 'visible') === 'hidden') {
    throw new Error('Only one of your own, visible answers can be shown in Minds.')
  }
  return answers.map((a) =>
    a.userId === userId && (a.moderationStatus ?? 'visible') === 'visible'
      ? { ...a, isCurrent: a.id === answerId }
      : { ...a }
  )
}
