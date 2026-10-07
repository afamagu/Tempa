import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'
import { getWaitingLetterCount } from '@/lib/letters'
import { getArrivalEmailPreference } from '@/lib/email-preferences'
import { getReplyReminderPreference } from '@/lib/reply-reminders'
import { proseSubheadingClass, helperTextClass, secondaryButtonClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import RoomInvitationPreference from './room-invitation-preference'
import { getTranslations } from 'next-intl/server'
import NotificationsEditor from './notifications-editor'
import MentionEmailPreference from './mention-email-preference'
import ReplyReminderPreference from './reply-reminder-preference'

export default async function NotificationsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in?next=%2Fyou%2Fnotifications')
  }

  const [waitingCount, preferenceResult, replyReminderResult, replyReminderSystemResult] = await Promise.all([
    getWaitingLetterCount(supabase, user.id),
    getArrivalEmailPreference(supabase, user.id),
    getReplyReminderPreference(supabase, user.id),
    createServiceClient()
      .from('reply_reminder_system_config')
      .select('sending_enabled')
      .eq('id', true)
      .maybeSingle(),
  ])
  const replyReminderEmailSendingEnabled =
    !replyReminderSystemResult.error && replyReminderSystemResult.data?.sending_enabled === true

  const { data: roomPreference, error: roomPreferenceError } = await supabase
    .from('room_invitation_preferences')
    .select('emails_enabled')
    .eq('user_id', user.id)
    .maybeSingle()
  const t = await getTranslations('RoomInvitations')
  const mentions = await getTranslations('Mentions')
  const mentionEmails = await getTranslations('MentionEmails')
  const { data: mentionPreference, error: mentionPreferenceError } = await supabase
    .from('mention_email_preferences')
    .select('audience')
    .eq('user_id', user.id)
    .maybeSingle()

  return (
    <AppShell active="you" waitingLetterCount={waitingCount}>
      <main className="flex min-h-screen justify-center p-6">
        <div className="w-full max-w-2xl space-y-6 py-10">
          <div className="space-y-2">
            <Link href="/you" className={secondaryButtonClass}>
              You
            </Link>
            <h1 className={proseSubheadingClass}>Notifications</h1>
            <p className={helperTextClass}>
              Tempa quietly keeps you informed about the people and letters that need your attention. These are on by default; make things quieter anytime.
            </p>
          </div>

          {preferenceResult.ok ? (
            <NotificationsEditor initialEnabled={preferenceResult.enabled} />
          ) : (
            <div className="space-y-3 rounded-md border border-foreground/10 p-4">
              <p className="text-sm text-red-600">
                Could not load your letter-arrival setting right now. Please try again.
              </p>
              <a href="/you/notifications" className={secondaryButtonClass}>
                Try again
              </a>
            </div>
          )}

          {replyReminderResult.ok ? (
            <ReplyReminderPreference
              initialRemindersEnabled={replyReminderResult.value.remindersEnabled}
              initialEmailEnabled={replyReminderResult.value.emailEnabled}
              emailSendingEnabled={replyReminderEmailSendingEnabled}
            />
          ) : (
            <div className="space-y-3 border-t border-foreground/10 pt-6">
              <p className="text-sm text-red-600">
                Could not load your reply-reminder setting right now. Please try again.
              </p>
              <a href="/you/notifications" className={secondaryButtonClass}>
                Try again
              </a>
            </div>
          )}

          {roomPreferenceError ? (
            <p className={helperTextClass}>{t('preferenceUnavailable')}</p>
          ) : (
            <div id="room-invitations" className="scroll-mt-6">
              <RoomInvitationPreference initialEnabled={roomPreference?.emails_enabled ?? true} />
            </div>
          )}
          <Link href="/you/mentions" className={secondaryButtonClass}>{mentions('all')}</Link>
          {mentionPreferenceError ? (
            <p id="mention-emails" role="status">{mentionEmails('unavailable')}</p>
          ) : (
            <MentionEmailPreference initialAudience={mentionPreference?.audience ?? 'everyone'} />
          )}
        </div>
      </main>
    </AppShell>
  )
}
