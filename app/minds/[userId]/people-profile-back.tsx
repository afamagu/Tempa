'use client'

import Link from 'next/link'
import { sanitizeInternalPath } from '@/lib/safe-redirect'
import { quietLinkClass } from '@/app/profile/ui'

export default function PeopleProfileBack({ returnTo }: { returnTo?: string | null }) {
  const destination = sanitizeInternalPath(returnTo) ?? '/room'

  const label = destination === '/home' ? 'Home' : destination.startsWith('/letters/discover') ? 'Discover People' : 'The Room'

  return (
    <Link
      href={destination}
      className={`inline-flex items-center gap-2 ${quietLinkClass}`}
      aria-label={`Back to ${label}`}
    >
      <span aria-hidden="true">←</span>
      <span>{label}</span>
    </Link>
  )
}
