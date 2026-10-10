/**
 * A deliberately small, predictable discovery composition for The Room.
 * Callers fetch a bounded, permission-checked candidate window using the
 * existing Board feed RPC; this code is presentation-only, never access control.
 */
export const ROOM_LETTER_BATCH_SIZE = 6

export type RoomLetterCandidate = {
  id: string
  authorId: string
  publishedAs: 'member' | 'tempa' | 'sponsored'
}

export type RoomLetterSelection<T extends RoomLetterCandidate> = {
  letters: T[]
  hasUnselectedCandidates: boolean
  /** True if the only remaining eligible candidates repeat already-seen authors. */
  exhaustedNewAuthors: boolean
}

export function selectRoomLetterBatch<T extends RoomLetterCandidate>(
  candidates: readonly T[],
  {
    viewerId,
    previousLetterIds,
    previousAuthorIds,
    limit = ROOM_LETTER_BATCH_SIZE,
  }: {
    viewerId: string
    previousLetterIds: ReadonlySet<string>
    previousAuthorIds: ReadonlySet<string>
    limit?: number
  },
): RoomLetterSelection<T> {
  const count = Number.isSafeInteger(limit) ? Math.max(0, Math.min(ROOM_LETTER_BATCH_SIZE, limit)) : ROOM_LETTER_BATCH_SIZE
  const uniqueCandidates: T[] = []
  const candidateIds = new Set<string>()
  for (const item of candidates) {
    if (item.publishedAs !== 'member' || item.authorId === viewerId) continue
    if (previousLetterIds.has(item.id) || candidateIds.has(item.id)) continue
    candidateIds.add(item.id)
    uniqueCandidates.push(item)
  }

  const freshAuthors = uniqueCandidates.filter(item => !previousAuthorIds.has(item.authorId))
  const preferred = freshAuthors.length ? freshAuthors : uniqueCandidates
  const usedAuthors = new Set<string>()
  const letters: T[] = []
  for (const item of preferred) {
    if (letters.length === count) break
    if (usedAuthors.has(item.authorId)) continue
    letters.push(item)
    usedAuthors.add(item.authorId)
  }
  return {
    letters,
    hasUnselectedCandidates: uniqueCandidates.some(item => !letters.some(selected => selected.id === item.id)),
    exhaustedNewAuthors: freshAuthors.length === 0 && uniqueCandidates.length > 0,
  }
}
