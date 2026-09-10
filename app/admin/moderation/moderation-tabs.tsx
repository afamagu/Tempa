'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/** A small local pill switcher between Moderation's two children —
 * needs the actual current pathname to highlight the active tab, which
 * only a Client Component can read reliably (usePathname), hence this
 * being split out from the otherwise-plain layout.tsx. */
export default function ModerationTabs() {
  const pathname = usePathname()
  const isPublicContent = pathname.startsWith('/admin/moderation/public-content')

  return (
    <div className="flex gap-2">
      <Link
        href="/admin/moderation/reports"
        className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
          !isPublicContent ? 'bg-accent text-accent-foreground' : 'text-foreground/70 hover:text-foreground'
        }`}
      >
        Reports
      </Link>
      <Link
        href="/admin/moderation/public-content"
        className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
          isPublicContent ? 'bg-accent text-accent-foreground' : 'text-foreground/70 hover:text-foreground'
        }`}
      >
        Public Content
      </Link>
    </div>
  )
}
