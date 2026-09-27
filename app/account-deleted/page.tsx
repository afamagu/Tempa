import ClearLocalDrafts from '@/app/clear-local-drafts'
import { pageTitleClass, secondaryButtonClass, systemBodyClass } from '@/app/profile/ui'
import { SUPPORT_EMAIL } from '@/lib/legal'
import { ACCOUNT_DELETED_MESSAGE, CREATE_NEW_ACCOUNT_LABEL } from '@/lib/sign-in-refusals'
import { startNewAccount } from './actions'

export const metadata = { title: 'Account deleted — Tempa', robots: { index: false, follow: false } }

/**
 * Public landing after self-service deletion (app/you/account/actions.ts).
 * Not a protected route: the person is signed out by now. `?cleanup=pending`
 * is shown when the account was closed but a final server-side step
 * (storage removal / sign-in disablement) did not finish — said plainly,
 * never presented as fully complete. `?return=unavailable` is set when
 * the account was deleted while suspended or banned: the identity stays
 * blocked, so no "Create a new account" invitation is shown.
 */
export default async function AccountDeletedPage({
  searchParams,
}: {
  searchParams: Promise<{ cleanup?: string; return?: string }>
}) {
  const { cleanup, return: returnParam } = await searchParams
  const pending = cleanup === 'pending'
  const mayReturn = returnParam !== 'unavailable'

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
      {/* F-15 — the account is gone; its private drafts must not stay on this device. */}
      <ClearLocalDrafts />
      <div className="w-full max-w-md space-y-5">
        <p className="font-serif text-lg italic text-foreground">Tempa</p>
        <h1 className={pageTitleClass}>{pending ? 'Your account has been closed' : 'Your account has been deleted'}</h1>
        {pending ? (
          <p className={systemBodyClass}>
            Your profile has been removed and your account can no longer be used, but part of the final clean-up didn&rsquo;t
            finish. Tempa will complete it — you don&rsquo;t need to do anything. If you have questions, write to{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-4">
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        ) : (
          <p className={systemBodyClass}>
            Your profile has been removed and you&rsquo;ve been signed out. Thank you for the letters you wrote here.
          </p>
        )}
        {mayReturn ? (
          <>
            <p className={systemBodyClass}>{ACCOUNT_DELETED_MESSAGE}</p>
            <form action={startNewAccount}>
              <button type="submit" className={secondaryButtonClass}>
                {CREATE_NEW_ACCOUNT_LABEL}
              </button>
            </form>
          </>
        ) : (
          <p className={systemBodyClass}>
            This account was deleted and can&rsquo;t be restored. If you have questions, write to{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-4">
              {SUPPORT_EMAIL}
            </a>
            .
          </p>
        )}
      </div>
    </main>
  )
}
