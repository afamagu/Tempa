import type { SupabaseClient } from '@supabase/supabase-js'

export type ReplyReminderPreference = {
  remindersEnabled: boolean
  emailEnabled: boolean
}

export type ReplyReminder = {
  reminderId: string
  sourceLetterId: string
  correspondenceId: string
  counterpartId: string
  counterpartPseudonym: string
  rhythm: string
  remindedAt: string
}

const MISSING_RPC_CODES = new Set(['PGRST202', '42883'])
const MISSING_TABLE_CODES = new Set(['42P01', 'PGRST205'])

function isForwardDeployMissing(error: { code?: string | null } | null): boolean {
  return Boolean(error?.code && (MISSING_RPC_CODES.has(error.code) || MISSING_TABLE_CODES.has(error.code)))
}

/**
 * Reply reminders are intentionally opt-in. During a forward deploy where
 * Phase 8 has not reached the database yet, the safe preference is OFF/OFF.
 */
export async function getReplyReminderPreference(
  supabase: SupabaseClient,
  userId: string
): Promise<{ ok: true; value: ReplyReminderPreference } | { ok: false; error: unknown }> {
  const { data, error } = await supabase
    .from('reply_reminder_preferences')
    .select('reminders_enabled, email_enabled')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) {
    if (isForwardDeployMissing(error)) {
      return { ok: true, value: { remindersEnabled: false, emailEnabled: false } }
    }
    return { ok: false, error }
  }

  return {
    ok: true,
    value: {
      remindersEnabled: Boolean(data?.reminders_enabled),
      emailEnabled: Boolean(data?.email_enabled),
    },
  }
}

export async function setReplyReminderPreference(
  supabase: SupabaseClient,
  preference: ReplyReminderPreference
) {
  if (preference.emailEnabled && !preference.remindersEnabled) {
    return { error: new Error('Email reminders require reply reminders to be enabled.') }
  }

  const { error } = await supabase.rpc('set_reply_reminder_preferences', {
    p_reminders_enabled: preference.remindersEnabled,
    p_email_enabled: preference.emailEnabled,
  })
  return { error }
}

/**
 * Returns only reminder episodes that are still valid now. The RPC performs
 * the authoritative relationship/rhythm/block/account revalidation. Missing
 * Phase 8 database objects fail closed to an empty list during deployment.
 */
export async function getMyReplyReminders(supabase: SupabaseClient): Promise<ReplyReminder[]> {
  const { data, error } = await supabase.rpc('get_my_reply_reminders')
  if (error) {
    if (isForwardDeployMissing(error)) return []
    throw error
  }

  return ((data ?? []) as Array<{
    reminder_id: string
    source_letter_id: string
    correspondence_id: string
    counterpart_id: string
    counterpart_pseudonym: string
    rhythm: string
    reminded_at: string
  }>).map((row) => ({
    reminderId: row.reminder_id,
    sourceLetterId: row.source_letter_id,
    correspondenceId: row.correspondence_id,
    counterpartId: row.counterpart_id,
    counterpartPseudonym: row.counterpart_pseudonym,
    rhythm: row.rhythm,
    remindedAt: row.reminded_at,
  }))
}
