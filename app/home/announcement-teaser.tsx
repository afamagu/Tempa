import Link from 'next/link'
import type { ActiveAnnouncement } from '@/lib/announcements'
import { docToPlainText } from '@/lib/announcement-editor-doc'
import { sectionLabelClass } from '@/app/profile/ui'

/**
 * Release Polish Pass — Home's own compact editorial TEASER for the one
 * active Announcement, replacing the previous behavior of rendering the
 * ENTIRE body directly on Home (a bug: Home is a summary surface, not
 * the reading surface). The full body still renders — unmodified,
 * through the exact same AnnouncementBody component — but only on the
 * dedicated /announcement page this teaser links to. A short, CSS-
 * clamped excerpt is the most this ever shows.
 *
 * Deliberately reads as TEMPA-authored editorial content, not a member
 * Dispatch: a small uppercase "ANNOUNCEMENT" eyebrow (the same
 * sectionLabelClass token every other Home section eyebrow uses, e.g.
 * "Arrivals," "From the Board") is the one signal that separates it
 * from a Dispatch teaser, which never carries an eyebrow like this.
 */
export default function AnnouncementTeaser({
  announcement,
  imageUrl,
}: {
  announcement: ActiveAnnouncement
  imageUrl: string | null
}) {
  // Only the FIRST block's plain text — never the whole doc joined
  // together and left to CSS line-clamp to visually hide the rest, the
  // same "extract, don't just clamp" discipline lib/letters.ts's
  // letterPreviewText and lib/dispatches.ts's dispatchExcerpt already
  // use for every other Home/Letterbox/Board preview card. Reuses
  // docToPlainText itself (on a doc containing only that first block)
  // rather than duplicating its inline-text-joining logic here.
  const excerpt = announcement.contentJson
    ? docToPlainText({ type: 'doc', content: announcement.contentJson.content?.slice(0, 1) })
    : announcement.body.split('\n\n')[0]

  return (
    <div className="mb-8 space-y-3 border-b border-foreground/10 pb-8">
      <p className={sectionLabelClass}>Announcement</p>

      {imageUrl && (
        // Home Phase 1B — a wider, shorter ratio on mobile (roughly
        // 160-200px effective height on a typical phone at this
        // column's own width) so the artwork reads as editorial
        // accompaniment, never a hero takeover of the first viewport;
        // widens back to the original, more generous 3:2 on desktop,
        // where the wider column comfortably supports it. object-cover
        // throughout — this image is already a deliberately-cropped
        // photographic hero (never a diagram/screenshot where `contain`
        // would be required to avoid cutting off meaningful content),
        // so only the crop WINDOW changes with viewport, never the fit
        // mode itself.
        <Link href="/announcement" className="block aspect-[2/1] w-full overflow-hidden rounded-md sm:aspect-[3/2]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="" className="h-full w-full object-cover" />
        </Link>
      )}

      <div className="space-y-1">
        <h2 className="font-serif text-2xl font-medium leading-tight text-foreground">{announcement.title}</h2>
        {announcement.subtitle && (
          <p className="font-serif italic text-foreground/70">{announcement.subtitle}</p>
        )}
      </div>

      {excerpt && (
        <p className="line-clamp-2 whitespace-pre-wrap font-serif text-[15px] leading-relaxed text-foreground/70">
          {excerpt}
        </p>
      )}

      <Link
        href="/announcement"
        className="inline-flex items-center gap-1 text-[14px] font-medium text-foreground/70 transition-colors hover:text-foreground"
      >
        Read announcement <span aria-hidden="true">→</span>
      </Link>
    </div>
  )
}
