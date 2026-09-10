import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isStaff } from '@/lib/admin'
import { sectionLabelClass } from '@/app/profile/ui'

/**
 * The smallest useful private admin area (pre-beta minimum safety
 * build) — a report queue and member search/status screens, nothing
 * more. Authorization is enforced HERE, server-side, before any admin
 * content renders: a non-staff visitor manually navigating to /admin is
 * redirected before this layout's children ever mount, and is_staff()
 * itself (docs/sql/2026-09-17-reporting-and-admin-moderation.sql) is
 * re-checked independently inside every admin RPC this area calls — so
 * even a direct RPC call bypassing this route entirely is still
 * rejected. This is never a client-side-only gate.
 *
 * No AppShell — this is a deliberately separate, plain surface for
 * staff, not a member-facing screen wearing admin controls.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  const staff = await isStaff(supabase)
  if (!staff) {
    redirect('/')
  }

  return (
    <div className="min-h-screen bg-surface-shell">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8">
        <div className="mb-8 flex items-center justify-between gap-4">
          <p className={sectionLabelClass}>TEMPA / Admin</p>
          <nav className="flex gap-4 text-[14px] font-medium text-foreground/70">
            <Link href="/admin" className="transition-colors hover:text-foreground">
              Overview
            </Link>
            <Link href="/admin/reports" className="transition-colors hover:text-foreground">
              Reports
            </Link>
            <Link href="/admin/members" className="transition-colors hover:text-foreground">
              Members
            </Link>
          </nav>
        </div>
        {children}
      </div>
    </div>
  )
}
