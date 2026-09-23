'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/** A small local pill switcher between Moderation's three children —
 * needs the actual current pathname to highlight the active tab, which
 * only a Client Component can read reliably (usePathname), hence this
 * being split out from the otherwise-plain layout.tsx.
 *
 * Safety 2, Checkpoint 7 — Needs Attention joins as a third, coequal
 * tab (suggested order: Needs Attention | Reports | Public Content),
 * rather than a disconnected admin product; both existing children stay
 * unchanged. */
export default function ModerationTabs() {
  const pathname = usePathname()
  const isNeedsAttention = pathname.startsWith('/admin/moderation/needs-attention')
  const isPublicContent = pathname.startsWith('/admin/moderation/public-content')
  const isReports = !isNeedsAttention && !isPublicContent

  return (
    <div className="flex gap-2">
      <Link
        href="/admin/moderation/needs-attention"
        className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
          isNeedsAttention ? 'bg-accent text-accent-foreground' : 'text-foreground/70 hover:text-foreground'
        }`}
      >
        Needs Attention
      </Link>
      <Link
        href="/admin/moderation/reports"
        className={`rounded-full px-3 py-1.5 text-[13px] font-medium transition-colors ${
          isReports ? 'bg-accent text-accent-foreground' : 'text-foreground/70 hover:text-foreground'
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
