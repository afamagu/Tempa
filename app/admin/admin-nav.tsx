'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

type Destination = { href: string; label: string; matchPrefix?: string }

const DESTINATIONS: Destination[] = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/moderation/reports', label: 'Moderation', matchPrefix: '/admin/moderation' },
  { href: '/admin/members', label: 'Members' },
  { href: '/admin/content', label: 'Content', matchPrefix: '/admin/content' },
]

function isActive(pathname: string, dest: Destination): boolean {
  if (dest.href === '/admin') return pathname === '/admin'
  return pathname.startsWith(dest.matchPrefix ?? dest.href)
}

/**
 * Admin Command Center Phase 2A-1 — the permanent nav, exactly 4
 * destinations (Overview / Moderation / Members / Content). One
 * component owning BOTH the desktop horizontal nav and the mobile
 * bottom tab bar, rather than two parallel implementations that could
 * drift — they share the same DESTINATIONS list and the same
 * usePathname()-driven active-tab logic, just different layout classes
 * per breakpoint. No "More" tab yet (Decision — Phase 2A-1 mobile nav):
 * a 5th tab only gets added once Analytics/System actually exist to
 * put behind it; an empty destination is exactly the clutter the
 * product principle rejects.
 */
export default function AdminNav() {
  const pathname = usePathname()

  return (
    <>
      {/* Desktop / tablet — restrained horizontal nav, unchanged shape
          from Phase 1, just one more destination. */}
      <nav className="hidden gap-4 text-[16px] font-medium text-foreground/70 sm:flex">
        {DESTINATIONS.map((dest) => (
          <Link
            key={dest.href}
            href={dest.href}
            className={`rounded-md px-1 py-2 transition-colors hover:text-foreground ${
              isActive(pathname, dest) ? 'text-foreground' : ''
            }`}
          >
            {dest.label}
          </Link>
        ))}
      </nav>

      {/* Mobile — a real bottom tab bar, not a shrunk horizontal row.
          Fixed, safe-area-aware (iPhone home-indicator inset), never
          obscuring page content (see the layout's own bottom padding on
          mobile) or causing horizontal scroll (grid-cols-4, no wrapping). */}
      <nav
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-4 border-t border-foreground/10 bg-background sm:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {DESTINATIONS.map((dest) => {
          const active = isActive(pathname, dest)
          return (
            <Link
              key={dest.href}
              href={dest.href}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-col items-center justify-center gap-0.5 py-2.5 text-[13px] font-medium transition-colors ${
                active ? 'text-accent' : 'text-foreground/60'
              }`}
            >
              <span
                aria-hidden="true"
                className={`h-1.5 w-1.5 rounded-full ${active ? 'bg-accent' : 'bg-transparent'}`}
              />
              {dest.label}
            </Link>
          )
        })}
      </nav>
    </>
  )
}
