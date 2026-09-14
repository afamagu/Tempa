import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getWaitingLetterCount } from '@/lib/letters'
import { getActiveAnnouncement } from '@/lib/announcements'
import { resolveAnnouncementImageUrl } from '@/lib/announcement-images'
import AppShell from '@/app/app-shell'
import FullAnnouncement from './full-announcement'

function BackArrowIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
      aria-hidden="true"
    >
      <path d="M11 5 4 12l7 7" />
      <path d="M4 12h16" />
    </svg>
  )
}

/**
 * Release Polish Pass — the full Announcement reading page, reached
 * from Home's teaser. There is deliberately no per-id dynamic segment:
 * getActiveAnnouncement's own contract already guarantees exactly one
 * active Announcement at a time (see lib/announcements.ts), so this
 * route simply re-resolves "the currently active one" rather than
 * needing a new per-id lookup RPC — no SQL change required for this
 * pass. If the active Announcement has since changed or expired
 * between the teaser rendering and this page loading, the member sees
 * whatever is active now rather than a broken/stale link.
 */
export default async function AnnouncementPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/sign-in')
  }

  const [waitingCount, announcement] = await Promise.all([
    getWaitingLetterCount(supabase, user.id),
    getActiveAnnouncement(supabase),
  ])

  if (!announcement) {
    notFound()
  }

  const imageUrl = announcement.heroImagePath
    ? (await resolveAnnouncementImageUrl(supabase, announcement.heroImagePath)).url
    : null

  return (
    <AppShell active="home" waitingLetterCount={waitingCount}>
      <main className="min-h-screen flex justify-center p-6">
        <div className="w-full max-w-2xl space-y-6 py-10">
          <Link
            href="/home"
            className="inline-flex items-center gap-1.5 text-[14px] font-medium text-foreground/70 transition-colors hover:text-foreground"
          >
            <BackArrowIcon />
            Home
          </Link>

          <FullAnnouncement announcement={announcement} imageUrl={imageUrl} />

          <div className="border-t border-foreground/10 pt-4">
            <Link
              href="/home"
              className="inline-flex items-center gap-1.5 text-[14px] font-medium text-foreground/70 transition-colors hover:text-foreground"
            >
              <BackArrowIcon />
              Back to Home
            </Link>
          </div>
        </div>
      </main>
    </AppShell>
  )
}
