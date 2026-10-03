import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import { getArrivalEmailPreference } from '@/lib/email-preferences'
import { proseSubheadingClass, helperTextClass, secondaryButtonClass } from '@/app/profile/ui'
import AppShell from '@/app/app-shell'
import RoomInvitationPreference from './room-invitation-preference'
import { getTranslations } from 'next-intl/server'
import NotificationsEditor from './notifications-editor'
import MentionEmailPreference from './mention-email-preference'

export default async function NotificationsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in?next=%2Fyou%2Fnotifications')
  }

  const [waitingCount, preferenceResult] = await Promise.all([
    getWaitingLetterCount(supabase, user.id),
    getArrivalEmailPreference(supabase, user.id),
  ])

  const { data: roomPreference, error: roomPreferenceError } = await supabase.from('room_invitation_preferences').select('emails_enabled').eq('user_id', user.id).maybeSingle()
  const t = await getTranslations('RoomInvitations')
  const mentions = await getTranslations('Mentions')
  const mentionEmails = await getTranslations('MentionEmails')
  const { data: mentionPreference, error: mentionPreferenceError } = await supabase.from('mention_email_preferences').select('audience').eq('user_id', user.id).maybeSingle()

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
              Choose whether Tempa emails you when a letter arrives in your Letterbox.
            </p>
          </div>

          {preferenceResult.ok ? (
            <NotificationsEditor initialEnabled={preferenceResult.enabled} />
          ) : (
            // A read failure must never render as an apparently
            // authoritative on/off state (independent audit
            // correction) — a plain full-page reload link, not a
            // guessed default, since we genuinely don't know the
            // current preference here.
            <div className="space-y-3 rounded-md border border-foreground/10 p-4">
              <p className="text-sm text-red-600">
                Could not load your notification setting right now. Please try again.
              </p>
              <a href="/you/notifications" className={secondaryButtonClass}>
                Try again
              </a>
            </div>
          )}
          {roomPreferenceError ? <p className={helperTextClass}>{t('preferenceUnavailable')}</p> : <RoomInvitationPreference initialEnabled={roomPreference?.emails_enabled ?? true} />}
          <Link href="/you/mentions" className={secondaryButtonClass}>{mentions('all')}</Link>
          {mentionPreferenceError ? <p id="mention-emails" role="status">{mentionEmails('unavailable')}</p> : <MentionEmailPreference initialAudience={mentionPreference?.audience ?? 'everyone'} />}
        </div>
      </main>
    </AppShell>
  )
}
