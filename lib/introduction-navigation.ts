import { sanitizeInternalPath } from './safe-redirect'

/** Only known reading surfaces are valid composer return destinations. */
export function introductionReturnPath(value: string | null | undefined): string | null {
  const path = sanitizeInternalPath(value)
  if (!path) return null
  const url = new URL(path, 'https://jointempa.com')
  if (url.pathname === '/home') return '/home'
  if (url.pathname === '/room' || url.pathname === '/letters/discover'
    || /^\/room\/[^/]+$/.test(url.pathname)
    || /^\/board\/[0-9a-f-]+$/i.test(url.pathname)) return path
  return null
}
export function introductionDestinations(candidateId: string, answerId: string) {
  const id = encodeURIComponent(candidateId)
  return {
    profileHref: `/room/${id}?returnTo=${encodeURIComponent('/home')}`,
    writeHref: `/write/${id}?a=${encodeURIComponent(answerId)}&source=member_introduction&returnTo=${encodeURIComponent('/home')}`,
  }
}
