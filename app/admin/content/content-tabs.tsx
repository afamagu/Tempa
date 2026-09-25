'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export const CONTENT_TABS = [
  { href: '/admin/content/questions', label: 'Questions' },
  { href: '/admin/content/announcements', label: 'Announcements' },
  { href: '/admin/content/postcards', label: 'Postcards' },
  // Official Tempa Dispatches and Sponsored Dispatches
  // (docs/sql/2026-10-15-official-sponsored-dispatches.sql).
  { href: '/admin/content/dispatches', label: 'Dispatches' },
  { href: '/admin/content/sponsored', label: 'Sponsored' },
] as const

/** Questions is the Content default (app/admin/content/page.tsx). */
export function activeContentTab(pathname: string): string {
  const match = CONTENT_TABS.find((tab) => tab.href !== '/admin/content/questions' && pathname.startsWith(tab.href))
  return match ? match.href : '/admin/content/questions'
}

/** A small local pill switcher between Content's children — same
 * pattern as app/admin/moderation/moderation-tabs.tsx. Admin Phase
 * 2A-2 — Postcards joins Questions/Announcements as the third tab;
 * Dispatches and Sponsored follow. */
export default function ContentTabs() {
  const pathname = usePathname()
  const active = activeContentTab(pathname)

  return (
    <div className="flex flex-wrap gap-2">
      {CONTENT_TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.href === active ? 'page' : undefined}
          className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
            tab.href === active ? 'bg-accent text-accent-foreground' : 'text-foreground/70 hover:text-foreground'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </div>
  )
}
