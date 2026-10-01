export type CorrespondentTrigger = { from: number; to: number; query: string }

/** A single * is an accepted alias; **bold and intraword symbols stay prose. */
export function correspondentTrigger(text: string, cursor = text.length): CorrespondentTrigger | null {
  const before = text.slice(0, cursor)
  const match = /(?:^|\s)([@*])([\p{L}\p{N}_ -]{0,60})$/u.exec(before)
  if (!match) return null
  const from = before.length - match[2].length - 1
  return { from, to: cursor, query: match[2].trim() }
}

export type CorrespondentChoice = { userId: string; pseudonym: string; markUrl: string | null }
