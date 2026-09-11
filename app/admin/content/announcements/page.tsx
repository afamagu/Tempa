import { createClient } from '@/lib/supabase/server'
import { listAnnouncements } from '@/lib/announcements'
import { sectionTitleClass } from '@/app/profile/ui'
import { adminMetadataClass } from '@/app/admin/admin-ui'
import AnnouncementRow from './announcement-row'
import CreateAnnouncementForm from './create-announcement-form'

/**
 * Admin Operations Refinement checkpoint — V1 in-app Announcements.
 * Admin-only (admin_list_announcements requires is_staff('admin')
 * server-side). All members only, Home placement only, one active
 * announcement at a time — see lib/announcements.ts and
 * docs/sql/2026-09-18-admin-operations-refinement.sql. No mass-email;
 * that remains explicitly deferred.
 */
export default async function AdminAnnouncementsPage() {
  const supabase = await createClient()
  const { data: announcements, error } = await listAnnouncements(supabase)

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className={sectionTitleClass}>Announcements</h1>
          <p className={adminMetadataClass}>
            In-app only, shown to all members on Home. Only one currently-active announcement is ever shown — the
            most recently published one within its own start/end window, if any.
          </p>
        </div>
        <CreateAnnouncementForm />
      </div>

      {error && <p className="text-sm text-red-600">{error.message}</p>}

      {announcements.length === 0 ? (
        <p className={adminMetadataClass}>No announcements yet.</p>
      ) : (
        <div className="space-y-3">
          {announcements.map((a) => (
            <AnnouncementRow key={a.id} announcement={a} />
          ))}
        </div>
      )}
    </div>
  )
}
