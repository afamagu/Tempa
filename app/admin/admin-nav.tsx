'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'

type Destination = { href: string; label: string; matchPrefix?: string }
const DESTINATIONS: Destination[] = [
  { href: '/admin', label: 'Home' },
  { href: '/admin/members', label: 'People' },
  { href: '/admin/moderation/reports', label: 'Safety', matchPrefix: '/admin/moderation' },
  { href: '/admin/content', label: 'Content' },
  { href: '/admin/commerce', label: 'Commerce' },
  { href: '/admin/system/email', label: 'System', matchPrefix: '/admin/system' },
]
const OTHER_DESTINATIONS: Destination[] = [
  { href: '/admin/pilot', label: 'Invitations' },
  { href: '/admin/feedback/account-exits', label: 'Account exits' },
]
function isActive(path: string, item: Destination): boolean {
  return item.href === '/admin'
    ? path === '/admin'
    : path === item.href || path.startsWith((item.matchPrefix ?? item.href) + '/')
}
const MOBILE = DESTINATIONS.slice(0,4)

export default function AdminNav() {
  const path = usePathname()
  const [more, setMore] = useState(false)
  const otherActive = [...DESTINATIONS.slice(4),...OTHER_DESTINATIONS].some(item => isActive(path,item))
  return <>
    <nav aria-label="Admin sections" className="hidden flex-wrap gap-2 sm:flex">
      {[...DESTINATIONS,...OTHER_DESTINATIONS].map(item => <Link
        key={item.href} href={item.href}
        aria-current={isActive(path,item)?'page':undefined}
        className={`min-h-11 rounded-md px-4 py-2.5 text-sm transition-colors ${
          isActive(path,item) ? 'bg-accent/15 font-semibold text-foreground' : 'text-foreground/70 hover:bg-foreground/5'
        }`}>{item.label}</Link>)}
    </nav>
    {more && <div id="admin-more-menu" className="fixed inset-x-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-50 rounded-lg border border-foreground/15 bg-background p-3 shadow-lg sm:hidden">
      <p className="px-2 pb-2 text-xs uppercase tracking-wider text-foreground/55">More in Admin</p>
      {[...DESTINATIONS.slice(4),...OTHER_DESTINATIONS].map(item => <Link
        key={item.href} href={item.href} onClick={()=>setMore(false)}
        aria-current={isActive(path,item)?'page':undefined}
        className={`block min-h-11 rounded-md px-3 py-3 text-sm ${
          isActive(path,item) ? 'bg-accent/15 font-semibold' : 'hover:bg-foreground/5'
        }`}>{item.label}</Link>)}
    </div>}
    <nav aria-label="Admin navigation" className="fixed inset-x-0 bottom-0 z-50 grid grid-cols-5 border-t border-foreground/15 bg-background sm:hidden"
      style={{paddingBottom:'env(safe-area-inset-bottom)'}}>
      {MOBILE.map(item => <Link key={item.href} href={item.href}
        aria-current={isActive(path,item)?'page':undefined}
        className={`flex min-h-12 items-center justify-center px-1 text-[12px] ${
          isActive(path,item)?'bg-accent/10 font-semibold text-foreground':'text-foreground/65'
        }`}>{item.label}</Link>)}
      <button type="button" aria-expanded={more} aria-controls="admin-more-menu"
        onClick={()=>setMore(v=>!v)} className={`min-h-12 px-1 text-[12px] ${
          otherActive||more?'bg-accent/10 font-semibold':'text-foreground/65'
        }`}>More</button>
    </nav>
  </>
}
