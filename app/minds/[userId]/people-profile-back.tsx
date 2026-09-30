'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { sanitizeInternalPath } from '@/lib/safe-redirect'
import { quietLinkClass } from '@/app/profile/ui'

export default function PeopleProfileBack({ returnTo }: { returnTo?: string | null }) {
  const router = useRouter()
  const destination = sanitizeInternalPath(returnTo) ?? '/room'

  return (
    <Link
      href={destination}
      onClick={(event) => {
        // History restores the exact Room discovery state/scroll position;
        // href remains the deterministic fallback for reload/new-tab cases.
        if (returnTo && window.history.length > 1) {
          event.preventDefault()
          router.back()
        }
      }}
      className={`inline-flex items-center gap-2 ${quietLinkClass}`}
      aria-label="Back to The Room"
    >
      <span aria-hidden="true">←</span>
      <span>The Room</span>
    </Link>
  )
}
