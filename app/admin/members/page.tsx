import { createClient } from '@/lib/supabase/server'
import { listMembers } from '@/lib/admin'
import { sectionTitleClass } from '@/app/profile/ui'
import { adminMetadataClass } from '@/app/admin/admin-ui'
import MembersDirectory from './members-directory'

/**
 * Admin Operations Refinement checkpoint — a professional default
 * Members directory. Previously this screen showed nothing until a
 * search was typed; it now server-fetches the first page (newest
 * members first, 25 per page) so there's no empty/blank state on open.
 * All subsequent search/filter/pagination happens client-side via
 * MembersDirectory, which always re-queries admin_list_members with a
 * fresh limit/offset — never a client-side "fetch all then filter,"
 * so this remains usable at any member count.
 */
export default async function AdminMembersPage() {
  const supabase = await createClient()
  const { data: initialMembers, error } = await listMembers(supabase, { limit: 25, offset: 0 })

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className={sectionTitleClass}>Members</h1>
        <p className={adminMetadataClass}>Newest members first. Search, filter, or page through the directory.</p>
      </div>
      <MembersDirectory initialMembers={initialMembers} initialError={error?.message ?? null} />
    </div>
  )
}
