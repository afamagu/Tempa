import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Google sign-in without the Supabase hostname (2026-09-27).
 *
 * The redirect flow (`signInWithOAuth`) sends the browser to Supabase's
 * `/auth/v1/authorize` first, so Google's chooser names the Supabase
 * project host. Google Identity Services (GIS) instead returns a signed
 * Google ID token straight to this page; Supabase Auth then verifies it
 * (`signInWithIdToken`, grant_type=id_token) and issues the SAME kind of
 * session the redirect flow does — same `google` identity (provider +
 * Google subject), same Auth user id, same @supabase/ssr cookies.
 *
 * Replay protection: a fresh random nonce per attempt. Google embeds the
 * SHA-256 (hex) of it in the ID token; Supabase receives the raw value,
 * hashes it and compares, so a token captured elsewhere cannot be
 * replayed here.
 */

export const GOOGLE_GSI_SCRIPT_SRC = 'https://accounts.google.com/gsi/client'

/** Public OAuth web client id. Unset → the page keeps the redirect flow. */
export function googleIdentityClientId(): string | null {
  const id = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim()
  return id ? id : null
}

export type GoogleNonce = { raw: string; hashed: string }

function toHex(bytes: ArrayBuffer): string {
  return Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, '0')).join('')
}

export async function createGoogleNonce(): Promise<GoogleNonce> {
  const random = new Uint8Array(32)
  crypto.getRandomValues(random)
  const raw = toHex(random.buffer)
  const hashed = toHex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw)))
  return { raw, hashed }
}

export type GoogleSignInResult =
  | { ok: true }
  /** `refused`: Supabase refused the identity itself (user_banned). Like
   * the redirect flow's /auth/callback, this maps to the neutral
   * `account_unavailable` refusal (lib/sign-in-refusals.ts) — never an
   * "expired" or generic retry message. */
  | { ok: false; message: string; refused?: true }

export const GOOGLE_SIGN_IN_FAILED = 'Could not sign in with Google. Please try again.'
export const GOOGLE_CAPTCHA_FAILED = 'Please complete the security check again, then continue with Google.'

/**
 * Exchanges the Google ID token for a Supabase session in this browser.
 * Never logs or returns the token; member-facing copy only.
 */
export async function signInWithGoogleIdToken(
  supabase: Pick<SupabaseClient, 'auth'>,
  { credential, rawNonce, captchaToken }: { credential: string; rawNonce: string; captchaToken: string | null }
): Promise<GoogleSignInResult> {
  if (!credential || !rawNonce) return { ok: false, message: GOOGLE_SIGN_IN_FAILED }
  try {
    const { data, error } = await supabase.auth.signInWithIdToken({
      provider: 'google',
      token: credential,
      nonce: rawNonce,
      ...(captchaToken ? { options: { captchaToken } } : {}),
    })
    if (error?.code === 'user_banned') return { ok: false, message: GOOGLE_SIGN_IN_FAILED, refused: true }
    if (error || !data.session) {
      const captcha = error?.code === 'captcha_failed' || /captcha/i.test(error?.message ?? '')
      return { ok: false, message: captcha ? GOOGLE_CAPTCHA_FAILED : GOOGLE_SIGN_IN_FAILED }
    }
    return { ok: true }
  } catch {
    return { ok: false, message: GOOGLE_SIGN_IN_FAILED }
  }
}
