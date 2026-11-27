import { sanitizeInternalPath } from '@/lib/safe-redirect'
import { WRITING_STYLE_PATH } from '@/lib/onboarding'

export function resolveWritingStyleNext(next: string | undefined): string {
  const safe = sanitizeInternalPath(next)
  if (!safe) return '/home'
  const pathname = safe.split(/[?#]/, 1)[0]
  if (pathname === WRITING_STYLE_PATH || pathname.startsWith(`${WRITING_STYLE_PATH}/`)) return '/home'
  return safe
}
