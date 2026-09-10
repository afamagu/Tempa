import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { isStaff } from '@/lib/admin'
import { sectionLabelClass } from '@/app/profile/ui'
import AdminNav from './admin-nav'

/**
 * The private admin area. Authorization is enforced HERE, server-side,
 * before any admin content renders: a non-staff visitor manually
 * navigating to /admin is redirected before this layout's children ever
 * mount, and is_staff() itself (docs/sql/2026-09-17-reporting-and-
 * admin-moderation.sql) is re-checked independently inside every admin
 * RPC this area calls — so even a direct RPC call bypassing this route
 * entirely is still rejected. This is never a client-side-only gate.
 *
 * No AppShell — this is a deliberately separate, plain surface for
 * staff, not a member-facing screen wearing admin controls.
 *
 * Admin Command Center Phase 2A-1 — nav grew from 3 to 4 destinations
 * (Overview / Moderation / Members / Content). AdminNav (client) owns
 * both the desktop horizontal nav and the mobile bottom tab bar as one
 * shared component — see its own doc comment. `pb-20 sm:pb-0` keeps
 * the mobile bottom tab bar from ever obscuring the last bit of page
 * content/actions; `sm:` and up need no such reservation since the nav
 * sits inline at the top there, unchanged from Phase 1.
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
    <div className="min-h-screen bg-surface-shell pb-20 sm:pb-0">
      <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-8">
        <div className="mb-8 flex items-center justify-between gap-4">
          <p className={sectionLabelClass}>TEMPA / Admin</p>
          <AdminNav />
        </div>
        {children}
      </div>
    </div>
  )
}
