'use server'

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { isStaff } from '@/lib/admin'
import { syncAuthBanWithTempa } from '@/lib/account-auth-state'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Run right after a staff member changes a member's account status
 * (admin_set_account_status / admin_apply_safety_case_intervention), so a
 * PERMANENT ban also refuses sign-in at Supabase Auth — and lifting it
 * restores sign-in. The Auth state is derived from the database alone
 * (lib/account-auth-state.ts syncAuthBanWithTempa), never from anything
 * the caller passes except which member, so even a direct invocation can
 * only bring Auth into line with Tempa's own decision. Staff-only
 * regardless. If this fails, the database ban still blocks every use of
 * the account; the admin is told so they can retry.
 */
export async function syncMemberAuthAccess(userId: string): Promise<{ ok: boolean }> {
  if (typeof userId !== 'string' || !UUID.test(userId)) return { ok: false }
  const supabase = await createClient()
  if (!(await isStaff(supabase, 'moderator'))) return { ok: false }
  try {
    return { ok: (await syncAuthBanWithTempa(createServiceClient(), userId)) === null }
  } catch (err) {
    console.error('[admin] auth access sync failed', { userId, message: err instanceof Error ? err.message : String(err) })
    return { ok: false }
  }
}
