'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/** A small local pill switcher between Content's children — same
 * pattern as app/admin/moderation/moderation-tabs.tsx. Postcards joins
 * as a third tab in Phase 2A-2; it is deliberately NOT listed here yet
 * so it never masquerades as a working destination before it exists. */
export default function ContentTabs() {
  const pathname = usePathname()
  const isAnnouncements = pathname.startsWith('/admin/content/announcements')

  return (
    <div className="flex gap-2">
      <Link
        href="/admin/content/questions"
        className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
          !isAnnouncements ? 'bg-accent text-accent-foreground' : 'text-foreground/70 hover:text-foreground'
        }`}
      >
        Questions
      </Link>
      <Link
        href="/admin/content/announcements"
        className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
          isAnnouncements ? 'bg-accent text-accent-foreground' : 'text-foreground/70 hover:text-foreground'
        }`}
      >
        Announcements
      </Link>
    </div>
  )
}
