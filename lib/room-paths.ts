/**
 * Canonical Room destinations. Keep historic route acceptance separate:
 * redirects should only happen after preserving access and context.
 * These helpers are presentation-only and must never authorize content.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const ROOM_HOME = '/room'
export const ROOM_WRITE = '/room/write'

export function roomLetterPath(id: string): string {
  if (!UUID.test(id)) throw new Error('Invalid public-letter identifier')
  return `/room/letters/${id}`
}

export function roomLetterEditPath(id: string): string {
  return `${roomLetterPath(id)}/edit`
}

export function roomLetterContactPath(recipientId: string, letterId: string): string {
  if (!UUID.test(recipientId)) throw new Error('Invalid recipient identifier')
  const returnTo = roomLetterPath(letterId)
  const params = new URLSearchParams({
    source: 'room_letter',
    d: letterId,
    returnTo,
  })
  return `/write/${recipientId}?${params}`
}

/**
 * Preserve historic Board links without interpreting client query params
 * as authorization. On migration the canonical reader validates access.
 */
export function historicBoardLetterPath(id: string, query?: URLSearchParams): string {
  const canonical = roomLetterPath(id)
  if (!query || [...query.keys()].length === 0) return canonical
  // Reading-trail query keys are not converted into a member-controlled href.
  const safe = new URLSearchParams()
  for (const key of ['s', 'seed', 'bucket', 'rank', 'shash', 'from']) {
    const value = query.get(key)
    if (value && value.length <= 120) safe.set(key, value)
  }
  return safe.size > 0 ? `${canonical}?${safe}` : canonical
}
