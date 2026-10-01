import { SUPPORT_EMAIL } from '@/lib/legal'

// The words a refused sign-in is shown, keyed by the /sign-in `?error=`
// value the server chose from TEMPA's own account state
// (lib/account-auth-state.ts). Three different situations, never
// conflated with each other or with an ordinary expired link:
//   - voluntarily deleted  -> may create a new account;
//   - permanently banned   -> may not, and is told so directly;
//   - anything we cannot attribute (e.g. a Google refusal, which carries
//     no identity) -> neutral, with a support contact, no invitation.
// Client-safe: plain strings only.

export const ACCOUNT_DELETED_MESSAGE =
  'This account was deleted and can’t be restored. If you’d like to return to Tempa, you’ll need to create a new account.'

export const CREATE_NEW_ACCOUNT_LABEL = 'Create a new account'

export const ACCOUNT_BANNED_MESSAGE = `This account has been permanently banned from Tempa and can no longer be used to sign in. If you believe this is a mistake, contact ${SUPPORT_EMAIL}.`

export const ACCOUNT_DELETED_UNAVAILABLE_MESSAGE = `This account was deleted and can’t be restored. A new account can’t be created with it at the moment. If you believe this is a mistake, contact ${SUPPORT_EMAIL}.`

export const ACCOUNT_UNAVAILABLE_MESSAGE = `This account can’t be used to sign in to Tempa. If you believe this is a mistake, contact ${SUPPORT_EMAIL}.`

/** Stable semantic key for the refusal — the sign-in page renders its
 * words from the interface dictionary (messages/*.json → SignIn.refusals). */
export type SignInRefusalKind = 'deleted' | 'banned' | 'deletedUnavailable' | 'unavailable'

export type SignInRefusal = {
  kind: SignInRefusalKind
  message: string
  /** Only a voluntary deletion is ever invited to create a new account. */
  offerNewAccount: boolean
  /** Hide every "create an account" invitation on the page. */
  hideJoinInvitations: boolean
}

export function signInRefusal(errorParam: string | null): SignInRefusal | null {
  switch (errorParam) {
    case 'account_deleted':
      return { kind: 'deleted', message: ACCOUNT_DELETED_MESSAGE, offerNewAccount: true, hideJoinInvitations: false }
    case 'account_banned':
      return { kind: 'banned', message: ACCOUNT_BANNED_MESSAGE, offerNewAccount: false, hideJoinInvitations: true }
    case 'account_deleted_unavailable':
      return { kind: 'deletedUnavailable', message: ACCOUNT_DELETED_UNAVAILABLE_MESSAGE, offerNewAccount: false, hideJoinInvitations: true }
    case 'account_unavailable':
      return { kind: 'unavailable', message: ACCOUNT_UNAVAILABLE_MESSAGE, offerNewAccount: false, hideJoinInvitations: true }
    default:
      return null
  }
}
