import Link from 'next/link'
import { pageTitleClass, secondaryButtonClass, systemBodyClass } from '@/app/profile/ui'
import { SUPPORT_EMAIL } from '@/lib/legal'

export const metadata = { title: 'Account deleted — Tempa', robots: { index: false, follow: false } }

/**
 * Public landing after self-service deletion (app/you/account/actions.ts).
 * Not a protected route: the person is signed out by now. `?cleanup=pending`
 * is shown when the account was closed but a final server-side step
 * (storage removal / sign-in disablement) did not finish — said plainly,
 * never presented as fully complete.
 */
export default async function AccountDeletedPage({
  searchParams,
}: {
  searchParams: Promise<{ cleanup?: string }>
}) {
  const { cleanup } = await searchParams
  const pending = cleanup === 'pending'

  return (
    <main className="flex min-h-screen items-center justify-center p-6">
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
        <Link href="/sign-in" className={secondaryButtonClass}>
          Back to Tempa
        </Link>
      </div>
    </main>
  )
}
