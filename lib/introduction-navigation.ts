import { sanitizeInternalPath } from './safe-redirect'

/** Only known reading surfaces are valid composer return destinations. */
export function introductionReturnPath(value: string | null | undefined): string | null {
  const path = sanitizeInternalPath(value)
  if (!path) return null
  const url = new URL(path, 'https://jointempa.com')
  if (url.pathname === '/home' || url.pathname === '/board') return url.pathname
  if (/^\/board\/people\/[^/]+$/.test(url.pathname) || url.pathname === '/room' || url.pathname === '/letters/discover'
    || /^\/room\/[^/]+$/.test(url.pathname)
    || /^\/room\/letters\/[0-9a-f-]+$/i.test(url.pathname)
    || /^\/minds\/[0-9a-f-]+$/i.test(url.pathname)
    || /^\/board\/[0-9a-f-]+$/i.test(url.pathname)) return path
  return null
}
export function introductionDestinations(candidateId: string, answerId: string, sourceType?: 'board_letter' | 'question_answer') {
  const id = encodeURIComponent(candidateId)
  return {
    profileHref: `/board/people/${id}?returnTo=${encodeURIComponent('/home')}`,
    writeHref: sourceType === 'board_letter'
      ? `/write/${id}?d=${encodeURIComponent(answerId)}&source=room_letter&returnTo=${encodeURIComponent('/home')}`
      : `/write/${id}?a=${encodeURIComponent(answerId)}&source=member_introduction&returnTo=${encodeURIComponent('/home')}`,
  }
}
