import { SITE_URL } from '@/lib/site'

const PREVIEW_ORIGIN = /^https:\/\/tempa-[a-z0-9-]+-afam\.vercel\.app$/
const LOCAL_ORIGIN = /^http:\/\/localhost:\d{2,5}$/

/** Where Flutterwave sends the member back after checkout: this
 * deployment's own origin, but only a known Tempa origin (production, a
 * Tempa Vercel preview, or localhost outside production) — never an
 * arbitrary Origin header. Anything else falls back to production. */
export function checkoutReturnOrigin(origin: string | null, nodeEnv: string | undefined = process.env.NODE_ENV): string {
  if (origin && (origin === SITE_URL || PREVIEW_ORIGIN.test(origin) || (nodeEnv !== 'production' && LOCAL_ORIGIN.test(origin)))) {
    return origin
  }
  return SITE_URL
}
