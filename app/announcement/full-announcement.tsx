import type { ActiveAnnouncement } from '@/lib/announcements'
import AnnouncementBody from '@/app/announcement-body'

/**
 * Release Polish Pass — the full editorial Announcement reading
 * surface, reached via Home's "Read announcement →" teaser
 * (app/home/announcement-teaser.tsx). This is the SAME full-body
 * rendering Home used to show directly (a bug) — AnnouncementBody
 * itself is untouched; only where it's mounted changed. Extracted as
 * its own presentational component (no data fetching) so it's
 * directly testable without a Supabase client, mirroring how
 * AnnouncementBody itself is tested in isolation.
 */
export default function FullAnnouncement({
  announcement,
  imageUrl,
}: {
  announcement: ActiveAnnouncement
  imageUrl: string | null
}) {
  return (
    <article className="space-y-4">
      {imageUrl && (
        <div className="aspect-[3/2] w-full overflow-hidden rounded-md">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" className="h-full w-full object-cover" />
        </div>
      )}

      <div className="space-y-1">
        <h1 className="font-serif text-2xl font-medium leading-tight text-foreground sm:text-[28px]">
          {announcement.title}
        </h1>
        {announcement.subtitle && (
          <p className="font-serif italic text-foreground/70">{announcement.subtitle}</p>
        )}
      </div>

      <AnnouncementBody doc={announcement.contentJson} />
    </article>
  )
}
