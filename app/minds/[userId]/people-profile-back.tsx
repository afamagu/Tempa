'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { sanitizeInternalPath } from '@/lib/safe-redirect'
import { quietLinkClass } from '@/app/profile/ui'

export default function PeopleProfileBack({ returnTo }: { returnTo?: string | null }) {
  const router = useRouter()
  const destination = sanitizeInternalPath(returnTo) ?? '/minds'

  return (
    <Link
      href={destination}
      onClick={(event) => {
        // When this profile was reached from People, browser history is
        // the best path back because it restores the exact list DOM and
        // scroll position. The href remains a safe deterministic fallback
        // for a reload/new tab or any history edge case.
        if (returnTo && window.history.length > 1) {
          event.preventDefault()
          router.back()
        }
      }}
      className={`inline-flex items-center gap-2 ${quietLinkClass}`}
      aria-label="Back to People"
    >
      <span aria-hidden="true">←</span>
      <span>People</span>
    </Link>
  )
}
