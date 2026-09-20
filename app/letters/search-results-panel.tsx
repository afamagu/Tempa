import Link from 'next/link'
import ProfileIdentityMark from '@/app/profile-identity-mark'
import { helperTextClass, metadataTextClass, secondaryButtonClass } from '@/app/profile/ui'
import { formatDateTimeCompact } from '@/lib/format-date'
import { parseExcerptMarkers, type SearchPersonResult, type SearchLetterResult } from '@/lib/search'

/**
 * Renders one search_letterbox excerpt's ⟦⟦/⟧⟧-marked segments as
 * real React text plus <mark> — never dangerouslySetInnerHTML, and
 * never any other HTML from the database reaches the DOM through
 * this path.
 */
function ExcerptText({ excerpt }: { excerpt: string }) {
  return (
    <>
      {parseExcerptMarkers(excerpt).map((segment, i) =>
        segment.highlighted ? <mark key={i}>{segment.text}</mark> : <span key={i}>{segment.text}</span>
      )}
    </>
  )
}

export type SearchStatus = 'idle' | 'loading' | 'error'

/**
 * The results half of Letterbox search — purely presentational, takes
 * already-fetched results as props (same shape as PeopleGrid/
 * ArchiveList) so it's testable with fixture data, independent of the
 * debounce/RPC-calling container that owns the actual search state.
 * Grouped People then Letters; a letter card shows correspondent,
 * date, and the highlighted excerpt, and is entirely tappable.
 */
export default function SearchResultsPanel({
  query,
  status,
  personResults,
  letterResults,
  hasMoreLetters,
  loadingMore,
  onShowMoreLetters,
}: {
  query: string
  status: SearchStatus
  personResults: SearchPersonResult[]
  letterResults: SearchLetterResult[]
  hasMoreLetters: boolean
  loadingMore: boolean
  onShowMoreLetters: () => void
}) {
  if (status === 'loading') {
    return <p className={helperTextClass}>Searching…</p>
  }

  if (status === 'error') {
    return <p className="text-sm text-red-600">Could not search right now. Please try again.</p>
  }

  if (personResults.length === 0 && letterResults.length === 0) {
    return <p className={helperTextClass}>No results for &ldquo;{query}&rdquo;.</p>
  }

  return (
    <div className="space-y-6">
      {personResults.length > 0 && (
        <section>
          <p className={metadataTextClass}>People</p>
          <div className="mt-2 space-y-1">
            {personResults.map((r) => (
              <Link
                key={r.personId}
                href={`/letters/with/${r.personId}`}
                className="flex items-center gap-2 rounded-md px-3 py-2 transition-colors hover:bg-foreground/[.04]"
              >
                <ProfileIdentityMark
                  identifier={r.personId}
                  markUrl={r.markUrl ?? null}
                  label={r.markUrl ? `${r.pseudonym}'s Mark` : undefined}
                  size="sm"
                />
                <span className="text-[14px] font-medium text-foreground">{r.pseudonym}</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      {letterResults.length > 0 && (
        <section>
          <p className={metadataTextClass}>Letters</p>
          <div className="mt-2 space-y-2">
            {letterResults.map((r) => (
              <Link
                key={r.letterId}
                href={`/letters/${r.letterId}`}
                className="block rounded-md border border-foreground/10 p-3 transition-colors hover:border-foreground/25"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[14px] font-medium text-foreground">{r.otherPseudonym}</span>
                  <span className={metadataTextClass}>{formatDateTimeCompact(r.createdAt)}</span>
                </div>
                <p className="mt-1 text-[13px] leading-snug text-foreground/70">
                  <ExcerptText excerpt={r.excerpt} />
                </p>
              </Link>
            ))}
          </div>

          {hasMoreLetters && (
            <div className="mt-3 flex justify-center">
              <button
                type="button"
                onClick={onShowMoreLetters}
                disabled={loadingMore}
                className={secondaryButtonClass}
              >
                {loadingMore ? 'Loading…' : 'Show more'}
              </button>
            </div>
          )}
        </section>
      )}
    </div>
  )
}
