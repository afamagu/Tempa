'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

export const COMMERCE_TABS = [
  { href: '/admin/commerce', label: 'Overview' },
  { href: '/admin/commerce/catalog', label: 'Catalog' },
  { href: '/admin/commerce/facets', label: 'Facets' },
  { href: '/admin/commerce/collections', label: 'Collections' },
  { href: '/admin/commerce/pricing', label: 'Pricing' },
  { href: '/admin/commerce/credits', label: 'Credits' },
  { href: '/admin/commerce/entitlements', label: 'Entitlements & Gifts' },
  { href: '/admin/commerce/orders', label: 'Orders & Payments' },
  { href: '/admin/commerce/settings', label: 'Settings' },
  { href: '/admin/commerce/audit', label: 'Audit' },
] as const

export function activeCommerceTab(pathname: string): string {
  const match = [...COMMERCE_TABS].reverse().find((t) => t.href !== '/admin/commerce' && pathname.startsWith(t.href))
  return match ? match.href : '/admin/commerce'
}

export default function CommerceTabs() {
  const active = activeCommerceTab(usePathname())
  return (
    <nav aria-label="Commerce" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {COMMERCE_TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          aria-current={tab.href === active ? 'page' : undefined}
          className={`shrink-0 whitespace-nowrap rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
            tab.href === active ? 'bg-accent text-accent-foreground' : 'text-foreground/70 hover:text-foreground'
          }`}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
