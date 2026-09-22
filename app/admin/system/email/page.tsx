import { createClient } from '@/lib/supabase/server'
import { getArrivalEmailStatus } from '@/lib/admin'
import EmailStatusView from './email-status-view'

/**
 * Admin visibility into the arrival-email queue (docs/sql/2026-10-01-
 * arrival-email-delivery.sql) — counts by status, the 50 most recently
 * updated jobs, and the global kill switch. No auth check here — see
 * app/admin/layout.tsx (the route gate) and
 * admin_get_arrival_email_status's own is_staff() check (the real
 * boundary), same pattern as every other admin page
 * (route-structure.test.ts enforces this).
 */
export default async function AdminEmailStatusPage() {
  const supabase = await createClient()
  const { data, error } = await getArrivalEmailStatus(supabase)

  return <EmailStatusView initialStatus={data} initialError={error?.message ?? null} />
}
