'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export const SYSTEM_TABS = [
  { href: '/admin/system/email', label: 'Email' },
  { href: '/admin/system/translation', label: 'Translation' },
  { href: '/admin/system/account-access', label: 'Account access' },
] as const

/** Email is the System default (app/admin/system/page.tsx). */
export function activeSystemTab(pathname: string): string {
  const match = SYSTEM_TABS.find((tab) => pathname.startsWith(tab.href))
  return match ? match.href : '/admin/system/email'
}

/** A small local pill switcher between System's children — same pattern
 * as app/admin/content/content-tabs.tsx. */
export default function SystemTabs() {
  const pathname = usePathname()
  const active = activeSystemTab(pathname)

  return (
    <div className="flex flex-wrap gap-2">
      {SYSTEM_TABS.map((tab) => (
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
