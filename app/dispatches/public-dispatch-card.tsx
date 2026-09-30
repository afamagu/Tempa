import Link from 'next/link'
import { formatDatePlain } from '@/lib/format-date'
import EditorialByline from '@/app/editorial-byline'
import {
  publicDispatchPreviewByline,
  publicDispatchPreviewDescription,
  publicDispatchPreviewPath,
  type PublicDispatchPreview,
} from '@/lib/public-dispatch-discovery'

export default function PublicDispatchCard({ dispatch }: { dispatch: PublicDispatchPreview }) {
  const description = publicDispatchPreviewDescription(dispatch)

  return (
    <article className="space-y-2 border-b border-foreground/10 py-6 first:pt-0 last:border-b-0 last:pb-0">
      <div>
        <p className="text-[13px] text-muted">
          {publicDispatchPreviewByline(dispatch)} <span aria-hidden="true">·</span>{' '}
          <time dateTime={dispatch.publishedAt}>{formatDatePlain(dispatch.publishedAt)}</time>
        </p>
        <EditorialByline title={dispatch.identity.kind === 'member' ? dispatch.identity.editorialTitle : null} />
      </div>
      <h2 className="font-serif text-[22px] font-medium leading-snug tracking-tight text-foreground sm:text-2xl">
        <Link
          href={publicDispatchPreviewPath(dispatch)}
          className="underline decoration-transparent underline-offset-4 transition-colors hover:decoration-foreground/35"
        >
          {dispatch.title}
        </Link>
      </h2>
      {description && <p className="font-serif text-[17px] leading-relaxed text-muted">{description}</p>}
      {dispatch.topics.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-1" aria-label="Topics">
          {dispatch.topics.map((topic) => (
            <span key={topic} className="rounded-full border border-foreground/10 px-2.5 py-1 text-[12px] text-muted">
              {topic}
            </span>
          ))}
        </div>
      )}
    </article>
  )
}
