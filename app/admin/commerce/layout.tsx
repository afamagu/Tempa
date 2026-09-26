import { createClient } from '@/lib/supabase/server'
import { isCommerceAdmin } from '@/lib/admin-commerce'
import { sectionTitleClass } from '@/app/profile/ui'
import { adminMetadataClass } from '@/app/admin/admin-ui'
import CommerceTabs from './commerce-tabs'

/**
 * Admin → Commerce. Staff reach /admin (app/admin/layout.tsx), but
 * commerce is ADMIN-only: a moderator sees an explanation instead of the
 * section, and — independently — every commerce RPC re-checks
 * is_staff('admin') server-side, so hiding this UI is never the
 * authorization.
 */
export default async function CommerceLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const admin = await isCommerceAdmin(supabase)

  if (!admin) {
    return (
      <div className="space-y-2">
        <h1 className={sectionTitleClass}>Commerce</h1>
        <p className={adminMetadataClass}>Commerce is limited to admins. Ask an admin if you need a change here.</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <CommerceTabs />
      {children}
    </div>
  )
}
