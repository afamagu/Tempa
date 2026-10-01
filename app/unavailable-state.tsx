import Link from 'next/link'
import { secondaryButtonClass, systemBodyClass, systemHeadingClass } from '@/app/profile/ui'

export default function UnavailableState({
  title,
  description,
  actionHref,
  actionLabel,
}: {
  title: string
  description: string
  actionHref: string
  actionLabel: string
}) {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <div className="w-full max-w-md space-y-5">
        <p className="font-serif text-lg italic text-foreground">Tempa</p>
        <div className="space-y-2">
          <h1 className={systemHeadingClass}>{title}</h1>
          <p className={systemBodyClass}>{description}</p>
        </div>
        <Link href={actionHref} className={secondaryButtonClass}>
          {actionLabel}
        </Link>
      </div>
    </main>
  )
}
